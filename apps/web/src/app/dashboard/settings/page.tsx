"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/apiClient";

interface CompanySettings {
  placeholderPhoneBase: string;
  placeholderPhonePreview: string;
  earnCity: string;
  source: "database" | "defaults";
  updatedAt: string | null;
}

function formatPreview(digitsRaw: string): string {
  const d = digitsRaw.replace(/\D/g, "").slice(0, 10);
  if (d.length !== 10) return "—";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"database" | "defaults">("defaults");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [phoneBase, setPhoneBase] = useState("");
  const [earnCity, setEarnCity] = useState("");

  const preview = useMemo(() => formatPreview(phoneBase), [phoneBase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<CompanySettings>("/api/settings");
    setLoading(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setPhoneBase(result.data.placeholderPhoneBase);
    setEarnCity(result.data.earnCity);
    setSource(result.data.source);
    setUpdatedAt(result.data.updatedAt);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    const result = await apiRequest<CompanySettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        placeholderPhoneBase: phoneBase.replace(/\D/g, ""),
        earnCity: earnCity.trim(),
      }),
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setPhoneBase(result.data.placeholderPhoneBase);
    setEarnCity(result.data.earnCity);
    setSource(result.data.source);
    setUpdatedAt(result.data.updatedAt);
    setSavedMsg("Configurações salvas. O worker usa os valores na próxima alocação (sem rebuild).");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Configurações</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ajustes operacionais da automação. Alterações valem em runtime no worker.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Base do telefone placeholder (10 dígitos)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={phoneBase}
              onChange={(e) => setPhoneBase(e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              placeholder="5613265300"
              required
            />
            <p className="mt-1.5 text-sm text-slate-600">
              Preview: <span className="font-medium text-slate-900">{preview}</span>
              {phoneBase.replace(/\D/g, "").length === 10 ? (
                <span className="text-slate-500">
                  {" "}
                  → próximos: …{String(Number(phoneBase.replace(/\D/g, "")) + 1).slice(-4)}, …
                  {String(Number(phoneBase.replace(/\D/g, "")) + 2).slice(-4)}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Números já usados na blacklist continuam bloqueados; a sequência sobe a partir desta base.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Cidade Earn</label>
            <input
              type="text"
              value={earnCity}
              onChange={(e) => setEarnCity(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Orlando, FL"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Texto enviado na etapa de localização de ganhos (ex.: Orlando, FL).
            </p>
          </div>

          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Fonte atual:{" "}
            <span className="font-medium text-slate-700">
              {source === "database" ? "banco (painel)" : "defaults / .env"}
            </span>
            {updatedAt ? (
              <>
                {" "}
                · atualizado em {new Date(updatedAt).toLocaleString("pt-BR")}
              </>
            ) : null}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {savedMsg && <p className="text-sm text-green-700">{savedMsg}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              disabled={saving}
            >
              Recarregar
            </button>
            <button
              type="submit"
              disabled={saving || phoneBase.replace(/\D/g, "").length !== 10 || !earnCity.trim()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
