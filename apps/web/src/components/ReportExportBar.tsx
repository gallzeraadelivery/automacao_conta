"use client";

import { useState } from "react";
import { apiDownload } from "@/lib/apiClient";

export function ReportExportBar({
  from,
  to,
  onChangePeriod,
  exportBasePath,
  exportFileBaseName,
}: {
  from: string;
  to: string;
  onChangePeriod: (from: string, to: string) => void;
  exportBasePath: string;
  exportFileBaseName: string;
}) {
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  async function handleExport(format: "csv" | "pdf") {
    setExporting(format);
    const query = new URLSearchParams({ format, from, to }).toString();
    await apiDownload(`${exportBasePath}?${query}`, `${exportFileBaseName}.${format}`);
    setExporting(null);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <label className="block text-xs font-medium text-slate-500">De</label>
        <input
          type="date"
          value={from}
          onChange={(event) => onChangePeriod(event.target.value, to)}
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Até</label>
        <input
          type="date"
          value={to}
          onChange={(event) => onChangePeriod(from, event.target.value)}
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="ml-auto flex gap-2">
        <button
          onClick={() => handleExport("csv")}
          disabled={exporting !== null}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {exporting === "csv" ? "Exportando..." : "Exportar CSV"}
        </button>
        <button
          onClick={() => handleExport("pdf")}
          disabled={exporting !== null}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {exporting === "pdf" ? "Exportando..." : "Exportar PDF"}
        </button>
      </div>
    </div>
  );
}
