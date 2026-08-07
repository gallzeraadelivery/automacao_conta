"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiDownload, apiRequest } from "@/lib/apiClient";
import {
  type VerificationProviderFilter,
  type VerificationReport,
  type VerificationReportRow,
} from "@/lib/reports";
import { pauseReasonLabel } from "@/lib/pendingActions";

const PROVIDER_LABELS: Record<string, string> = {
  SOCURE: "Socure",
  VERIFF: "Veriff",
  NOT_SOCURE: "Outro",
  OTHER_PROVIDER: "Outro",
  UNKNOWN: "Desconhecido",
};

const FILTERS: Array<{ id: VerificationProviderFilter; label: string }> = [
  { id: "socure", label: "Só Socure" },
  { id: "veriff", label: "Veriff" },
  { id: "all", label: "Todos" },
];

function providerLabel(provider: string | null, confidence: string | null) {
  if (!provider) return <span className="text-slate-400">-</span>;
  return (
    <span>
      {PROVIDER_LABELS[provider] ?? provider}
      {confidence ? <span className="ml-1 text-xs text-slate-400">({confidence})</span> : null}
    </span>
  );
}

export default function SocureReportPage() {
  const [filter, setFilter] = useState<VerificationProviderFilter>("socure");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (provider: VerificationProviderFilter) => {
    setError(null);
    const result = await apiRequest<VerificationReport>(
      `/api/reports/verification?provider=${provider}`,
    );
    if (result.success) {
      setReport(result.data);
    } else {
      setReport(null);
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function handleDownload(row: VerificationReportRow) {
    setActionError(null);
    setDownloadingId(row.id);
    const ok = await apiDownload(
      `/api/applicants/${row.id}/uber-cookies`,
      `adspower-cookies-${row.externalId}.json`,
    );
    setDownloadingId(null);
    if (!ok) {
      setActionError(
        `Não foi possível baixar cookies de ${row.fullName} (sessão vazia ou não persistida).`,
      );
    }
  }

  const counts = report?.counts ?? { socure: 0, veriff: 0, all: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Relatório Socure</h1>
        <p className="text-sm text-slate-500">
          Motoristas com verificação detectada. Filtro padrão: foto ou CNH = Socure. Baixe os
          cookies AdsPower por linha.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Socure</p>
          <p className="mt-1 text-2xl font-semibold text-brand-700">{counts.socure}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Veriff</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">{counts.veriff}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Com probe</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">{counts.all}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((chip) => {
          const active = filter === chip.id;
          const count =
            chip.id === "socure" ? counts.socure : chip.id === "veriff" ? counts.veriff : counts.all;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {chip.label}
              <span className={`ml-1.5 tabular-nums ${active ? "text-brand-100" : "text-slate-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-sm text-slate-500">
          Exibindo <strong className="text-slate-800">{report?.total ?? 0}</strong>
        </span>
      </div>

      {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!report && !error ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : report && report.items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">Nenhum motorista neste filtro.</p>
        </div>
      ) : report ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Foto</th>
                <th className="px-4 py-3">CNH</th>
                <th className="px-4 py-3">Pausado em</th>
                <th className="px-4 py-3">Cookies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.items.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/dashboard/pending-actions`}
                      className="hover:underline"
                      title={row.externalId}
                    >
                      {row.fullName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.email}</td>
                  <td className="px-4 py-3 text-slate-600">{row.status}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.pauseReason ? pauseReasonLabel(row.pauseReason) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {providerLabel(row.profilePhotoProvider, row.profilePhotoConfidence)}
                  </td>
                  <td className="px-4 py-3">
                    {providerLabel(row.driverLicenseProvider, row.driverLicenseConfidence)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {row.pausedAt ? new Date(row.pausedAt).toLocaleString("pt-BR") : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={downloadingId === row.id}
                      onClick={() => void handleDownload(row)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {downloadingId === row.id ? "Baixando…" : "Baixar cookies"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
