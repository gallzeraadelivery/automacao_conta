"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/apiClient";
import type { LicenseStatusView } from "@/lib/license-gate";

function licenseHeadline(status: LicenseStatusView | null): string {
  if (!status) return "Verificando licenca...";
  if (!status.configured || status.status === "missing") {
    return "Sistema sem licenca ativa";
  }
  if (status.status === "expired") return "Licenca expirada";
  if (status.status === "revoked") return "Licenca revogada";
  return "Licenca invalida";
}

function licenseDescription(status: LicenseStatusView | null): string {
  if (!status) {
    return "Aguarde enquanto verificamos esta instalacao.";
  }
  if (!status.configured || status.status === "missing") {
    return "Esta maquina ainda nao foi autorizada. Procure o proprietario do sistema para obter uma chave de licenca.";
  }
  return "A licenca desta instalacao nao e valida ou foi encerrada. Procure o proprietario do sistema para solicitar uma chave nova.";
}

export default function LicenseBlockedPage() {
  const router = useRouter();
  const [status, setStatus] = useState<LicenseStatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showOwnerPanel, setShowOwnerPanel] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [activateError, setActivateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refreshStatus() {
    const result = await apiRequest<LicenseStatusView>("/api/license/status", { skipAuth: true });
    if (!result.success) {
      setLoadError(result.error.message);
      return;
    }
    setLoadError(null);
    setStatus(result.data);
    if (!result.data.enabled || result.data.ok) {
      router.replace("/login");
    }
  }

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [router]);

  async function handleActivate(event: FormEvent) {
    event.preventDefault();
    setActivateError(null);
    setSubmitting(true);

    const result = await apiRequest<LicenseStatusView>("/api/license/activate", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ licenseKey: licenseKey.trim().toUpperCase() }),
    });

    setSubmitting(false);

    if (!result.success) {
      setActivateError(result.error.message);
      return;
    }

    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <span className="text-xl font-bold">!</span>
        </div>

        <h1 className="mb-2 text-xl font-semibold text-slate-900">{licenseHeadline(status)}</h1>
        <p className="mb-4 text-sm leading-relaxed text-slate-600">{licenseDescription(status)}</p>

        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">O que fazer agora</p>
          <p className="mt-1 text-amber-900">
            Entre em contato com o <strong>proprietario do sistema</strong> e informe o ID desta
            maquina para receber ou renovar a licenca.
          </p>
        </div>

        {status?.machineId && (
          <div className="mb-6 rounded-md bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              ID desta maquina
            </p>
            <p className="mt-1 break-all font-mono text-sm text-slate-800">{status.machineId}</p>
          </div>
        )}

        {status?.licenseKeyMasked && (
          <p className="mb-4 text-xs text-slate-500">
            Chave atual: <span className="font-mono">{status.licenseKeyMasked}</span>
          </p>
        )}

        {status?.message && status.configured && !status.ok && (
          <p className="mb-4 text-xs text-slate-500">Detalhe: {status.message}</p>
        )}

        {loadError && (
          <p className="mb-4 text-sm text-red-600">
            Nao foi possivel verificar a licenca: {loadError}
          </p>
        )}

        <button
          type="button"
          onClick={() => void refreshStatus()}
          className="mb-6 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Verificar novamente
        </button>

        <div className="border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => setShowOwnerPanel((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            {showOwnerPanel ? "Ocultar area do proprietario" : "Sou o proprietario do sistema"}
          </button>

          {showOwnerPanel && (
            <form onSubmit={handleActivate} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs text-slate-600">
                Ativacao reservada ao proprietario. Informe a chave GD-XXXX-XXXX recebida no painel
                de licencas.
              </p>
              <input
                type="text"
                required
                autoComplete="off"
                placeholder="GD-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase tracking-wide focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {activateError && <p className="text-sm text-red-600">{activateError}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
              >
                {submitting ? "Ativando..." : "Ativar licenca"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
