import { and, eq, inArray, or } from "drizzle-orm";
import { db, applicants, emailAccounts } from "@uber-automation/database";
import { sealSecret } from "@uber-automation/credential-vault";
import {
  validateEmailAccountImportRows,
  type EmailAccountImportRow,
  type ImportRowError,
} from "@uber-automation/shared";

export interface EmailAccountInvalidRow {
  row: number;
  data: unknown;
  errors: ImportRowError[];
}

interface EmailAccountImportCheck {
  validRows: Array<{ row: number; applicantId: string; data: EmailAccountImportRow }>;
  invalidRows: EmailAccountInvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number };
}

/**
 * Linhas invalidas sao usadas apenas para exibir erros ao operador - nunca
 * devem carregar a senha em texto puro de volta pela API, mesmo quando a
 * linha falhou por outro motivo (ex: motorista inexistente).
 */
function redactPassword(data: unknown): unknown {
  if (data && typeof data === "object" && "password" in data) {
    return { ...(data as Record<string, unknown>), password: "[REDACTED]" };
  }
  return data;
}

/**
 * Valida schema + duplicidade no arquivo (pacote shared) e cruza com o banco:
 * motorista existente (por external_id), motorista que ja possui e-mail, e
 * e-mail ja associado a outro motorista na empresa. Retorna as linhas validas
 * ja com o applicantId resolvido, para reuso direto no import (evita
 * consultar o banco duas vezes).
 */
async function checkEmailAccountImport(
  companyId: string,
  rawRows: unknown[],
): Promise<EmailAccountImportCheck> {
  const syncResult = validateEmailAccountImportRows(rawRows);

  const validRows: EmailAccountImportCheck["validRows"] = [];
  const invalidRows: EmailAccountInvalidRow[] = syncResult.invalidRows.map((row) => ({
    ...row,
    data: redactPassword(row.data),
  }));

  if (syncResult.validRows.length > 0) {
    const externalIds = syncResult.validRows.map((r) => r.data.applicant_external_id);
    const emails = syncResult.validRows.map((r) => r.data.email_address.toLowerCase());

    const matchingApplicants = await db
      .select({ id: applicants.id, externalId: applicants.externalId })
      .from(applicants)
      .where(and(eq(applicants.companyId, companyId), inArray(applicants.externalId, externalIds)));

    const matchingApplicantIds = matchingApplicants.map((a) => a.id);

    const existingEmailAccounts = await db
      .select({ applicantId: emailAccounts.applicantId, emailAddress: emailAccounts.emailAddress })
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.companyId, companyId),
          or(
            inArray(emailAccounts.emailAddress, emails.length > 0 ? emails : ["__none__"]),
            inArray(
              emailAccounts.applicantId,
              matchingApplicantIds.length > 0 ? matchingApplicantIds : ["__none__"],
            ),
          ),
        ),
      );

    const applicantByExternalId = new Map(matchingApplicants.map((a) => [a.externalId, a.id]));
    const applicantIdsWithEmail = new Set(existingEmailAccounts.map((e) => e.applicantId));
    const emailsAlreadyUsed = new Set(
      existingEmailAccounts.map((e) => e.emailAddress.toLowerCase()),
    );

    for (const { row, data } of syncResult.validRows) {
      const errors: ImportRowError[] = [];
      const applicantId = applicantByExternalId.get(data.applicant_external_id);

      if (!applicantId) {
        errors.push({
          row,
          field: "applicant_external_id",
          message: "Nenhum motorista encontrado com este external_id nesta empresa",
        });
      } else if (applicantIdsWithEmail.has(applicantId)) {
        errors.push({
          row,
          field: "applicant_external_id",
          message: "Este motorista já possui um e-mail cadastrado",
        });
      }

      if (emailsAlreadyUsed.has(data.email_address.toLowerCase())) {
        errors.push({
          row,
          field: "email_address",
          message: "Este e-mail já está associado a outro motorista nesta empresa",
        });
      }

      if (errors.length > 0 || !applicantId) {
        invalidRows.push({ row, data: redactPassword(data), errors });
      } else {
        validRows.push({ row, applicantId, data });
      }
    }
  }

  invalidRows.sort((a, b) => a.row - b.row);

  return {
    validRows,
    invalidRows,
    summary: {
      totalRows: rawRows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
    },
  };
}

/** Preview seguro para a rota validate-import: nunca inclui a senha em texto puro. */
export async function validateEmailAccountImport(companyId: string, rawRows: unknown[]) {
  const check = await checkEmailAccountImport(companyId, rawRows);
  return {
    validRows: check.validRows.map(({ row, data }) => ({
      row,
      data: { ...data, password: "[REDACTED]" },
    })),
    invalidRows: check.invalidRows,
    summary: check.summary,
  };
}

export async function importEmailAccounts(companyId: string, rawRows: unknown[]) {
  const check = await checkEmailAccountImport(companyId, rawRows);

  if (check.validRows.length === 0) {
    return { imported: 0, skipped: check.invalidRows.length, invalidRows: check.invalidRows };
  }

  const rowsToInsert = check.validRows.map(({ applicantId, data }) => {
    const sealed = sealSecret(data.password);
    return {
      companyId,
      applicantId,
      emailAddress: data.email_address.toLowerCase(),
      encryptedPassword: sealed.encrypted,
      encryptionIv: sealed.iv,
      encryptionAuthTag: sealed.authTag,
      provider: data.provider ?? "gmail",
    };
  });

  await db.insert(emailAccounts).values(rowsToInsert);

  return {
    imported: rowsToInsert.length,
    skipped: check.invalidRows.length,
    invalidRows: check.invalidRows,
  };
}

export async function listEmailAccounts(
  companyId: string,
  params: { page: number; pageSize: number },
) {
  const offset = (params.page - 1) * params.pageSize;
  const rows = await db
    .select({
      id: emailAccounts.id,
      applicantId: emailAccounts.applicantId,
      emailAddress: emailAccounts.emailAddress,
      provider: emailAccounts.provider,
      loginStatus: emailAccounts.loginStatus,
      failedLoginAttempts: emailAccounts.failedLoginAttempts,
      requiresHumanAction: emailAccounts.requiresHumanAction,
      lastLoginAt: emailAccounts.lastLoginAt,
      lastCodeReceivedAt: emailAccounts.lastCodeReceivedAt,
      createdAt: emailAccounts.createdAt,
    })
    .from(emailAccounts)
    .where(eq(emailAccounts.companyId, companyId))
    .limit(params.pageSize)
    .offset(offset);

  return rows;
}
