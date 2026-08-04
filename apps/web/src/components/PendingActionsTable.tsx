"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/apiClient";
import { pauseReasonLabel, type PendingActionView } from "@/lib/pendingActions";
import { DeliverToDriverModal } from "./DeliverToDriverModal";

const PROVIDER_LABELS: Record<string, string> = {
  SOCURE: "Socure",
  VERIFF: "Veriff",
  NOT_SOCURE: "Outro provedor",
  OTHER_PROVIDER: "Outro provedor",
  UNKNOWN: "Desconhecido",
};

function providerCell(provider: string | null, confidence: string | null) {
  if (!provider) return <span className="text-slate-400">-</span>;
  return (
    <span>
      {PROVIDER_LABELS[provider] ?? provider}
      {confidence && <span className="ml-1 text-xs text-slate-400">({confidence})</span>}
    </span>
  );
}

export function PendingActionsTable() {
  const [items, setItems] = useState<PendingActionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<PendingActionView | null>(null);

  const reload = useCallback(async () => {
    const result = await apiRequest<{ items: PendingActionView[] }>("/api/pending-actions");
    if (result.success) {
      setItems(result.data.items);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function runAction(id: string, action: "RESOLVED" | "CANCELLED" | "MANUAL_REVIEW") {
    setBusyId(id);
    await apiRequest(`/api/pending-actions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    await reload();
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!items) {
    return <p className="text-sm text-slate-500">Carregando...</p>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-500">
          Nenhuma pendência no momento - toda a automação está em dia.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Motorista</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Motivo</th>
              <th className="px-4 py-3">Foto</th>
              <th className="px-4 py-3">CNH</th>
              <th className="px-4 py-3">Pausado em</th>
              <th className="px-4 py-3">Operador</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  <Link href={`/dashboard/pending-actions/${item.id}`} className="hover:underline">
                    {item.applicantName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{item.email}</td>
                <td className="px-4 py-3 text-slate-600">{item.currentStep ?? "-"}</td>
                <td className="px-4 py-3 text-slate-600">{pauseReasonLabel(item.pauseReason)}</td>
                <td className="px-4 py-3">
                  {providerCell(item.profilePhotoProvider, item.profilePhotoConfidence)}
                </td>
                <td className="px-4 py-3">
                  {providerCell(item.driverLicenseProvider, item.driverLicenseConfidence)}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {item.pausedAt ? new Date(item.pausedAt).toLocaleString("pt-BR") : "-"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {item.assignedOperatorName ?? "Não atribuído"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      disabled={busyId === item.id}
                      onClick={() => setDeliverTarget(item)}
                      className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
                    >
                      Entregar
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => runAction(item.id, "MANUAL_REVIEW")}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Revisar
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => runAction(item.id, "RESOLVED")}
                      className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      Resolver
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => runAction(item.id, "CANCELLED")}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deliverTarget && (
        <DeliverToDriverModal
          pendingAction={deliverTarget}
          onClose={() => setDeliverTarget(null)}
          onDelivered={reload}
        />
      )}
    </>
  );
}
