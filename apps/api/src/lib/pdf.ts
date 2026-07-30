import PDFDocument from "pdfkit";

export interface PdfReportSection {
  heading: string;
  rows: Array<{ label: string; value: string }>;
}

export interface PdfReportTable {
  heading: string;
  headers: string[];
  rows: string[][];
}

export interface PdfReportInput {
  title: string;
  subtitle?: string;
  sections: PdfReportSection[];
  tables?: PdfReportTable[];
}

/**
 * Gera um PDF simples de uma página (texto/tabelas, sem gráficos) para os
 * relatórios exportáveis - suficiente para leitura/arquivamento, não uma
 * réplica visual do dashboard. Usa `pdfkit` (puro Node, sem depender de um
 * navegador headless) para manter o footprint de deploy pequeno.
 */
export function renderReportPdf(input: PdfReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(input.title, { align: "left" });
    if (input.subtitle) {
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor("#666666").text(input.subtitle);
      doc.fillColor("#000000");
    }
    doc.moveDown(1);

    for (const section of input.sections) {
      doc.fontSize(13).text(section.heading);
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const row of section.rows) {
        doc.text(`${row.label}: ${row.value}`);
      }
      doc.moveDown(1);
    }

    for (const table of input.tables ?? []) {
      doc.fontSize(13).text(table.heading);
      doc.moveDown(0.3);
      doc.fontSize(9);
      doc.text(table.headers.join("  |  "));
      doc.moveDown(0.1);
      for (const row of table.rows) {
        doc.text(row.join("  |  "));
      }
      doc.moveDown(1);
    }

    doc.end();
  });
}
