"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/apiClient";

export interface DeleteSelectedApplicant {
  id: string;
  fullName: string;
  email?: string;
  status: string;
}

export function DeleteSelectedModal({
  selected,
  onClose,
  onDeleted,
}: {
  selected: DeleteSelectedApplicant[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const requiredConfirm = "APAGAR";
  const canConfirm = confirmText.trim().toUpperCase() === requiredConfirm;

  async function handleDelete() {
    if (!canConfirm) return;
    setLoading(true);
    setError(null);
    const response = await apiRequest<{
      deleted: number;
      emailsReserved: number;
      notFound: number;
    }>("/api/applicants/delete-batch", {
      method: "POST",
      body: JSON.stringify({ applicantIds: selected.map((a) => a.id) }),
    });
    setLoading(false);
    if (response.success) {
      const { deleted, emailsReserved, notFound } = response.data;
      let msg = `${deleted} motorista(s) apagado(s).`;
      if (emailsReserved > 0) msg += ` ${emailsReserved} e-mail(s) reservado(s).`;
      if (notFound > 0) msg += ` ${notFound} não encontrado(s).`;
      window.alert(msg);
      onDeleted();
      onClose();
    } else {
      setError(response.error.message);
    }
  }

  const preview = selected.slice(0, 15);
  const rest = selected.length - preview.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-lg">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold text-red-700">Apagar motoristas selecionados</h2>
          <p className="mt-2 text-sm text-slate-600">
            Você está prestes a apagar <strong>{selected.length}</strong> motorista
            {selected.length === 1 ? "" : "s"}. Isso remove e-mail, perfil de navegador, cookies e
            screenshots. <strong>Não pode ser desfeito.</strong>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ul className="space-y-2 text-sm">
            {preview.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div className="font-medium text-slate-900">{a.fullName}</div>
                <div className="text-xs text-slate-500">
                  {a.email || "—"} · {a.status}
                </div>
              </li>
            ))}
            {rest > 0 && (
              <li className="text-xs text-slate-500">+ {rest} outro(s) selecionado(s)</li>
            )}
          </ul>

          <label className="mt-5 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Digite <code className="rounded bg-slate-100 px-1">{requiredConfirm}</code> para
              confirmar
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={requiredConfirm}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              autoComplete="off"
            />
          </label>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={loading || !canConfirm}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Apagando…" : `Apagar ${selected.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
