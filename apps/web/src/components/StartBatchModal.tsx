"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/apiClient";

interface BatchResult {
  enqueued: Array<{ applicantId: string; fullName: string; jobId: string; proxyId: string }>;
  skipped: Array<{ applicantId: string; fullName?: string; reason: string }>;
  activeProxyCount: number;
}

export function StartBatchModal({
  selectedCount,
  selectedIds,
  onClose,
  onStarted,
}: {
  selectedCount: number;
  /** Vazio = todos elegíveis da empresa. */
  selectedIds: string[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const [platformPassword, setPlatformPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  async function handleSubmit() {
    if (!platformPassword) return;
    if (selectedIds.length === 0) {
      setError("Selecione ao menos um motorista na lista (checkbox) antes do lote.");
      return;
    }
    setLoading(true);
    setError(null);
    const response = await apiRequest<BatchResult>("/api/applicants/start-batch", {
      method: "POST",
      body: JSON.stringify({
        platformPassword,
        applicantIds: selectedIds,
      }),
    });
    setLoading(false);
    if (response.success) {
      setResult(response.data);
      onStarted();
    } else {
      setError(response.error.message);
    }
  }

  const scopeLabel = `${selectedCount} motorista(s) selecionado(s)`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Start em lote</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enfileira <strong>{scopeLabel}</strong> com rodízio dos proxies ACTIVE. O worker processa{" "}
          <strong>1 por vez</strong> (WORKER_CONCURRENCY=1). Marque os checkboxes na lista antes.
        </p>

        {!result && (
          <>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Senha de login da plataforma (mesma para o lote)
            </label>
            <input
              type="password"
              value={platformPassword}
              onChange={(event) => setPlatformPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nunca é armazenada em texto puro nem reexibida"
            />

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !platformPassword || selectedIds.length === 0}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {loading ? "Enfileirando..." : "Enfileirar lote"}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Enfileirados: <strong>{result.enqueued.length}</strong> · Pulados:{" "}
              <strong>{result.skipped.length}</strong> · Proxies ACTIVE no rodízio:{" "}
              <strong>{result.activeProxyCount}</strong>
            </p>
            {result.skipped.length > 0 && (
              <ul className="mt-3 max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                {result.skipped.slice(0, 30).map((s) => (
                  <li key={s.applicantId}>
                    {s.fullName ?? s.applicantId}: {s.reason}
                  </li>
                ))}
                {result.skipped.length > 30 && (
                  <li>… e mais {result.skipped.length - 30}</li>
                )}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
