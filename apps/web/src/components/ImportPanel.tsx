"use client";

import { useState, type ChangeEvent } from "react";
import { apiRequest, getAccessToken } from "@/lib/apiClient";

interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

interface ValidRow {
  row: number;
  data: Record<string, unknown>;
}

interface InvalidRow {
  row: number;
  data: unknown;
  errors: ImportRowError[];
}

interface ValidationResult {
  validRows: ValidRow[];
  invalidRows: InvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number };
}

interface ImportResult {
  imported: number;
  skipped: number;
  invalidRows: InvalidRow[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ImportPanel({
  title,
  description,
  basePath,
  templateColumns,
}: {
  title: string;
  description: string;
  basePath: string;
  templateColumns: string[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setValidation(null);
    setImportResult(null);
    setError(null);
  }

  async function handleValidate() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setImportResult(null);

    const formData = new FormData();
    formData.append("file", file);

    const result = await apiRequest<ValidationResult>(`${basePath}/validate-import`, {
      method: "POST",
      body: formData,
    });

    setLoading(false);
    if (result.success) {
      setValidation(result.data);
    } else {
      setError(result.error.message);
    }
  }

  async function handleConfirmImport() {
    if (!file) return;
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    const result = await apiRequest<ImportResult>(`${basePath}/import`, {
      method: "POST",
      body: formData,
    });

    setLoading(false);
    if (result.success) {
      setImportResult(result.data);
      setValidation(null);
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">{description}</p>
        <p className="mt-1 text-xs text-slate-400">
          Colunas esperadas (CSV ou XLSX): {templateColumns.join(", ")}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="text-sm"
          />
          <button
            onClick={handleValidate}
            disabled={!file || loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Validar arquivo
          </button>
          <button
            onClick={handleConfirmImport}
            disabled={!file || loading || !validation || validation.validRows.length === 0}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Confirmar importação
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {importResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
          Importação concluída: <strong>{importResult.imported}</strong> registro(s) importado(s),{" "}
          <strong>{importResult.skipped}</strong> ignorado(s).
        </div>
      )}

      {validation && (
        <div className="space-y-4">
          <div className="flex gap-4 text-sm text-slate-600">
            <span>Total: {validation.summary.totalRows}</span>
            <span className="text-green-700">Válidos: {validation.summary.validCount}</span>
            <span className="text-red-700">Inválidos: {validation.summary.invalidCount}</span>
          </div>

          {validation.validRows.length > 0 && (
            <PreviewTable title="Registros válidos" rows={validation.validRows} />
          )}

          {validation.invalidRows.length > 0 && <InvalidTable rows={validation.invalidRows} />}
        </div>
      )}

      <p className="text-xs text-slate-400">
        API: {API_URL} · autenticado: {getAccessToken() ? "sim" : "não"}
      </p>
    </div>
  );
}

function PreviewTable({ title, rows }: { title: string; rows: ValidRow[] }) {
  const columns = rows[0] ? Object.keys(rows[0].data) : [];
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-900">
        {title}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Linha</th>
            {columns.map((col) => (
              <th key={col} className="px-4 py-2">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.row} className="border-t border-slate-100">
              <td className="px-4 py-2 text-slate-500">{row.row}</td>
              {columns.map((col) => (
                <td key={col} className="px-4 py-2 text-slate-700">
                  {String(row.data[col] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvalidTable({ rows }: { rows: InvalidRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-red-200 bg-white shadow-sm">
      <div className="border-b border-red-100 px-4 py-2 text-sm font-semibold text-red-800">
        Registros inválidos
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-red-50 text-xs uppercase text-red-700">
          <tr>
            <th className="px-4 py-2">Linha</th>
            <th className="px-4 py-2">Erros</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
  );
}
