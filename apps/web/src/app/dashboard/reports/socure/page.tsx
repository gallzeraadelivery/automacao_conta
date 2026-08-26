"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiDownload, apiRequest } from "@/lib/apiClient";
import {
  type VerificationProviderFilter,
  type VerificationReport,
  type VerificationReportRow,
} from "@/lib/reports";
import { pauseReasonLabel } from "@/lib/pendingActions";
import { formatProxyGeoLabel } from "@/lib/proxyGeo";

const PROVIDER_LABELS: Record<string, string> = {
  SOCURE: "Socure",
  VERIFF: "Veriff",
  NOT_SOCURE: "Outro",
  OTHER_PROVIDER: "Outro",
  UNKNOWN: "Desconhecido",
};

const FILTERS: Array<{ id: VerificationProviderFilter; label: string }> = [
  { id: "socure", label: "Só Socure" },
  { id: "veriff", label: "Veriff" },
  { id: "all", label: "Todos" },
];

function providerLabel(provider: string | null, confidence: string | null) {
  if (!provider) return <span className="text-slate-400">-</span>;
  return (
    <span>
      {PROVIDER_LABELS[provider] ?? provider}
      {confidence ? <span className="ml-1 text-xs text-slate-400">({confidence})</span> : null}
    </span>
  );
}

export default function SocureReportPage() {
  const [filter, setFilter] = useState<VerificationProviderFilter>("socure");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async (provider: VerificationProviderFilter) => {
    setError(null);
    const result = await apiRequest<VerificationReport>(
      `/api/reports/verification?provider=${provider}`,
    );
    if (result.success) {
      setReport(result.data);
      setSelected(new Set());
    } else {
      setReport(null);
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const items = report?.items ?? [];
  const notDownloadedIds = useMemo(
    () => items.filter((row) => !row.cookiesDownloadedAt).map((row) => row.id),
    [items],
  );
  const allSelected = items.length > 0 && items.every((row) => selected.has(row.id));
  const selectedCount = selected.size;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((row) => row.id)));
  }

  function selectNotDownloaded() {
    setSelected(new Set(notDownloadedIds));
  }

  async function markDownloaded(ids: string[], downloaded: boolean) {
    if (ids.length === 0) return;
    setActionError(null);
    const result = await apiRequest<{ updated: number }>("/api/applicants/cookies-downloaded", {
      method: "PATCH",
      body: JSON.stringify({ applicantIds: ids, downloaded }),
    });
    if (!result.success) {
      setActionError(result.error.message);
      return;
    }
    setReport((prev) => {
      if (!prev) return prev;
      const stamp = downloaded ? new Date().toISOString() : null;
      return {
        ...prev,
        items: prev.items.map((row) =>
          ids.includes(row.id) ? { ...row, cookiesDownloadedAt: stamp } : row,
        ),
      };
    });
  }

  async function handleDownload(row: VerificationReportRow) {
    setActionError(null);
    setDownloadingId(row.id);
    const ok = await apiDownload(
      `/api/applicants/${row.id}/uber-cookies`,
      `adspower-cookies-${row.externalId}.json`,
    );
    setDownloadingId(null);
    if (!ok) {
      setActionError(
        `Não foi possível baixar cookies de ${row.fullName} (sessão vazia ou não persistida).`,
      );
      return;
    }
    setReport((prev) => {
      if (!prev) return prev;
      const stamp = new Date().toISOString();
      return {
        ...prev,
        items: prev.items.map((r) =>
          r.id === row.id ? { ...r, cookiesDownloadedAt: stamp } : r,
        ),
      };
    });
  }

  async function handleZipDownload(ids: string[], label: string) {
    if (ids.length === 0) {
      setActionError(`Nenhum motorista para ${label}.`);
      return;
    }
    setActionError(null);
    setBulkBusy(true);
    const stamp = new Date().toISOString().slice(0, 10);
    const ok = await apiDownload(`/api/reports/verification/cookies-zip`, `socure-cookies-${stamp}.zip`, {
      method: "POST",
      body: { applicantIds: ids },
    });
    setBulkBusy(false);
    if (!ok) {
      setActionError(
        `Falha ao baixar ZIP (${label}). Verifique se há cookies persistidos na seleção.`,
      );
      return;
    }
    await load(filter);
  }

  const counts = report?.counts ?? { socure: 0, veriff: 0, all: 0 };
  const downloadedCount = items.filter((row) => row.cookiesDownloadedAt).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Relatório Socure</h1>
        <p className="text-sm text-slate-500">
          Motoristas com verificação detectada. Marque cookies já baixados e baixe todos, só os
          selecionados ou só os ainda não baixados (ZIP AdsPower).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Socure</p>
          <p className="mt-1 text-2xl font-semibold text-brand-700">{counts.socure}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Veriff</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">{counts.veriff}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Com probe</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">{counts.all}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Cookies baixados</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">
            {downloadedCount}
            <span className="ml-1 text-base font-normal text-slate-400">/ {items.length}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((chip) => {
          const active = filter === chip.id;
          const count =
            chip.id === "socure" ? counts.socure : chip.id === "veriff" ? counts.veriff : counts.all;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {chip.label}
              <span className={`ml-1.5 tabular-nums ${active ? "text-brand-100" : "text-slate-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-sm text-slate-500">
          Exibindo <strong className="text-slate-800">{report?.total ?? 0}</strong>
        </span>
      </div>

      {report && report.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <button
            type="button"
            disabled={bulkBusy || notDownloadedIds.length === 0}
            onClick={() => selectNotDownloaded()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Selecionar não baixados ({notDownloadedIds.length})
          </button>
          <button
            type="button"
            disabled={bulkBusy || selectedCount === 0}
            onClick={() => void handleZipDownload([...selected], "selecionados")}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {bulkBusy ? "Baixando…" : `Baixar selecionados (${selectedCount})`}
          </button>
          <button
            type="button"
            disabled={bulkBusy || items.length === 0}
            onClick={() => void handleZipDownload(items.map((r) => r.id), "todos")}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Baixar todos ZIP
          </button>
          <button
            type="button"
            disabled={bulkBusy || notDownloadedIds.length === 0}
            onClick={() => void handleZipDownload(notDownloadedIds, "não baixados")}
            className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50"
          >
            Baixar não baixados ZIP ({notDownloadedIds.length})
          </button>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button
            type="button"
            disabled={bulkBusy || selectedCount === 0}
            onClick={() => void markDownloaded([...selected], true)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Marcar como baixados
          </button>
          <button
            type="button"
            disabled={bulkBusy || selectedCount === 0}
            onClick={() => void markDownloaded([...selected], false)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Marcar como não baixados
          </button>
        </div>
      ) : null}

      {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!report && !error ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : report && report.items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">Nenhum motorista neste filtro.</p>
        </div>
      ) : report ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => toggleAll()}
                    aria-label="Selecionar todos"
                  />
                </th>
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Cidade proxy</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Foto</th>
                <th className="px-4 py-3">CNH</th>
                <th className="px-4 py-3">Pausado em</th>
                <th className="px-4 py-3">Baixado</th>
                <th className="px-4 py-3">Cookies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.items.map((row) => {
                const isDownloaded = Boolean(row.cookiesDownloadedAt);
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={`Selecionar ${row.fullName}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link
                        href={`/dashboard/pending-actions`}
                        className="hover:underline"
                        title={row.externalId}
                      >
                        {row.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email}</td>
                    <td className="px-4 py-3 text-slate-600" title={row.proxyExternalIp ?? undefined}>
                      {formatProxyGeoLabel(row.proxyGeoCity, row.proxyGeoRegion)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.status}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.pauseReason ? pauseReasonLabel(row.pauseReason) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {providerLabel(row.profilePhotoProvider, row.profilePhotoConfidence)}
                    </td>
                    <td className="px-4 py-3">
                      {providerLabel(row.driverLicenseProvider, row.driverLicenseConfidence)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {row.pausedAt ? new Date(row.pausedAt).toLocaleString("pt-BR") : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        title={
                          isDownloaded && row.cookiesDownloadedAt
                            ? `Baixado em ${new Date(row.cookiesDownloadedAt).toLocaleString("pt-BR")}`
                            : "Ainda não baixado"
                        }
                        onClick={() => void markDownloaded([row.id], !isDownloaded)}
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                          isDownloaded
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                        }`}
                      >
                        {isDownloaded ? "Sim" : "Não"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={downloadingId === row.id || bulkBusy}
                        onClick={() => void handleDownload(row)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {downloadingId === row.id ? "Baixando…" : "Baixar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
