"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/apiClient";

interface ProxyOption {
  id: string;
  protocol: string;
  port: number;
  declaredRegion: string | null;
}

export function StartAutomationModal({
  applicantId,
  applicantName,
  onClose,
  onStarted,
}: {
  applicantId: string;
  applicantName: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [proxies, setProxies] = useState<ProxyOption[]>([]);
  const [proxyId, setProxyId] = useState("");
  const [platformPassword, setPlatformPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    apiRequest<ProxyOption[]>("/api/proxies").then((result) => {
      if (result.success) {
        setProxies(result.data);
        if (result.data[0]) setProxyId(result.data[0].id);
      }
    });
  }, []);

  async function handleSubmit() {
    if (!proxyId || !platformPassword) return;
    setLoading(true);
    setError(null);
    const result = await apiRequest<{ jobId: string }>(
      `/api/applicants/${applicantId}/start-automation`,
      { method: "POST", body: JSON.stringify({ proxyId, platformPassword }) },
    );
    setLoading(false);
    if (result.success) {
      setStarted(true);
      onStarted();
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Iniciar automação</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enfileira o cadastro administrativo de <strong>{applicantName}</strong>. A automação para
          automaticamente ao encontrar qualquer etapa sensível (foto, CNH, CAPTCHA, 2FA) - nunca a
          conclui sozinha.
        </p>

        {!started && (
          <>
            <label className="mt-4 block text-sm font-medium text-slate-700">Proxy</label>
            <select
              value={proxyId}
              onChange={(event) => setProxyId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {proxies.length === 0 && <option value="">Nenhum proxy cadastrado</option>}
              {proxies.map((proxy) => (
                <option key={proxy.id} value={proxy.id}>
                  {proxy.protocol}://***:{proxy.port} {proxy.declaredRegion ?? ""}
                </option>
              ))}
            </select>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              Senha de login da plataforma
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
                onClick={onClose}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !proxyId || !platformPassword}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {loading ? "Enfileirando..." : "Iniciar"}
              </button>
            </div>
          </>
        )}

        {started && (
          <>
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Automação enfileirada. Acompanhe o status na lista de motoristas ou, se pausar, na
              Central de Pendências.
            </p>
            <div className="mt-4 flex justify-end">
              <button
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
