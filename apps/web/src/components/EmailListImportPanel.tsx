"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/apiClient";

interface PreviewRow {
  row: number;
  data: { externalId: string; email: string; firstName: string; lastName: string };
}

interface InvalidRow {
  row: number;
  data: unknown;
  errors: { row: number; field?: string; message: string }[];
}

interface ValidationResult {
  validRows: PreviewRow[];
  invalidRows: InvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number };
}

interface ImportResult {
  imported: number;
  skipped: number;
  invalidRows: InvalidRow[];
}

const EMAIL_PROVIDERS = [
  { value: "gmail", label: "Gmail / Google Workspace" },
  { value: "spacemail", label: "Spacemail" },
  { value: "outlook", label: "Outlook / Microsoft 365" },
  { value: "yahoo", label: "Yahoo" },
] as const;

const PLACEHOLDER = `TrixCordova6o365@colsced.us|Phat3479
AerielSchneider06a5b@colsced.us|Phat3479
KaylaTorres1ubd6@colsced.us|Phat3479`;

/**
 * Importa motorista + conta de e-mail JUNTOS a partir de uma lista colada
 * "email|senha" (uma por linha) - o nome do motorista é extraído do próprio
 * e-mail (ver extractNameFromLocalPart no backend). Diferente de
 * ImportPanel.tsx (upload de arquivo CSV/XLSX com colunas fixas).
 */
export function EmailListImportPanel() {
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<(typeof EMAIL_PROVIDERS)[number]["value"]>("gmail");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleValidate() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setImportResult(null);

    const result = await apiRequest<ValidationResult>("/api/applicants/validate-email-list-import", {
      method: "POST",
      body: JSON.stringify({ text, provider }),
    });

    setLoading(false);
    if (result.success) {
      setValidation(result.data);
    } else {
      setError(result.error.message);
    }
  }

  async function handleImport() {
    setLoading(true);
    setError(null);

    const result = await apiRequest<ImportResult>("/api/applicants/email-list-import", {
      method: "POST",
      body: JSON.stringify({ text, provider }),
    });

    setLoading(false);
    if (result.success) {
      setImportResult(result.data);
      setValidation(null);
      setText("");
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">
        Importar motoristas a partir de lista de e-mails
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Cole uma linha por motorista, no formato <code>email|senha</code>. O nome é extraído
        automaticamente do próprio e-mail (ex: &quot;TrixCordova6o365@...&quot; vira &quot;Trix
        Cordova&quot;) — revise o preview antes de confirmar, a extração é melhor esforço. Escolha
        o provedor IMAP certo (ex: Spacemail) para a automação ler o código de verificação.
      </p>

      <label className="mt-3 block text-sm text-slate-700">
        Provedor de e-mail (IMAP)
        <select
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value as (typeof EMAIL_PROVIDERS)[number]["value"])
          }
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:max-w-xs"
        >
          {EMAIL_PROVIDERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PLACEHOLDER}
        rows={8}
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
      />

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleValidate}
          disabled={loading || !text.trim()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? "Validando..." : "Validar"}
        </button>
        {validation && validation.summary.validCount > 0 && (
          <button
            onClick={handleImport}
            disabled={loading}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {loading ? "Importando..." : `Importar ${validation.summary.validCount} motorista(s)`}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {importResult && (
        <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {importResult.imported} motorista(s) importado(s)
          {importResult.skipped > 0 ? `, ${importResult.skipped} linha(s) ignorada(s)` : ""}.
        </p>
      )}

      {validation && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">
            {validation.summary.validCount} válida(s), {validation.summary.invalidCount}{" "}
            inválida(s) de {validation.summary.totalRows} linha(s). Provedor: {provider}.
          </p>

          {validation.validRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Linha</th>
                    <th className="px-4 py-2">Nome extraído</th>
                    <th className="px-4 py-2">E-mail</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.validRows.map((row) => (
                    <tr key={row.row} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-500">{row.row}</td>
                      <td className="px-4 py-2 text-slate-700">
                        {row.data.firstName} {row.data.lastName}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{row.data.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {validation.invalidRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-red-200">
              <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">
                Linhas inválidas
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-red-50 text-xs uppercase text-red-700">
                  <tr>
                    <th className="px-4 py-2">Linha</th>
                    <th className="px-4 py-2">Erros</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.invalidRows.map((row) => (
                    <tr key={row.row} className="border-t border-red-100">
                      <td className="px-4 py-2 align-top text-slate-500">{row.row}</td>
                      <td className="px-4 py-2 text-red-700">
                        <ul className="list-disc space-y-1 pl-4">
                          {row.errors.map((err, idx) => (
                            <li key={idx}>
                              {err.field ? `${err.field}: ` : ""}
                              {err.message}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
