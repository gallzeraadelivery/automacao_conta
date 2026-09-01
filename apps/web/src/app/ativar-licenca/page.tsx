"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/apiClient";
import type { LicenseStatusView } from "@/lib/license-gate";

export default function ActivateLicensePage() {
  const router = useRouter();
  const [status, setStatus] = useState<LicenseStatusView | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<LicenseStatusView>("/api/license/status", { skipAuth: true }).then((result) => {
      if (!result.success) return;
      setStatus(result.data);
      if (!result.data.enabled || result.data.ok) {
        router.replace("/login");
      }
    });
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await apiRequest<LicenseStatusView>("/api/license/activate", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ licenseKey: licenseKey.trim().toUpperCase() }),
    });

    setSubmitting(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }

    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Ativar licenca</h1>
        <p className="mb-6 text-sm text-slate-500">
          Informe a chave no formato <strong>GD-XXXX-XXXX</strong> para liberar o painel e a
          automacao nesta maquina.
        </p>

        {status?.machineId && (
          <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            ID desta maquina: <code className="font-mono">{status.machineId}</code>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="licenseKey">
              Chave de licenca
            </label>
            <input
              id="licenseKey"
              type="text"
              required
              autoComplete="off"
              placeholder="GD-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm uppercase tracking-wide focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? "Ativando..." : "Ativar e continuar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Nao tem chave? Gere em{" "}
          <a
            href="https://automacao.gdapps.online"
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 hover:underline"
          >
            automacao.gdapps.online
          </a>
        </p>
      </div>
    </div>
  );
}
