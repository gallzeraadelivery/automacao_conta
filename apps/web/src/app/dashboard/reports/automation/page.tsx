"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiRequest } from "@/lib/apiClient";
import { StatCard } from "@/components/StatCard";
import { ReportExportBar } from "@/components/ReportExportBar";
import { formatDuration, type AutomationReport } from "@/lib/reports";
import { formatProxyGeoLabel } from "@/lib/proxyGeo";

const STATUS_COLORS: Record<string, string> = {
  Sucesso: "#16a34a",
  Falha: "#dc2626",
  Pausado: "#f59e0b",
};
const PROVIDER_COLORS: Record<string, string> = {
  Socure: "#3b5bfd",
  "Outro provedor": "#94a3b8",
  Desconhecido: "#cbd5e1",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function AutomationReportPage() {
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [report, setReport] = useState<AutomationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ from, to }).toString();
    apiRequest<AutomationReport>(`/api/reports/automation?${query}`).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setReport(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const statusData = report
    ? [
        { name: "Sucesso", value: report.successfulCount },
        { name: "Falha", value: report.failedCount },
        { name: "Pausado", value: report.pausedCount },
      ].filter((entry) => entry.value > 0)
    : [];

  const providerData = report
    ? [
        { name: "Socure", value: report.providerDistribution.socure },
        { name: "Outro provedor", value: report.providerDistribution.other },
        { name: "Desconhecido", value: report.providerDistribution.unknown },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Relatório de Automação</h1>
        <p className="text-sm text-slate-500">Desempenho da automação administrativa no período.</p>
      </div>

      <ReportExportBar
        from={from}
        to={to}
        onChangePeriod={(newFrom, newTo) => {
          setFrom(newFrom);
          setTo(newTo);
        }}
        exportBasePath="/api/reports/automation/export"
        exportFileBaseName="automation-report"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total processado" value={report.totalProcessed} />
            <StatCard label="Taxa de sucesso" value={`${(report.successRate * 100).toFixed(1)}%`} />
            <StatCard
              label="Tempo médio até conclusão"
              value={formatDuration(report.averageTimeToCompleteSeconds)}
            />
            <StatCard label="Aguardando ação humana" value={report.pausedCount} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Distribuição de status</h2>
              {statusData.length === 0 ? (
                <p className="text-sm text-slate-500">Sem dados no período selecionado.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} label>
                      {statusData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#cbd5e1"} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Provedores de verificação detectados
              </h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={providerData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value">
                    {providerData.map((entry) => (
                      <Cell key={entry.name} fill={PROVIDER_COLORS[entry.name] ?? "#cbd5e1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Principais erros técnicos</h2>
            {report.topErrors.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum erro técnico registrado no período.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {report.topErrors.map((topError) => (
                  <li key={topError.code} className="flex items-center justify-between py-2">
                    <span className="text-slate-700">{topError.message}</span>
                    <span className="font-medium text-slate-900">{topError.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Cidade do proxy (IP de saída)
            </h2>
            {(report.proxyGeoRows ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum lookup de geo do proxy no período (roda no início de cada job).
              </p>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Motorista</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Cidade proxy</th>
                    <th className="py-2">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.proxyGeoRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 pr-3 font-medium text-slate-800">{row.fullName}</td>
                      <td className="py-2 pr-3 text-slate-600">{row.status}</td>
                      <td className="py-2 pr-3 text-slate-700">
                        {formatProxyGeoLabel(row.proxyGeoCity, row.proxyGeoRegion)}
                      </td>
                      <td className="py-2 font-mono text-xs text-slate-500">
                        {row.proxyExternalIp ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
