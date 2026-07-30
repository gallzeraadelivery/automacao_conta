import * as XLSX from "xlsx";
import { HttpError } from "../middleware/errorHandler";

/**
 * Aceita um buffer de arquivo CSV ou XLSX e retorna as linhas como objetos
 * (chave = cabeçalho da coluna, valor = string). Usa a primeira aba em caso
 * de XLSX.
 */
export function parseSpreadsheetBuffer(buffer: Buffer, originalName: string): unknown[] {
  let workbook: XLSX.WorkBook;

  try {
    // codepage 65001 = UTF-8. Sem isso, CSVs em UTF-8 sem BOM (o caso comum
    // ao exportar de planilhas com nomes acentuados, ex: "João") são lidos
    // com a codificação errada e corrompem caracteres não-ASCII. Não afeta
    // a leitura de arquivos XLSX reais (formato binário com codificação
    // própria, independente desta opção).
    workbook = XLSX.read(buffer, { type: "buffer", codepage: 65001 });
  } catch {
    throw new HttpError(400, "INVALID_FILE", `Não foi possível ler o arquivo "${originalName}"`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new HttpError(400, "EMPTY_FILE", "O arquivo não contém nenhuma planilha");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new HttpError(400, "EMPTY_FILE", "O arquivo não contém nenhuma planilha");
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.trim()] = typeof value === "string" ? value.trim() : value;
    }
    return normalized;
  });
}
