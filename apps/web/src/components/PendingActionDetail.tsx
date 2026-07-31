"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/apiClient";
import { pauseReasonLabel, type AuditLogEntry, type PendingActionView } from "@/lib/pendingActions";
import { VerificationDetailsCard } from "./VerificationDetailsCard";
import { DeliverToDriverModal } from "./DeliverToDriverModal";

export function PendingActionDetail({ id }: { id: string }) {
  const [item, setItem] = useState<PendingActionView | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDeliver, setShowDeliver] = useState(false);
  const [screenshotState, setScreenshotState] = useState<"idle" | "loading" | "unavailable">(
    "idle",
  );

  const reload = useCallback(async () => {
    const [detailResult, logsResult] = await Promise.all([
      apiRequest<PendingActionView>(`/api/pending-actions/${id}`),
      apiRequest<{ items: AuditLogEntry[] }>(`/api/pending-actions/${id}/audit-logs`),
    ]);
    if (detailResult.success) {
      setItem(detailResult.data);
      setError(null);
    } else {
      setError(detailResult.error.message);
    }
    if (logsResult.success) {
      setLogs(logsResult.data.items);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setScreenshotState("loading");
    apiRequest(`/api/pending-actions/${id}/screenshot`).then((result) => {
      setScreenshotState(result.success ? "idle" : "unavailable");
    });
  }, [id]);

  async function runAction(action: "RESOLVED" | "CANCELLED" | "MANUAL_REVIEW") {
    setBusy(true);
    await apiRequest(`/api/pending-actions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    await reload();
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!item) return <p className="text-sm text-slate-500">Carregando...</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{item.applicantName}</h1>
            <p className="text-sm text-slate-500">{item.email}</p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            {item.status}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Telefone</dt>
            <dd className="text-slate-900">{item.phone ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Cidade</dt>
            <dd className="text-slate-900">{item.city ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Veículo</dt>
            <dd className="text-slate-900">{item.vehicleType ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Etapa atual</dt>
            <dd className="text-slate-900">{item.currentStep ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Motivo da pausa</dt>
            <dd className="text-slate-900">{pauseReasonLabel(item.pauseReason)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Pausado em</dt>
            <dd className="text-slate-900">
              {item.pausedAt ? new Date(item.pausedAt).toLocaleString("pt-BR") : "-"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Operador responsável</dt>
            <dd className="text-slate-900">{item.assignedOperatorName ?? "Não atribuído"}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => setShowDeliver(true)}
            className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
          >
            Entregar ao motorista
          </button>
          <button
            disabled={busy}
            onClick={() => runAction("MANUAL_REVIEW")}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Assumir para revisão
          </button>
          <button
            disabled={busy}
            onClick={() => runAction("RESOLVED")}
            className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Marcar como resolvida
          </button>
          <button
            disabled={busy}
            onClick={() => runAction("CANCELLED")}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Cancelar cadastro
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <VerificationDetailsCard
          type="PROFILE_PHOTO"
          provider={item.profilePhotoProvider}
          confidence={item.profilePhotoConfidence}
          detectedAt={item.pausedAt}
        />
        <VerificationDetailsCard
          type="DRIVER_LICENSE"
          provider={item.driverLicenseProvider}
          confidence={item.driverLicenseConfidence}
          detectedAt={item.pausedAt}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Screenshot da etapa (sanitizada)
        </h2>
        {screenshotState === "loading" && <p className="text-sm text-slate-500">Carregando...</p>}
        {screenshotState === "unavailable" && (
          <p className="text-sm text-slate-500">
            Esta tela ainda não exibe a screenshot diretamente - mas o worker salva uma imagem
            automaticamente quando algo pausa ou falha. Veja o caminho do arquivo no final da
            mensagem de log abaixo (texto "[screenshot: ...]") e abra a pasta{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">storage/automation-screenshots</code>{" "}
            no servidor onde o Docker está rodando.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Histórico / logs de auditoria</h2>
        {!logs || logs.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum evento registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {logs.map((log) => {
              const detail = log.metadataSanitized?.detail;
              return (
                <li key={log.id} className="py-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-700">{log.action}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(log.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {typeof detail === "string" && detail.trim() !== "" && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-600">
                      {detail}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showDeliver && (
        <DeliverToDriverModal
          pendingAction={item}
          onClose={() => setShowDeliver(false)}
          onDelivered={reload}
        />
      )}
    </div>
  );
}
