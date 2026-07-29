export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportValidationResult<T> {
  validRows: Array<{ row: number; data: T }>;
  invalidRows: Array<{ row: number; data: unknown; errors: ImportRowError[] }>;
}

export function summarizeImportResult<T>(result: ImportValidationResult<T>) {
  return {
    totalRows: result.validRows.length + result.invalidRows.length,
    validCount: result.validRows.length,
    invalidCount: result.invalidRows.length,
  };
}
