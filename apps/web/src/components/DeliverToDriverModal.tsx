"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/apiClient";
import type { PendingActionView } from "@/lib/pendingActions";

const EXPIRATION_OPTIONS = [
  { label: "1 hora", seconds: 3600 },
  { label: "6 horas", seconds: 6 * 3600 },
  { label: "24 horas", seconds: 24 * 3600 },
  { label: "3 dias", seconds: 3 * 24 * 3600 },
  { label: "7 dias", seconds: 7 * 24 * 3600 },
];

export function DeliverToDriverModal({
  pendingAction,
  onClose,
  onDelivered,
}: {
  pendingAction: PendingActionView;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const [expiresIn, setExpiresIn] = useState(EXPIRATION_OPTIONS[2]!.seconds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ deliveryLink: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    const response = await apiRequest<{ deliveryLink: string; expiresAt: string }>(
      `/api/pending-actions/${pendingAction.id}/deliver`,
      { method: "POST", body: JSON.stringify({ expiresIn }) },
    );
    setLoading(false);
    if (response.success) {
      setResult(response.data);
      onDelivered();
    } else {
      setError(response.error.message);
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.deliveryLink).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Entregar ao motorista</h2>
        <p className="mt-1 text-sm text-slate-500">
          Gera um link seguro e temporário para <strong>{pendingAction.applicantName}</strong>{" "}
          concluir pessoalmente a etapa pendente diretamente na plataforma. Este link nunca dá
          acesso a uma sessão de automação - é só uma página informativa com instruções.
        </p>

        {!result && (
          <>
            <label className="mt-4 block text-sm font-medium text-slate-700">Expira em</label>
            <select
              value={expiresIn}
              onChange={(event) => setExpiresIn(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {EXPIRATION_OPTIONS.map((option) => (
                <option key={option.seconds} value={option.seconds}>
                  {option.label}
                </option>
              ))}
            </select>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {loading ? "Gerando..." : "Gerar link"}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="break-all text-sm text-slate-800">{result.deliveryLink}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Expira em {new Date(result.expiresAt).toLocaleString("pt-BR")}. Copie o link e envie
              ao motorista pelo canal de sua preferência (e-mail, SMS, WhatsApp) - o envio
              automático por e-mail ainda não está implementado (ver README do painel).
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Fechar
              </button>
              <button
                onClick={handleCopy}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                {copied ? "Copiado!" : "Copiar link"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
