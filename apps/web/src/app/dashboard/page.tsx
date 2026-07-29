"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/apiClient";
import { StatCard } from "@/components/StatCard";

interface DashboardStats {
  totalApplicants: number;
  totalEmailAccounts: number;
  totalProxies: number;
  statusDistribution: Array<{ status: string; count: number }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<DashboardStats>("/api/dashboard/stats").then((result) => {
      if (cancelled) return;
      if (result.success) {
        setStats(result.data);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total de motoristas" value={stats.totalApplicants} />
            <StatCard label="E-mails cadastrados" value={stats.totalEmailAccounts} />
            <StatCard label="Proxies cadastrados" value={stats.totalProxies} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Motoristas por status</h2>
            {stats.statusDistribution.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum motorista importado ainda.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {stats.statusDistribution.map((item) => (
                  <li key={item.status} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-600">{item.status}</span>
                    <span className="font-medium text-slate-900">{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
