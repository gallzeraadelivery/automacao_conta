"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiRequest } from "@/lib/apiClient";
import { StatCard } from "@/components/StatCard";
import { ReportExportBar } from "@/components/ReportExportBar";
import type { AuditReport } from "@/lib/reports";

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-red-50 text-red-700",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function AuditReportPage() {
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ from, to }).toString();
    apiRequest<AuditReport>(`/api/reports/audit?${query}`).then((result) => {
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

  const actionsData = report
    ? Object.entries(report.actionsByType).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Relatório de Auditoria</h1>
        <p className="text-sm text-slate-500">
          Ações de operadores e eventos de segurança no período.
        </p>
      </div>

      <ReportExportBar
        from={from}
        to={to}
        onChangePeriod={(newFrom, newTo) => {
          setFrom(newFrom);
          setTo(newTo);
        }}
        exportBasePath="/api/reports/audit/export"
        exportFileBaseName="audit-report"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total de ações" value={report.totalActions} />
            <StatCard label="Operadores ativos" value={report.actionsByOperator.length} />
            <StatCard label="Eventos de segurança" value={report.securityEvents.length} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Ações por tipo</h2>
            {actionsData.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma ação registrada no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={actionsData} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3b5bfd" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Ações por operador</h2>
            {report.actionsByOperator.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma ação registrada no período.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {report.actionsByOperator.map((row) => (
                  <li key={row.operator} className="flex items-center justify-between py-2">
                    <span className="text-slate-700">{row.operator}</span>
                    <span className="font-medium text-slate-900">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Eventos de segurança</h2>
            {report.securityEvents.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum evento de segurança no período.</p>
            ) : (
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="py-2">Data/hora</th>
                    <th className="py-2">Evento</th>
                    <th className="py-2">Severidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.securityEvents.map((event, index) => (
                    <tr key={`${event.event}-${event.timestamp}-${index}`}>
                      <td className="py-2 text-slate-500">
                        {new Date(event.timestamp).toLocaleString("pt-BR")}
                      </td>
                      <td className="py-2 text-slate-700">{event.event}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[event.severity]}`}
                        >
                          {event.severity}
                        </span>
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
