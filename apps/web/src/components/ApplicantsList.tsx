"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiDownload, apiRequest } from "@/lib/apiClient";
import { isLiveProgressStatus, liveStepLabel } from "@/lib/liveProgress";
import { pauseReasonLabel } from "@/lib/pendingActions";
import { formatProxyGeoLabel } from "@/lib/proxyGeo";
import { StartAutomationModal } from "./StartAutomationModal";
import { StartBatchModal } from "./StartBatchModal";
import { GenerateBatchModal } from "./GenerateBatchModal";

interface ApplicantRow {
  id: string;
  externalId: string;
  fullName: string;
  email?: string;
  status: string;
  pauseReason: string | null;
  currentStep: string | null;
  proxyGeoCity?: string | null;
  proxyGeoRegion?: string | null;
  proxyExternalIp?: string | null;
  updatedAt?: string;
}

interface ApplicantsListResult {
  items: ApplicantRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: "", label: "Todos os status" },
  { id: "IN_PROGRESS", label: "Em andamento" },
  { id: "READY_TO_START", label: "Pronto para iniciar" },
  { id: "AWAITING_HUMAN_ACTION", label: "Aguardando humano" },
  { id: "FAILED", label: "Falhou" },
  { id: "CANCELLED", label: "Cancelado" },
  { id: "COMPLETED", label: "Concluído" },
  { id: "RESOLVED", label: "Resolvido" },
  { id: "NEW", label: "Novo" },
  { id: "CONSENT_PENDING", label: "Consentimento" },
];

const PAUSE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "", label: "Todos os motivos" },
  { id: "NON_SOCURE_PROVIDER", label: "Veriff / outro provedor" },
  { id: "PHONE_PROBLEM", label: "Problema celular" },
  { id: "IDENTITY_VERIFICATION_REQUIRED", label: "Verificação de identidade" },
  { id: "SECURITY_BLOCK", label: "Bloqueio de segurança" },
  { id: "PAGE_UNAVAILABLE", label: "Página indisponível" },
  { id: "CAPTCHA", label: "CAPTCHA" },
  { id: "TWO_FACTOR", label: "2FA" },
  { id: "REFUSED", label: "Recusado" },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  AWAITING_HUMAN_ACTION: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-green-100 text-green-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-slate-200 text-slate-600",
  FAILED: "bg-red-100 text-red-800",
};

/**
 * Só permite iniciar automação de um estado "de repouso" - motoristas já em
 * andamento/pausados/concluídos têm seu próprio fluxo (Central de
 * Pendências) para evitar dois jobs concorrentes para o mesmo motorista.
 */
const STARTABLE_STATUSES = new Set([
  "NEW",
  "CONSENT_PENDING",
  "READY_TO_START",
  "FAILED",
  "CANCELLED",
  "AWAITING_HUMAN_ACTION",
]);

const BATCH_STARTABLE_STATUSES = new Set([
  "NEW",
  "CONSENT_PENDING",
  "READY_TO_START",
  "FAILED",
  "CANCELLED",
]);

/** Status com página de log útil (inclui IN_PROGRESS para acompanhar ao vivo). */
const LOGGABLE_STATUSES = new Set(["FAILED", "AWAITING_HUMAN_ACTION", "IN_PROGRESS"]);

const LIVE_POLL_MS = 3_000;

export function ApplicantsList() {
  const [applicants, setApplicants] = useState<ApplicantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApplicantRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openingBrowserId, setOpeningBrowserId] = useState<string | null>(null);
  const [closingBrowserId, setClosingBrowserId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [purgingVeriff, setPurgingVeriff] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [livePolling, setLivePolling] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status) params.set("status", status);
      if (pauseReason) params.set("pauseReason", pauseReason);
      if (q) params.set("q", q);
      const result = await apiRequest<ApplicantsListResult>(`/api/applicants?${params.toString()}`);
      if (!opts?.silent) setLoading(false);
      if (!result.success) return;
      if (result.data.total > 0 && result.data.items.length === 0 && page > 1) {
        setPage(1);
        return;
      }
      setApplicants(result.data.items);
      setTotal(result.data.total);
      setTotalPages(result.data.totalPages);
      setLivePolling(
        status === "" ||
          status === "IN_PROGRESS" ||
          result.data.items.some((a) => isLiveProgressStatus(a.status)),
      );
    },
    [page, pageSize, status, pauseReason, q],
  );

  const batchCandidates = useMemo(
    () =>
      applicants.filter(
        (a) =>
          BATCH_STARTABLE_STATUSES.has(a.status) && a.pauseReason !== "REFUSED",
      ),
    [applicants],
  );

  const allBatchSelected =
    batchCandidates.length > 0 && batchCandidates.every((a) => checkedIds.has(a.id));

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllBatch() {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allBatchSelected) {
        for (const applicant of batchCandidates) next.delete(applicant.id);
        return next;
      }
      for (const applicant of batchCandidates) next.add(applicant.id);
      return next;
    });
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = searchInput.trim();
      setQ((prev) => {
        if (prev === next) return prev;
        setPage(1);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!livePolling) return;
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [livePolling, load]);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  function applyStatus(next: string) {
    setStatus(next);
    setPage(1);
  }

  function applyPauseReason(next: string) {
    setPauseReason(next);
    setPage(1);
  }

  function applyPageSize(next: (typeof PAGE_SIZE_OPTIONS)[number]) {
    setPageSize(next);
    setPage(1);
  }

  function clearFilters() {
    setSearchInput("");
    setQ("");
    setStatus("");
    setPauseReason("");
    setPage(1);
  }

  async function handleDelete(applicant: ApplicantRow) {
    if (
      !window.confirm(
        `Apagar o motorista "${applicant.fullName}"?\n\nIsso remove e-mail, perfil de navegador, cookies e screenshots. Não pode ser desfeito.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setDeletingId(applicant.id);
    const result = await apiRequest<{ id: string }>(`/api/applicants/${applicant.id}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    if (result.success) {
      setApplicants((prev) => prev.filter((a) => a.id !== applicant.id));
    } else {
      setActionError(result.error.message);
    }
  }

  async function handleDownloadCookies(applicant: ApplicantRow) {
    setActionError(null);
    setDownloadingId(applicant.id);
    const ok = await apiDownload(
      `/api/applicants/${applicant.id}/uber-cookies`,
      `adspower-cookies-${applicant.externalId}.json`,
    );
    setDownloadingId(null);
    if (!ok) {
      setActionError(
        "Não foi possível baixar cookies (ainda vazios ou sessão não persistida). Rode a automação até criar/pausar a conta.",
      );
    } else {
      window.alert(
        "Cookies baixados no formato AdsPower.\n\nNo AdsPower: abra o perfil → campo Cookie → cole o conteúdo do arquivo (Ctrl+A / Ctrl+C no JSON).\nNão use upload de arquivo de perfil.\nSe falhar, baixe também a versão Netscape (?format=netscape).",
      );
    }
  }

  async function handleOpenManualBrowser(applicant: ApplicantRow) {
    setActionError(null);
    setOpeningBrowserId(applicant.id);
    const result = await apiRequest<{ jobId: string; proxyId: string }>(
      `/api/applicants/${applicant.id}/open-manual-browser`,
      { method: "POST", body: JSON.stringify({}) },
    );
    setOpeningBrowserId(null);
    if (result.success) {
      setActionError(null);
      window.alert(
        "Browser manual enfileirado. Uma janela Chromium deve abrir no worker. Use «Fechar browser» ou feche a janela quando terminar.",
      );
    } else {
      setActionError(result.error.message);
    }
  }

  async function handleCloseManualBrowser(applicant: ApplicantRow) {
    setActionError(null);
    setClosingBrowserId(applicant.id);
    const result = await apiRequest<{ stopSignaled: boolean }>(
      `/api/applicants/${applicant.id}/close-manual-browser`,
      { method: "POST", body: JSON.stringify({}) },
    );
    setClosingBrowserId(null);
    if (result.success) {
      window.alert("Sinal de fechar enviado — o Chromium deve fechar em alguns segundos.");
    } else {
      setActionError(result.error.message);
    }
  }

  async function handleStopAutomation(applicant: ApplicantRow) {
    if (
      !window.confirm(
        `Parar a automação de "${applicant.fullName}"?\n\nRemove da fila e fecha o browser se estiver rodando.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setStoppingId(applicant.id);
    const result = await apiRequest<{ stopSignaled: boolean; removedQueuedJobs: number }>(
      `/api/applicants/${applicant.id}/stop-automation`,
      { method: "POST", body: JSON.stringify({}) },
    );
    setStoppingId(null);
    if (result.success) {
      await load({ silent: true });
    } else {
      setActionError(result.error.message);
    }
  }

  async function handleStopAll() {
    if (
      !window.confirm(
        "Parar TODAS as automações?\n\nDrena a fila da empresa e fecha browsers ativos.",
      )
    ) {
      return;
    }
    setActionError(null);
    setStoppingAll(true);
    const result = await apiRequest<{
      stopAllSignaled: boolean;
      removedQueuedJobs: number;
      applicantsSignaled: number;
      resetToReady: number;
    }>("/api/applicants/stop-all", { method: "POST", body: JSON.stringify({}) });
    setStoppingAll(false);
    if (result.success) {
      window.alert(
        `Parado: ${result.data.removedQueuedJobs} job(s) removidos da fila, ${result.data.applicantsSignaled} sinalizado(s), ${result.data.resetToReady} voltou para READY_TO_START.`,
      );
      await load({ silent: true });
    } else {
      setActionError(result.error.message);
    }
  }

  async function handlePurgeVeriff() {
    if (
      !window.confirm(
        "Apagar TODOS os Veriff?\n\nSocure permanece. Os e-mails ficam gravados e não poderão ser reimportados. Perfis, cookies e screenshots desses motoristas são removidos.",
      )
    ) {
      return;
    }
    setActionError(null);
    setPurgingVeriff(true);
    try {
      const result = await apiRequest<{ deleted: number; emailsReserved: number }>(
        "/api/applicants/purge-veriff",
        { method: "POST", body: JSON.stringify({}) },
      );
      if (result.success) {
        window.alert(
          `Veriff apagados: ${result.data.deleted}. E-mails reservados: ${result.data.emailsReserved}.`,
        );
        await load({ silent: true });
      } else {
        const msg = result.error.message || result.error.code || "Falha ao apagar Veriff";
        setActionError(msg);
        window.alert(`Erro ao apagar Veriff: ${msg}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setActionError(msg);
      window.alert(`Erro ao apagar Veriff: ${msg}`);
    } finally {
      setPurgingVeriff(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Motoristas importados</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {total} motorista{total === 1 ? "" : "s"}
            {livePolling ? " · atualizando a cada 3s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            title="Gera e-mails @mailsproton.com novos e enfileira (Senha Sobrenome@2026)"
          >
            Gerar e enfileirar
          </button>
          <button
            type="button"
            onClick={() => setBatchOpen(true)}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
          >
            Start lote
            {checkedIds.size > 0 ? ` (${checkedIds.size})` : ""}
          </button>
          <button
            type="button"
            disabled={purgingVeriff}
            onClick={() => void handlePurgeVeriff()}
            className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            title="Apaga motoristas Veriff; Socure fica; e-mails não podem ser reusados"
          >
            {purgingVeriff ? "Apagando Veriff…" : "Apagar todos os Veriff"}
          </button>
          <button
            type="button"
            disabled={stoppingAll}
            onClick={() => void handleStopAll()}
            className="rounded-md border border-red-400 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            title="Drena a fila e para browsers ativos"
          >
            {stoppingAll ? "Parando todos…" : "Parar todos"}
          </button>
          <button
            type="button"
            onClick={() => load()}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Atualizar
          </button>
        </div>
      </div>

      {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Buscar
          </span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Nome, e-mail ou ID externo"
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Status
          </span>
          <select
            value={status}
            onChange={(e) => applyStatus(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {STATUS_FILTERS.map((opt) => (
              <option key={opt.id || "all"} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Motivo
          </span>
          <select
            value={pauseReason}
            onChange={(e) => applyPauseReason(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {PAUSE_FILTERS.map((opt) => (
              <option key={opt.id || "all"} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Por página
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => applyPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            {(q || status || pauseReason) && (
              <button
                type="button"
                onClick={clearFilters}
                className="shrink-0 text-xs font-medium text-slate-600 hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
        </label>
      </div>

      {loading && applicants.length === 0 && (
        <p className="text-sm text-slate-500">Carregando...</p>
      )}
      {!loading && applicants.length === 0 && (
        <p className="text-sm text-slate-500">
          {q || status || pauseReason
            ? "Nenhum motorista encontrado com esses filtros."
            : "Nenhum motorista importado ainda."}
        </p>
      )}

      {applicants.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-2">
                <input
                  type="checkbox"
                  checked={allBatchSelected}
                  onChange={toggleSelectAllBatch}
                  title="Selecionar elegíveis desta página"
                  aria-label="Selecionar elegíveis desta página"
                />
              </th>
              <th className="py-2">ID externo</th>
              <th className="py-2">Nome</th>
              <th className="py-2">Status</th>
              <th className="py-2">Motivo</th>
              <th className="py-2">Etapa</th>
              <th className="py-2">Cidade proxy</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {applicants.map((applicant) => (
              <tr key={applicant.id}>
                <td className="py-2 pr-2">
                  {BATCH_STARTABLE_STATUSES.has(applicant.status) &&
                  applicant.pauseReason !== "REFUSED" ? (
                    <input
                      type="checkbox"
                      checked={checkedIds.has(applicant.id)}
                      onChange={() => toggleCheck(applicant.id)}
                      aria-label={`Selecionar ${applicant.fullName}`}
                    />
                  ) : (
                    <span className="inline-block w-4" />
                  )}
                </td>
                <td className="py-2 text-slate-500">{applicant.externalId}</td>
                <td className="py-2 text-slate-800">
                  <div>{applicant.fullName}</div>
                  {applicant.email && (
                    <div className="text-xs font-normal text-slate-400">{applicant.email}</div>
                  )}
                </td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      STATUS_STYLES[applicant.status] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {applicant.status}
                  </span>
                </td>
                <td className="py-2 text-xs text-slate-600">
                  {applicant.pauseReason ? pauseReasonLabel(applicant.pauseReason) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2 text-xs text-slate-600">
                  {applicant.status === "IN_PROGRESS" || applicant.currentStep ? (
                    <span className={applicant.status === "IN_PROGRESS" ? "font-medium text-blue-700" : ""}>
                      {liveStepLabel(applicant.currentStep)}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td
                  className="py-2 text-xs text-slate-600"
                  title={applicant.proxyExternalIp ?? undefined}
                >
                  {formatProxyGeoLabel(applicant.proxyGeoCity, applicant.proxyGeoRegion)}
                </td>
                <td className="py-2 text-right space-x-2 whitespace-nowrap">
                  {applicant.status === "IN_PROGRESS" && (
                    <button
                      type="button"
                      disabled={stoppingId === applicant.id || stoppingAll}
                      onClick={() => void handleStopAutomation(applicant)}
                      className="rounded-md border border-red-400 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {stoppingId === applicant.id ? "Parando…" : "Parar"}
                    </button>
                  )}
                  {LOGGABLE_STATUSES.has(applicant.status) && (
                    <Link
                      href={`/dashboard/pending-actions/${applicant.id}`}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {applicant.status === "IN_PROGRESS" ? "Ver progresso" : "Ver log/erro"}
                    </Link>
                  )}
                  {applicant.status !== "NEW" && (
                    <button
                      type="button"
                      disabled={downloadingId === applicant.id}
                      onClick={() => handleDownloadCookies(applicant)}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {downloadingId === applicant.id ? "Baixando…" : "Baixar cookies"}
                    </button>
                  )}
                  {applicant.status !== "NEW" && (
                    <>
                      <button
                        type="button"
                        disabled={
                          openingBrowserId === applicant.id || closingBrowserId === applicant.id
                        }
                        onClick={() => handleOpenManualBrowser(applicant)}
                        className="rounded-md border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        {openingBrowserId === applicant.id ? "Abrindo…" : "Abrir browser"}
                      </button>
                      <button
                        type="button"
                        disabled={
                          openingBrowserId === applicant.id || closingBrowserId === applicant.id
                        }
                        onClick={() => handleCloseManualBrowser(applicant)}
                        className="rounded-md border border-slate-400 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {closingBrowserId === applicant.id ? "Fechando…" : "Fechar browser"}
                      </button>
                    </>
                  )}
                  {STARTABLE_STATUSES.has(applicant.status) && (
                    <button
                      type="button"
                      onClick={() => setSelected(applicant)}
                      className="rounded-md border border-brand-500 px-3 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
                    >
                      Iniciar automação
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={deletingId === applicant.id}
                    onClick={() => handleDelete(applicant)}
                    className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === applicant.id ? "Apagando…" : "Excluir"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
          <p>
            Mostrando {rangeStart}–{rangeEnd} de {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {selected && (
        <StartAutomationModal
          applicantId={selected.id}
          applicantName={selected.fullName}
          onClose={() => setSelected(null)}
          onStarted={load}
        />
      )}

      {batchOpen && (
        <StartBatchModal
          selectedCount={checkedIds.size}
          selectedIds={[...checkedIds]}
          onClose={() => setBatchOpen(false)}
          onStarted={() => {
            setCheckedIds(new Set());
            void load();
          }}
        />
      )}

      {generateOpen && (
        <GenerateBatchModal
          onClose={() => setGenerateOpen(false)}
          onStarted={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}
