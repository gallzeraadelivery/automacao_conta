import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./pdf";

describe("renderReportPdf", () => {
  it("produces a well-formed PDF buffer", async () => {
    const pdf = await renderReportPdf({
      title: "Relatório de teste",
      subtitle: "Período: 2024-01-01 a 2024-01-31",
      sections: [{ heading: "Resumo", rows: [{ label: "Total", value: "42" }] }],
      tables: [{ heading: "Detalhes", headers: ["Código", "Contagem"], rows: [["ABC", "1"]] }],
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    // Todo PDF válido começa com a assinatura "%PDF-" e termina com "%%EOF".
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(100);
  });

  it("does not throw when there are no tables", async () => {
    const pdf = await renderReportPdf({
      title: "Sem tabelas",
      sections: [{ heading: "Resumo", rows: [] }],
    });
    expect(pdf.length).toBeGreaterThan(0);
  });
});
