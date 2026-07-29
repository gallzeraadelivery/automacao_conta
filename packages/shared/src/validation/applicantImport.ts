import { z } from "zod";
import type { ImportRowError, ImportValidationResult } from "./importResult";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const applicantImportRowSchema = z.object({
  external_id: z.string().trim().min(1, "external_id é obrigatório"),
  full_name: z.string().trim().min(1, "full_name é obrigatório"),
  email: z.string().trim().min(1, "email é obrigatório").email("email inválido"),
  phone: optionalString,
  city: optionalString,
  state: optionalString.refine((value) => !value || value.length === 2, {
    message: "state deve ter 2 letras (UF)",
  }),
  postal_code: optionalString,
  vehicle_type: optionalString,
  // Coluna opcional: se informada, deve referenciar um proxy_configs existente da empresa.
  // Nao ha coluna correspondente na tabela applicants (schema atual); usado apenas
  // para validacao antecipada de digitacao. A vinculacao efetiva de proxy acontece
  // na criacao de browser_profiles em fases futuras.
  proxy_id: optionalString.refine((value) => !value || z.string().uuid().safeParse(value).success, {
    message: "proxy_id deve ser um UUID válido",
  }),
});

export type ApplicantImportRow = z.infer<typeof applicantImportRowSchema>;

/**
 * Validacao sincrona (schema + duplicidade dentro do proprio arquivo).
 * Duplicidade contra o banco (external_id/email ja existentes na empresa) e
 * existencia do proxy_id devem ser checadas separadamente pela API (dependem do banco).
 */
export function validateApplicantImportRows(
  rows: unknown[],
): ImportValidationResult<ApplicantImportRow> {
  const validRows: ImportValidationResult<ApplicantImportRow>["validRows"] = [];
  const invalidRows: ImportValidationResult<ApplicantImportRow>["invalidRows"] = [];

  const seenExternalIds = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  rows.forEach((rawRow, index) => {
    const row = index + 1;
    const parsed = applicantImportRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      invalidRows.push({
        row,
        data: rawRow,
        errors: parsed.error.issues.map((issue): ImportRowError => ({
          row,
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const data = parsed.data;
    const errors: ImportRowError[] = [];
    const normalizedEmail = data.email.toLowerCase();

    const firstExternalIdRow = seenExternalIds.get(data.external_id);
    if (firstExternalIdRow !== undefined) {
      errors.push({
        row,
        field: "external_id",
        message: `external_id duplicado no arquivo (primeira ocorrência na linha ${firstExternalIdRow})`,
      });
    } else {
      seenExternalIds.set(data.external_id, row);
    }

    const firstEmailRow = seenEmails.get(normalizedEmail);
    if (firstEmailRow !== undefined) {
      errors.push({
        row,
        field: "email",
        message: `email duplicado no arquivo (primeira ocorrência na linha ${firstEmailRow})`,
      });
    } else {
      seenEmails.set(normalizedEmail, row);
    }

    if (errors.length > 0) {
      invalidRows.push({ row, data: rawRow, errors });
    } else {
      validRows.push({ row, data });
    }
  });

  return { validRows, invalidRows };
}
