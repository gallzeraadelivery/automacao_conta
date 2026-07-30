import { and, eq, inArray, or } from "drizzle-orm";
import { db, applicants, emailAccounts } from "@uber-automation/database";
import {
  validateEmailListRows,
  type EmailListRow,
  type ImportRowError,
} from "@uber-automation/shared";
import { createCredentialVault } from "../lib/credentialVault";

export interface EmailListInvalidRow {
  row: number;
  data: unknown;
  errors: ImportRowError[];
}

export interface EmailListValidation {
  validRows: Array<{ row: number; data: EmailListRow }>;
  invalidRows: EmailListInvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number };
}

/**
 * Cruza a validação síncrona (formato "email|senha", ver
 * @uber-automation/shared) com o banco: external_id (derivado do local-part
 * do e-mail) ou e-mail já existentes na empresa. Usado tanto no preview
 * quanto no import de fato.
 */
async function checkEmailListImport(companyId: string, text: string): Promise<EmailListValidation> {
  const syncResult = validateEmailListRows(text);

  const validRows: EmailListValidation["validRows"] = [];
  const invalidRows: EmailListInvalidRow[] = [...syncResult.invalidRows];

  if (syncResult.validRows.length > 0) {
    const externalIds = syncResult.validRows.map((r) => r.data.externalId);
    const emails = syncResult.validRows.map((r) => r.data.email);

    const existing = await db
      .select({ externalId: applicants.externalId, email: applicants.email })
      .from(applicants)
      .where(
        and(
          eq(applicants.companyId, companyId),
          or(inArray(applicants.externalId, externalIds), inArray(applicants.email, emails)),
        ),
      );

    const existingExternalIds = new Set(existing.map((a) => a.externalId));
    const existingEmails = new Set(existing.map((a) => a.email.toLowerCase()));

    for (const { row, data } of syncResult.validRows) {
      const errors: ImportRowError[] = [];
      if (existingExternalIds.has(data.externalId)) {
        errors.push({ row, field: "email", message: "Já existe um motorista com este e-mail" });
      }
      if (existingEmails.has(data.email)) {
        errors.push({ row, field: "email", message: "Já existe um motorista com este e-mail" });
      }

      if (errors.length > 0) {
        invalidRows.push({ row, data: { ...data, password: "[REDACTED]" }, errors });
      } else {
        validRows.push({ row, data });
      }
    }
  }

  invalidRows.sort((a, b) => a.row - b.row);

  return {
    validRows,
    invalidRows,
    summary: {
      totalRows: syncResult.validRows.length + syncResult.invalidRows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
    },
  };
}

/** Preview seguro: nunca inclui a senha em texto puro. */
export async function validateEmailListImport(companyId: string, text: string) {
  const check = await checkEmailListImport(companyId, text);
  return {
    validRows: check.validRows.map(({ row, data }) => ({
      row,
      data: { ...data, password: "[REDACTED]" },
    })),
    invalidRows: check.invalidRows,
    summary: check.summary,
  };
}

export interface EmailListImportOutcome {
  imported: number;
  skipped: number;
  invalidRows: EmailListInvalidRow[];
}

/**
 * Cria o motorista E a conta de e-mail juntos, a partir da mesma linha
 * "email|senha" - diferente dos outros imports (planilha de motoristas e
 * planilha de e-mails separadas, ligadas por external_id). Nome extraído do
 * próprio e-mail (ver extractNameFromLocalPart); cidade/estado/CEP/veículo
 * ficam em branco (não fazem parte deste formato - preencha depois pela API
 * se precisar, ou deixe em branco: o fluxo real de automação não usa esses
 * campos, ver RealUberSignupAdapter).
 */
export async function importEmailList(
  companyId: string,
  text: string,
): Promise<EmailListImportOutcome> {
  const check = await checkEmailListImport(companyId, text);

  if (check.validRows.length === 0) {
    return { imported: 0, skipped: check.invalidRows.length, invalidRows: check.invalidRows };
  }

  const vault = createCredentialVault(companyId);
  let imported = 0;

  for (const { data } of check.validRows) {
    const [applicant] = await db
      .insert(applicants)
      .values({
        companyId,
        externalId: data.externalId,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        email: data.email,
      })
      .returning({ id: applicants.id });

    if (!applicant) continue;

    const sealed = await vault.encrypt(data.password, { applicantId: applicant.id });
    await db.insert(emailAccounts).values({
      companyId,
      applicantId: applicant.id,
      emailAddress: data.email,
      encryptedPassword: sealed.ciphertext,
      encryptionIv: sealed.iv,
      encryptionAuthTag: sealed.authTag,
      provider: "gmail",
    });

    imported += 1;
  }

  return { imported, skipped: check.invalidRows.length, invalidRows: check.invalidRows };
}
