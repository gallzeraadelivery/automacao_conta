"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/apiClient";
import { StartAutomationModal } from "./StartAutomationModal";

interface ApplicantRow {
  id: string;
  externalId: string;
  fullName: string;
  status: string;
  pauseReason: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  AWAITING_HUMAN_ACTION: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-green-100 text-green-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-slate-200 text-slate-600",
  FAILED: "bg-red-100 text-red-800",
};

/**
 * Só permite iniciar automação de um estado "de repouso" - motoristas já em
 * andamento/pausados/concluídos têm seu próprio fluxo (Central de
 * Pendências) para evitar dois jobs concorrentes para o mesmo motorista.
 */
const STARTABLE_STATUSES = new Set(["NEW", "CONSENT_PENDING", "READY_TO_START", "FAILED"]);

export function ApplicantsList() {
  const [applicants, setApplicants] = useState<ApplicantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApplicantRow | null>(null);

  async function load() {
    setLoading(true);
    const result = await apiRequest<{ items: ApplicantRow[] }>(
      "/api/applicants?pageSize=50",
    );
    setLoading(false);
    if (result.success) setApplicants(result.data.items);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Motoristas importados</h2>
        <button onClick={load} className="text-xs font-medium text-brand-600 hover:underline">
          Atualizar
        </button>
      </div>

      {loading && applicants.length === 0 && (
        <p className="text-sm text-slate-500">Carregando...</p>
      )}
      {!loading && applicants.length === 0 && (
        <p className="text-sm text-slate-500">Nenhum motorista importado ainda.</p>
      )}

      {applicants.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <th className="py-2">ID externo</th>
              <th className="py-2">Nome</th>
              <th className="py-2">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {applicants.map((applicant) => (
              <tr key={applicant.id}>
                <td className="py-2 text-slate-500">{applicant.externalId}</td>
                <td className="py-2 text-slate-800">{applicant.fullName}</td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      STATUS_STYLES[applicant.status] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {applicant.status}
                  </span>
                </td>
                <td className="py-2 text-right">
                  {STARTABLE_STATUSES.has(applicant.status) && (
                    <button
                      onClick={() => setSelected(applicant)}
                      className="rounded-md border border-brand-500 px-3 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
                    >
                      Iniciar automação
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <StartAutomationModal
          applicantId={selected.id}
          applicantName={selected.fullName}
          onClose={() => setSelected(null)}
          onStarted={load}
        />
      )}
    </div>
  );
}
