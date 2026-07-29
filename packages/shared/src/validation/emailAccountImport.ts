import { z } from "zod";
import type { ImportRowError, ImportValidationResult } from "./importResult";

export const emailAccountImportRowSchema = z.object({
  applicant_external_id: z.string().trim().min(1, "applicant_external_id é obrigatório"),
  email_address: z
    .string()
    .trim()
    .min(1, "email_address é obrigatório")
    .email("email_address inválido"),
  password: z.string().min(1, "password é obrigatório"),
  provider: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" ? undefined : (value ?? "gmail"))),
});

export type EmailAccountImportRow = z.infer<typeof emailAccountImportRowSchema>;

/**
 * Validacao sincrona (schema + duplicidade dentro do proprio arquivo).
 * A checagem de motorista existente, e-mail ja associado a outro motorista e
 * e-mail ja cadastrado na empresa e feita pela API (dependem do banco).
 */
export function validateEmailAccountImportRows(
  rows: unknown[],
): ImportValidationResult<EmailAccountImportRow> {
  const validRows: ImportValidationResult<EmailAccountImportRow>["validRows"] = [];
  const invalidRows: ImportValidationResult<EmailAccountImportRow>["invalidRows"] = [];

  const seenApplicantIds = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  rows.forEach((rawRow, index) => {
    const row = index + 1;
    const parsed = emailAccountImportRowSchema.safeParse(rawRow);

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
    const normalizedEmail = data.email_address.toLowerCase();

    const firstApplicantRow = seenApplicantIds.get(data.applicant_external_id);
    if (firstApplicantRow !== undefined) {
      errors.push({
        row,
        field: "applicant_external_id",
        message: `motorista duplicado no arquivo (primeira ocorrência na linha ${firstApplicantRow})`,
      });
    } else {
      seenApplicantIds.set(data.applicant_external_id, row);
    }

    const firstEmailRow = seenEmails.get(normalizedEmail);
    if (firstEmailRow !== undefined) {
      errors.push({
        row,
        field: "email_address",
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
