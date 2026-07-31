"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/apiClient";

interface ImapTestResult {
  success: boolean;
  latencyMs: number | null;
  error?: string;
}

interface ImapPreset {
  label: string;
  host: string;
  port: number;
}

/**
 * Presets dos provedores IMAP mais comuns - "Personalizado" libera os
 * campos de host/porta pra qualquer outro (cPanel, servidor próprio, etc).
 * Google Workspace em domínio próprio (ex: colsced.us, cecb.us) também usa
 * imap.gmail.com, então "Gmail / Google Workspace" cobre isso mesmo sem
 * "gmail.com" estar no e-mail.
 */
const PRESETS: Record<string, ImapPreset | null> = {
  gmail: { label: "Gmail / Google Workspace", host: "imap.gmail.com", port: 993 },
  outlook: { label: "Outlook / Microsoft 365", host: "outlook.office365.com", port: 993 },
  yahoo: { label: "Yahoo", host: "imap.mail.yahoo.com", port: 993 },
  custom: null,
};

/**
 * Testa se um e-mail aceita IMAP com a senha direta ANTES de importar um
 * lote inteiro - na prática, contas do mesmo fornecedor podem ter políticas
 * diferentes (2FA/"less secure apps" bloqueando IMAP em algumas, liberado em
 * outras). Não salva nada, só confirma se dá pra ler o e-mail por esse
 * caminho - mesmo espírito do "Testar" da tela de proxies. Funciona pra
 * qualquer provedor IMAP, não só Gmail.
 */
export function ImapTestPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState<keyof typeof PRESETS>("gmail");
  const [host, setHost] = useState(PRESETS.gmail!.host);
  const [port, setPort] = useState(PRESETS.gmail!.port);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ImapTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleProviderChange(value: keyof typeof PRESETS) {
    setProvider(value);
    const preset = PRESETS[value];
    if (preset) {
      setHost(preset.host);
      setPort(preset.port);
    }
  }

  async function handleTest() {
    if (!email.trim() || !password.trim() || !host.trim()) return;
    setTesting(true);
    setError(null);
    setResult(null);

    const response = await apiRequest<ImapTestResult>("/api/email-accounts/test-imap", {
      method: "POST",
      body: JSON.stringify({ email, password, host, port }),
    });

    setTesting(false);
    if (response.success) {
      setResult(response.data);
    } else {
      setError(response.error.message);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Testar acesso IMAP de um e-mail</h2>
      <p className="mt-1 text-sm text-slate-500">
        Confirma se esse e-mail aceita leitura via IMAP com a senha normal antes de importar o
        lote inteiro. Funciona com qualquer provedor IMAP, não só Gmail. Nada é salvo aqui - é só
        um teste de conexão.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="motorista@dominio.com"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Senha"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={provider}
          onChange={(event) => handleProviderChange(event.target.value as keyof typeof PRESETS)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {Object.entries(PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset?.label ?? "Personalizado (outro provedor)"}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={host}
          onChange={(event) => {
            setProvider("custom");
            setHost(event.target.value);
          }}
          placeholder="Servidor IMAP (ex: imap.exemplo.com)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={port}
          onChange={(event) => {
            setProvider("custom");
            setPort(Number(event.target.value));
          }}
          placeholder="Porta"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        onClick={handleTest}
        disabled={testing || !email.trim() || !password.trim() || !host.trim()}
        className="mt-3 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      >
        {testing ? "Testando..." : "Testar"}
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result?.success && (
        <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          IMAP funcionou - conectou em {result.latencyMs}ms. Pode importar esse lote.
        </p>
      )}

      {result && !result.success && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          IMAP falhou: {result.error ?? "erro desconhecido"}
        </p>
      )}
    </div>
  );
}
