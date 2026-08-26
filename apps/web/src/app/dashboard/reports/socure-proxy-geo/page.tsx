"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiRequest } from "@/lib/apiClient";
import { StatCard } from "@/components/StatCard";
import type { SocureProxyGeoCityRow, SocureProxyGeoReport } from "@/lib/reports";

type SortMode = "socure" | "veriff" | "rate";

function cityLabel(row: SocureProxyGeoCityRow): string {
  return row.region ? `${row.city}, ${row.region}` : row.city;
}

function shortCity(row: SocureProxyGeoCityRow): string {
  return row.city.length > 14 ? `${row.city.slice(0, 12)}…` : row.city;
}

export default function SocureProxyGeoPage() {
  const [report, setReport] = useState<SocureProxyGeoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("socure");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<SocureProxyGeoReport>("/api/reports/socure-proxy-geo");
    setLoading(false);
    if (result.success) {
      setReport(result.data);
    } else {
      setReport(null);
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tableRows = useMemo(() => {
    if (!report) return [];
    if (sortMode === "veriff") return report.byVeriff;
    if (sortMode === "rate") return report.bySocureRate;
    return report.bySocure;
  }, [report, sortMode]);

  const chartData = useMemo(() => {
    if (!report) return [];
    const source = sortMode === "veriff" ? report.byVeriff : report.bySocure;
    return source.slice(0, 12).map((row) => ({
      name: shortCity(row),
      full: cityLabel(row),
      Socure: row.socure,
      Veriff: row.veriff,
    }));
  }, [report, sortMode]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">BI Socure · Cidades do proxy</h1>
          <p className="text-sm text-slate-500">
            Ranking das cidades do IP do proxy com mais Socure (foto/CNH) e Veriff (pause
            NON_SOCURE_PROVIDER). Só motoristas com geo preenchida.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Atualizar
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && !report && <p className="text-sm text-slate-500">Carregando…</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Com geo" value={report.totals.withGeo} />
            <StatCard label="Cidades" value={report.totals.cities} />
            <StatCard label="Socure" value={report.totals.socure} />
            <StatCard label="Veriff" value={report.totals.veriff} />
            <StatCard label="Identidade" value={report.totals.identidade} />
            <StatCard label="Security / Phone" value={`${report.totals.security} / ${report.totals.phone}`} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "socure" as const, label: "Mais Socure" },
                { id: "veriff" as const, label: "Mais Veriff" },
                { id: "rate" as const, label: "Melhor taxa Socure (≥3)" },
              ] as const
            ).map((chip) => {
              const active = sortMode === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setSortMode(chip.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-brand-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {chartData.length > 0 && sortMode !== "rate" && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">
                {sortMode === "veriff" ? "Top cidades · Veriff" : "Top cidades · Socure"}
              </h2>
              <p className="mb-3 text-xs text-slate-500">Quantidade absoluta (até 12 cidades)</p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [value, name]}
                    labelFormatter={(_, payload) => {
                      const item = payload?.[0]?.payload as { full?: string } | undefined;
                      return item?.full ?? "";
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Socure" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Veriff" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {sortMode === "socure" && "Ranking · mais Socure"}
                {sortMode === "veriff" && "Ranking · mais Veriff"}
                {sortMode === "rate" && "Ranking · melhor taxa Socure (amostra ≥ 3)"}
              </h2>
            </div>
            {tableRows.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-500">Sem dados para este ranking.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">#</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Cidade</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Socure</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Veriff</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Total</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">% Socure</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">% Veriff</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Id</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Sec</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Phone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tableRows.map((row, index) => (
                      <tr key={`${row.city}|${row.region}`} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-400">{index + 1}</td>
                        <td className="px-4 py-2 font-medium text-slate-900">{cityLabel(row)}</td>
                        <td className="px-4 py-2 text-right text-emerald-700">{row.socure}</td>
                        <td className="px-4 py-2 text-right text-amber-700">{row.veriff}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{row.total}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{row.pctSocure.toFixed(1)}%</td>
                        <td className="px-4 py-2 text-right text-slate-700">{row.pctVeriff.toFixed(1)}%</td>
                        <td className="px-4 py-2 text-right text-slate-600">{row.identidade}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{row.security}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{row.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-400">
            Socure = profile_photo_provider ou driver_license_provider = SOCURE · Veriff =
            pause_reason NON_SOCURE_PROVIDER
          </p>
        </>
      )}
    </div>
  );
}
