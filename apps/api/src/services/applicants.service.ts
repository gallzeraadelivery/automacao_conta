import path from "node:path";
import { access, readFile, readdir, rm, unlink } from "node:fs/promises";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  applicants,
  proxyConfigs,
  emailAccounts,
  auditLogs,
  browserProfiles,
} from "@uber-automation/database";
import {
  validateApplicantImportRows,
  type ApplicantImportRow,
  type ImportRowError,
} from "@uber-automation/shared";
import { HttpError } from "../middleware/errorHandler";
import { createCredentialVault } from "../lib/credentialVault";
import {
  cancelAutomationJobsForApplicant,
  enqueueOpenManualBrowserJob,
  enqueueStartAutomationJob,
  signalCloseManualBrowser,
} from "../lib/automationQueue";
import { env } from "../env";
import { defaultBrowserProfilesRoot, MONOREPO_ROOT, resolveApplicantProfileDir } from "../lib/storagePaths";

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
    .set({
      status: "IN_PROGRESS",
      pauseReason: null,
      resolvedAt: null,
      resolvedByOperatorId: null,
      currentStep: "RUN_ADMINISTRATIVE_FLOW",
      updatedAt: new Date(),
    })
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveUberCookiesFile(applicantId: string): Promise<string | null> {
  const profileDir = await resolveApplicantProfileDir(
    env.BROWSER_PROFILES_STORAGE_PATH || defaultBrowserProfilesRoot(),
    applicantId,
  );
  const filePath = path.join(profileDir, "uber", "cookies.json");
  return (await pathExists(filePath)) ? filePath : null;
}

/**
 * Hard-delete do motorista: limpa jobs BullMQ, desvincula audit_logs,
 * apaga pasta do browser profile + screenshots, e DELETE no Postgres
 * (cascade cobre email_accounts / browser_profiles / driver_deliveries).
 */
export async function deleteApplicant(companyId: string, applicantId: string): Promise<void> {
  const applicant = await getApplicantById(companyId, applicantId);
  if (!applicant) {
    throw new HttpError(404, "NOT_FOUND", "Motorista não encontrado");
  }

  await cancelAutomationJobsForApplicant(applicantId).catch(() => 0);

  await db
    .update(auditLogs)
    .set({ applicantId: null })
    .where(eq(auditLogs.applicantId, applicantId));

  await db.delete(applicants).where(eq(applicants.id, applicantId));

  const profileDir = await resolveApplicantProfileDir(
    env.BROWSER_PROFILES_STORAGE_PATH || defaultBrowserProfilesRoot(),
    applicantId,
  );
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);

  const screenshotsRoot = path.isAbsolute(env.AUTOMATION_SCREENSHOTS_PATH)
    ? env.AUTOMATION_SCREENSHOTS_PATH
    : path.resolve(MONOREPO_ROOT, env.AUTOMATION_SCREENSHOTS_PATH);
  // Prefer worker screenshots path as well.
  for (const root of [
    screenshotsRoot,
    path.resolve(MONOREPO_ROOT, "apps/worker/storage/automation-screenshots"),
  ]) {
    const files = await readdir(root).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((name) => name.startsWith(applicantId))
        .map((name) => unlink(path.join(root, name)).catch(() => undefined)),
    );
  }
}

export interface UberCookiesExport {
  applicantId: string;
  externalId: string;
  fullName: string;
  cookieCount: number;
  cookies: unknown[];
  exportedAt: string;
}

/**
 * Lê cookies Uber persistidos pelo worker após o job (Playwright JSON).
 * Útil para reabrir a sessão / importar no browser.
 */
export async function getUberCookiesExport(
  companyId: string,
  applicantId: string,
): Promise<UberCookiesExport> {
  const applicant = await getApplicantById(companyId, applicantId);
  if (!applicant) {
    throw new HttpError(404, "NOT_FOUND", "Motorista não encontrado");
  }

  const filePath = await resolveUberCookiesFile(applicantId);
  if (!filePath) {
    throw new HttpError(
      404,
      "COOKIES_NOT_FOUND",
      "Nenhum cookie Uber salvo ainda para este motorista (rode a automação até criar/pausar a conta)",
    );
  }

  let cookies: unknown[] = [];
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    cookies = Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new HttpError(500, "COOKIES_CORRUPT", "Arquivo de cookies inválido");
  }

  if (cookies.length === 0) {
    throw new HttpError(
      404,
      "COOKIES_EMPTY",
      "Arquivo de cookies existe mas está vazio — a sessão ainda não foi persistida",
    );
  }

  return {
    applicantId: applicant.id,
    externalId: applicant.externalId,
    fullName: applicant.fullName,
    cookieCount: cookies.length,
    cookies,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Enfileira sessão headed (janela real) com proxy + cookies do motorista
 * para intervenção manual (ex: SMS). Não altera o status do applicant.
 */
export async function openManualBrowser(
  companyId: string,
  applicantId: string,
  options?: { proxyId?: string },
): Promise<{ jobId: string; proxyId: string }> {
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
      "Cadastre o e-mail deste motorista antes de abrir o browser manual",
    );
  }

  let proxyId = options?.proxyId;
  if (!proxyId) {
    const [profile] = await db
      .select({ proxyId: browserProfiles.proxyId })
      .from(browserProfiles)
      .where(eq(browserProfiles.applicantId, applicantId))
      .limit(1);
    proxyId = profile?.proxyId ?? undefined;
  }
  if (!proxyId) {
    const [activeProxy] = await db
      .select({ id: proxyConfigs.id })
      .from(proxyConfigs)
      .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.status, "ACTIVE")))
      .limit(1);
    proxyId = activeProxy?.id;
  }
  if (!proxyId) {
    throw new HttpError(
      400,
      "PROXY_REQUIRED",
      "Informe um proxy ou cadastre/ative um proxy para a empresa",
    );
  }

  const [proxy] = await db
    .select({ id: proxyConfigs.id })
    .from(proxyConfigs)
    .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.id, proxyId)))
    .limit(1);
  if (!proxy) {
    throw new HttpError(400, "PROXY_NOT_FOUND", "Proxy inexistente para esta empresa");
  }

  const jobId = await enqueueOpenManualBrowserJob({
    companyId,
    applicantId,
    emailAccountId: emailAccount.id,
    proxyId,
  });

  return { jobId, proxyId };
}

/** Sinaliza o worker para fechar o Chromium manual deste motorista. */
export async function closeManualBrowser(
  companyId: string,
  applicantId: string,
): Promise<{ stopSignaled: boolean; removedQueuedJobs: number }> {
  const applicant = await getApplicantById(companyId, applicantId);
  if (!applicant) {
    throw new HttpError(404, "NOT_FOUND", "Motorista não encontrado");
  }

  const result = await signalCloseManualBrowser(applicantId);
  return {
    stopSignaled: result.stopSignaled,
    removedQueuedJobs: result.removedQueuedJobs,
  };
}
