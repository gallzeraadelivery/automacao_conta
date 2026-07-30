/**
 * Serializador de CSV minimalista (sem dependência externa) - escapa vírgula,
 * aspas e quebra de linha por RFC 4180. Não tenta ser um parser genérico de
 * qualquer forma de dado, só o suficiente para exportar as linhas planas dos
 * relatórios desta API.
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0 && !columns) return "";
  const headers = columns ?? Object.keys(rows[0] ?? {});

  const lines = [headers.map(escapeCsvValue).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
  }
  return lines.join("\r\n");
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const stringValue = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}
