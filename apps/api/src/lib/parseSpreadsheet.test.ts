import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSpreadsheetBuffer } from "./parseSpreadsheet";
import { HttpError } from "../middleware/errorHandler";

const HEADERS = ["external_id", "full_name", "email"];
const ROW = ["ext-1", "João da Silva", "joao@example.com"];

function buildCsvBuffer(): Buffer {
  const csv = [HEADERS.join(","), ROW.join(",")].join("\n");
  return Buffer.from(csv, "utf-8");
}

function buildXlsxBuffer(): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, ROW]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseSpreadsheetBuffer", () => {
  it("parses a valid CSV file into row objects", () => {
    const rows = parseSpreadsheetBuffer(buildCsvBuffer(), "applicants.csv");
    expect(rows).toEqual([
      { external_id: "ext-1", full_name: "João da Silva", email: "joao@example.com" },
    ]);
  });

  it("parses a valid XLSX file into row objects", () => {
    const rows = parseSpreadsheetBuffer(buildXlsxBuffer(), "applicants.xlsx");
    expect(rows).toEqual([
      { external_id: "ext-1", full_name: "João da Silva", email: "joao@example.com" },
    ]);
  });

  it("trims whitespace from header names and string values", () => {
    const csv = [" external_id , full_name ", " ext-1 , João "].join("\n");
    const rows = parseSpreadsheetBuffer(Buffer.from(csv, "utf-8"), "applicants.csv");
    expect(rows).toEqual([{ external_id: "ext-1", full_name: "João" }]);
  });

  it("rejects a file whose format cannot be parsed at all (ex: corrupted/truncated ZIP)", () => {
    // Bytes começando com a assinatura de um arquivo ZIP (que é o formato
    // real por trás de .xlsx), mas com corpo inválido - falha no parser em
    // vez de ser interpretado como texto/CSV.
    const corruptedZip = Buffer.from("PK\x03\x04not-a-real-zip-body", "latin1");
    expect(() => parseSpreadsheetBuffer(corruptedZip, "corrupted.xlsx")).toThrow(HttpError);
  });

  it("parses arbitrary non-tabular bytes as an empty sheet instead of throwing (documents current lenient behavior)", () => {
    // O parser (SheetJS) é permissivo: bytes sem nenhuma estrutura
    // reconhecível de CSV/XLSX tendem a virar uma planilha vazia, não um
    // erro - quem chama trata "zero linhas" como cadastro sem nada a
    // importar (ver `applicants.service.ts` validateApplicantImport).
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    expect(parseSpreadsheetBuffer(garbage, "not-a-spreadsheet.bin")).toEqual([]);
  });
});
