import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, applicants, proxyConfigs, emailAccounts } from "@uber-automation/database";
import {
  validateApplicantImportRows,
  type ApplicantImportRow,
  type ImportRowError,
} from "@uber-automation/shared";
import { HttpError } from "../middleware/errorHandler";
import { createCredentialVault } from "../lib/credentialVault";
import { enqueueStartAutomationJob } from "../lib/automationQueue";

export interface ApplicantPreviewRow {
  row: number;
  data: ApplicantImportRow;
}

export interface ApplicantInvalidRow {
  row: number;
  data: unknown;
  errors: ImportRowError[];
}

export interface ApplicantImportValidation {
  validRows: ApplicantPreviewRow[];
  invalidRows: ApplicantInvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number };
}

/**
 * Roda a validacao de schema/duplicidade-no-arquivo (sincrona, pacote shared)
 * e depois cruza com o banco: external_id/email ja existentes na empresa e
 * proxy_id inexistente. Usada tanto no preview (validate-import) quanto,
 * novamente, no import de fato (nunca confiar apenas no preview do cliente).
 */
export async function validateApplicantImport(
  companyId: string,
  rawRows: unknown[],
): Promise<ApplicantImportValidation> {
  const syncResult = validateApplicantImportRows(rawRows);

  const validRows: ApplicantPreviewRow[] = [];
  const invalidRows: ApplicantInvalidRow[] = [...syncResult.invalidRows];

  if (syncResult.validRows.length === 0) {
    return {
      validRows,
      invalidRows,
      summary: {
        totalRows: rawRows.length,
        validCount: 0,
        invalidCount: invalidRows.length,
      },
    };
  }

  const externalIds = syncResult.validRows.map((r) => r.data.external_id);
  const emails = syncResult.validRows.map((r) => r.data.email.toLowerCase());
  const proxyIds = syncResult.validRows
    .map((r) => r.data.proxy_id)
    .filter((id): id is string => Boolean(id));

  const [existingApplicants, existingProxies] = await Promise.all([
    db
      .select({ externalId: applicants.externalId, email: applicants.email })
      .from(applicants)
      .where(
        and(
          eq(applicants.companyId, companyId),
          or(
            inArray(applicants.externalId, externalIds.length > 0 ? externalIds : ["__none__"]),
            inArray(applicants.email, emails.length > 0 ? emails : ["__none__"]),
          ),
        ),
      ),
    proxyIds.length > 0
      ? db
          .select({ id: proxyConfigs.id })
          .from(proxyConfigs)
          .where(and(eq(proxyConfigs.companyId, companyId), inArray(proxyConfigs.id, proxyIds)))
      : Promise.resolve([]),
  ]);

  const existingExternalIds = new Set(existingApplicants.map((a) => a.externalId));
  const existingEmails = new Set(existingApplicants.map((a) => a.email.toLowerCase()));
  const existingProxyIds = new Set(existingProxies.map((p) => p.id));

  for (const { row, data } of syncResult.validRows) {
    const errors: ImportRowError[] = [];

    if (existingExternalIds.has(data.external_id)) {
      errors.push({
        row,
        field: "external_id",
        message: "Já existe um motorista com este external_id nesta empresa",
      });
    }
    if (existingEmails.has(data.email.toLowerCase())) {
      errors.push({
        row,
        field: "email",
        message: "Já existe um motorista com este email nesta empresa",
      });
    }
    if (data.proxy_id && !existingProxyIds.has(data.proxy_id)) {
      errors.push({ row, field: "proxy_id", message: "Proxy inexistente para esta empresa" });
    }

    if (errors.length > 0) {
      invalidRows.push({ row, data, errors });
    } else {
      validRows.push({ row, data });
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

export interface ApplicantImportOutcome {
  imported: number;
  skipped: number;
  invalidRows: ApplicantInvalidRow[];
}

export async function importApplicants(
  companyId: string,
  rawRows: unknown[],
): Promise<ApplicantImportOutcome> {
  const validation = await validateApplicantImport(companyId, rawRows);

  if (validation.validRows.length === 0) {
    return {
      imported: 0,
      skipped: validation.invalidRows.length,
      invalidRows: validation.invalidRows,
    };
  }

  const rowsToInsert = validation.validRows.map(({ data }) => ({
    companyId,
    externalId: data.external_id,
    fullName: data.full_name,
    email: data.email.toLowerCase(),
    phone: data.phone,
    city: data.city,
    state: data.state,
    postalCode: data.postal_code,
    vehicleType: data.vehicle_type,
  }));

  await db.insert(applicants).values(rowsToInsert);

  return {
    imported: rowsToInsert.length,
    skipped: validation.invalidRows.length,
    invalidRows: validation.invalidRows,
  };
}

export async function listApplicants(
  companyId: string,
  params: { page: number; pageSize: number; status?: string },
) {
  const offset = (params.page - 1) * params.pageSize;

  const whereClause = params.status
    ? and(eq(applicants.companyId, companyId), eq(applicants.status, params.status))
    : eq(applicants.companyId, companyId);

  const [items, countRows] = await Promise.all([
    db.select().from(applicants).where(whereClause).limit(params.pageSize).offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(applicants)
      .where(whereClause),
  ]);
  const count = countRows[0]?.count ?? 0;

  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / params.pageSize)),
  };
}

export async function getApplicantById(companyId: string, id: string) {
  const [applicant] = await db
    .select()
    .from(applicants)
    .where(and(eq(applicants.companyId, companyId), eq(applicants.id, id)))
    .limit(1);

  return applicant ?? null;
}

export interface StartAutomationInput {
  proxyId: string;
  platformPassword: string;
}

/**
 * Enfileira a etapa RUN_ADMINISTRATIVE_FLOW (Fase 7) para este motorista:
 * criptografa a senha de login da plataforma (nunca gravada em texto puro,
 * nunca reexibida - mesmo padrão de email_accounts/proxy_configs) e coloca
 * o job na fila `automation-jobs` para apps/worker processar. Por padrão
 * (AUTOMATION_TARGET=mock no worker) o alvo é o servidor simulado, nunca a
 * Uber real - ver apps/worker/src/env.ts e SECURITY.md.
 */
export async function startAutomation(
  companyId: string,
  applicantId: string,
  input: StartAutomationInput,
): Promise<{ jobId: string }> {
  const applicant = await getApplicantById(companyId, applicantId);
  if (!applicant) {
    throw new HttpError(404, "NOT_FOUND", "Motorista não encontrado");
  }

  const [emailAccount] = await db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(and(eq(emailAccounts.companyId, companyId), eq(emailAccounts.applicantId, applicantId)))
    .limit(1);
  if (!emailAccount) {
    throw new HttpError(
      400,
      "EMAIL_ACCOUNT_REQUIRED",
      "Cadastre o e-mail de verificação deste motorista antes de iniciar a automação",
    );
  }

  const [proxy] = await db
    .select({ id: proxyConfigs.id })
    .from(proxyConfigs)
    .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.id, input.proxyId)))
    .limit(1);
  if (!proxy) {
    throw new HttpError(400, "PROXY_NOT_FOUND", "Proxy inexistente para esta empresa");
  }

  const vault = createCredentialVault(companyId);
  const platformCredential = await vault.encrypt(
    input.platformPassword,
    { applicantId },
    applicantId,
  );

  const jobId = await enqueueStartAutomationJob({
    companyId,
    applicantId,
    emailAccountId: emailAccount.id,
    proxyId: input.proxyId,
    applicantData: {
      fullName: applicant.fullName,
      email: applicant.email,
      phone: applicant.phone ?? "",
      // O schema de applicants não guarda um endereço (rua/número) próprio,
      // só cidade/UF/CEP - ver packages/database/src/schema/applicants.ts.
      address: "",
      city: applicant.city ?? "",
      state: applicant.state ?? "",
      postalCode: applicant.postalCode ?? "",
      vehicleType: applicant.vehicleType ?? "",
    },
    platformCredential,
  });

  await db
    .update(applicants)
    .set({ status: "IN_PROGRESS", updatedAt: new Date() })
    .where(eq(applicants.id, applicantId));

  return { jobId };
}

export async function getApplicantStatusDistribution(companyId: string) {
  const rows = await db
    .select({ status: applicants.status, count: sql<number>`count(*)::int` })
    .from(applicants)
    .where(eq(applicants.companyId, companyId))
    .groupBy(applicants.status);

  return rows;
}
