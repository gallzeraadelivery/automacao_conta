"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { apiRequest } from "@/lib/apiClient";
import { StatCard } from "@/components/StatCard";
import type { AutomationReport } from "@/lib/reports";

interface DashboardStats {
  totalApplicants: number;
  totalEmailAccounts: number;
  totalProxies: number;
  statusDistribution: Array<{ status: string; count: number }>;
}

const STATUS_COLORS: Record<string, string> = {
  NEW: "#94a3b8",
  CONSENT_PENDING: "#a1a1aa",
  READY_TO_START: "#38bdf8",
  IN_PROGRESS: "#3b5bfd",
  AWAITING_HUMAN_ACTION: "#f59e0b",
  RESOLVED: "#16a34a",
  CANCELLED: "#dc2626",
  COMPLETED: "#16a34a",
  FAILED: "#dc2626",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [report, setReport] = useState<AutomationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiRequest<DashboardStats>("/api/dashboard/stats").then((result) => {
      if (cancelled) return;
      if (result.success) setStats(result.data);
      else setError(result.error.message);
    });

    const query = new URLSearchParams({
      from: isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      to: isoDate(new Date()),
    }).toString();
    apiRequest<AutomationReport>(`/api/reports/automation?${query}`).then((result) => {
      if (!cancelled && result.success) setReport(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const pendingCount =
    stats?.statusDistribution.find((item) => item.status === "AWAITING_HUMAN_ACTION")?.count ?? 0;
  const inProgressCount =
    stats?.statusDistribution.find((item) => item.status === "IN_PROGRESS")?.count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Visão geral do cadastro administrativo de motoristas
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total de motoristas" value={stats.totalApplicants} />
            <StatCard label="Em processamento" value={inProgressCount} />
            <StatCard label="Aguardando intervenção" value={pendingCount} />
            <StatCard
              label="Taxa de sucesso (30d)"
              value={report ? `${(report.successRate * 100).toFixed(1)}%` : "-"}
            />
            <StatCard label="Proxies cadastrados" value={stats.totalProxies} />
          </div>

          {pendingCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Há <strong>{pendingCount}</strong> motorista(s) aguardando ação humana.{" "}
              <Link href="/dashboard/pending-actions" className="font-medium underline">
                Abrir Central de Pendências
              </Link>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Motoristas por status</h2>
              {stats.statusDistribution.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum motorista importado ainda.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={stats.statusDistribution}
                      dataKey="count"
                      nameKey="status"
                      outerRadius={90}
                      label
                    >
                      {stats.statusDistribution.map((entry) => (
                        <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#cbd5e1"} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Resumo (últimos 30 dias)
              </h2>
              {report ? (
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between">
                    <span className="text-slate-600">Total processado</span>
                    <span className="font-medium text-slate-900">{report.totalProcessed}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-600">Sucesso</span>
                    <span className="font-medium text-slate-900">{report.successfulCount}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-600">Falhas</span>
                    <span className="font-medium text-slate-900">{report.failedCount}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-600">Pausados</span>
                    <span className="font-medium text-slate-900">{report.pausedCount}</span>
                  </li>
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Carregando...</p>
              )}
              <Link
                href="/dashboard/reports/automation"
                className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline"
              >
                Ver relatório completo →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
