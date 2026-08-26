"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/apiClient";

interface GenerateBatchResult {
  requested: number;
  imported: number;
  enqueued: Array<{
    applicantId: string;
    fullName: string;
    email: string;
    jobId: string;
    proxyId: string;
  }>;
  skipped: Array<{ email?: string; fullName?: string; reason: string }>;
  activeProxyCount: number;
}

export function GenerateBatchModal({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: () => void;
}) {
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateBatchResult | null>(null);

  async function handleSubmit() {
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setError("Informe uma quantidade entre 1 e 100.");
      return;
    }
    setLoading(true);
    setError(null);
    const response = await apiRequest<GenerateBatchResult>("/api/applicants/generate-batch", {
      method: "POST",
      body: JSON.stringify({ count }),
    });
    setLoading(false);
    if (response.success) {
      setResult(response.data);
      onStarted();
    } else {
      setError(response.error.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Gerar e enfileirar</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cria e-mails novos no domínio configurado em <strong>Configurações</strong> (inéditos),
          importa e enfileira no rodízio dos proxies ACTIVE. Senha Uber:{" "}
          <strong>Sobrenome@2026</strong> (por motorista).
        </p>

        {!result && (
          <>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Quantidade (1–100)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                onClick={() => void handleSubmit()}
                disabled={loading || !Number.isInteger(count) || count < 1 || count > 100}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {loading ? "Gerando…" : "Gerar e enfileirar"}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Pedidos: <strong>{result.requested}</strong> · Importados:{" "}
              <strong>{result.imported}</strong> · Enfileirados:{" "}
              <strong>{result.enqueued.length}</strong> · Pulados:{" "}
              <strong>{result.skipped.length}</strong> · Proxies ACTIVE:{" "}
              <strong>{result.activeProxyCount}</strong>
            </p>
            {result.skipped.length > 0 && (
              <ul className="mt-3 max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                {result.skipped.slice(0, 30).map((s, i) => (
                  <li key={`${s.email ?? s.fullName ?? "skip"}-${i}`}>
                    {s.fullName ?? s.email ?? "?"}: {s.reason}
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
