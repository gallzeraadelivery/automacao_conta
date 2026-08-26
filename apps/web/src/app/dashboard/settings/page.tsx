"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/apiClient";

interface CompanySettings {
  placeholderPhoneBase: string;
  placeholderPhonePreview: string;
  earnCity: string;
  signupEmailDomain: string;
  signupEmailProvider: string;
  catchallInboxEmail: string;
  catchallDomains: string;
  catchallPasswordSet: boolean;
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
  const [signupEmailDomain, setSignupEmailDomain] = useState("");
  const [signupEmailProvider, setSignupEmailProvider] = useState("spacemail");
  const [catchallInboxEmail, setCatchallInboxEmail] = useState("");
  const [catchallDomains, setCatchallDomains] = useState("");
  const [catchallPassword, setCatchallPassword] = useState("");
  const [catchallPasswordSet, setCatchallPasswordSet] = useState(false);

  const preview = useMemo(() => formatPreview(phoneBase), [phoneBase]);

  const applySettings = useCallback((data: CompanySettings) => {
    setPhoneBase(data.placeholderPhoneBase);
    setEarnCity(data.earnCity);
    setSignupEmailDomain(data.signupEmailDomain);
    setSignupEmailProvider(data.signupEmailProvider);
    setCatchallInboxEmail(data.catchallInboxEmail);
    setCatchallDomains(data.catchallDomains);
    setCatchallPasswordSet(data.catchallPasswordSet);
    setCatchallPassword("");
    setSource(data.source);
    setUpdatedAt(data.updatedAt);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<CompanySettings>("/api/settings");
    setLoading(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    applySettings(result.data);
  }, [applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    const body: Record<string, string> = {
      placeholderPhoneBase: phoneBase.replace(/\D/g, ""),
      earnCity: earnCity.trim(),
      signupEmailDomain: signupEmailDomain.trim().toLowerCase(),
      signupEmailProvider: signupEmailProvider.trim().toLowerCase(),
      catchallInboxEmail: catchallInboxEmail.trim().toLowerCase(),
      catchallDomains: catchallDomains.trim().toLowerCase(),
    };
    if (catchallPassword.trim()) {
      body.catchallPassword = catchallPassword.trim();
    }
    const result = await apiRequest<CompanySettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    applySettings(result.data);
    setSavedMsg("Configurações salvas. Domínio/catch-all valem no próximo lote e OTP (sem rebuild).");
  }

  const canSave =
    phoneBase.replace(/\D/g, "").length === 10 &&
    earnCity.trim().length >= 2 &&
    signupEmailDomain.trim().length >= 3 &&
    signupEmailProvider.trim().length >= 2 &&
    catchallInboxEmail.includes("@") &&
    catchallDomains.trim().length >= 3 &&
    (catchallPasswordSet || catchallPassword.trim().length > 0);

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
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">E-mail / catch-all IMAP</h2>
            <p className="mt-1 text-xs text-slate-500">
              Domínio dos e-mails gerados no lote e caixa onde o OTP é lido.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Domínio de e-mail (signup)</label>
            <input
              type="text"
              value={signupEmailDomain}
              onChange={(e) => setSignupEmailDomain(e.target.value.toLowerCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              placeholder="mailsproton.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Provider IMAP</label>
            <select
              value={signupEmailProvider}
              onChange={(e) => setSignupEmailProvider(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="spacemail">spacemail</option>
              <option value="gmail">gmail</option>
              <option value="outlook">outlook</option>
              <option value="yahoo">yahoo</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Login catch-all (caixa IMAP)</label>
            <input
              type="email"
              value={catchallInboxEmail}
              onChange={(e) => setCatchallInboxEmail(e.target.value.toLowerCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              placeholder="galldelivery@mail2too.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Senha catch-all
              {catchallPasswordSet ? (
                <span className="ml-2 font-normal text-emerald-700">(já cadastrada — deixe em branco para manter)</span>
              ) : (
                <span className="ml-2 font-normal text-amber-700">(obrigatória na 1ª vez)</span>
              )}
            </label>
            <input
              type="password"
              value={catchallPassword}
              onChange={(e) => setCatchallPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder={catchallPasswordSet ? "••••••••" : "Senha da caixa IMAP"}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Domínios que usam o catch-all (CSV)
            </label>
            <input
              type="text"
              value={catchallDomains}
              onChange={(e) => setCatchallDomains(e.target.value.toLowerCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              placeholder="mailsproton.com,mail2too.com"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Qualquer e-mail nesses domínios lê OTP na caixa catch-all acima.
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
              disabled={saving || !canSave}
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
