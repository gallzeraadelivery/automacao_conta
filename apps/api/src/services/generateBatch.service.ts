import { and, eq, inArray } from "drizzle-orm";
import { db, applicants, proxyConfigs } from "@uber-automation/database";
import { HttpError } from "../middleware/errorHandler";
import { clearAutomationStopAll } from "../lib/automationQueue";
import { importEmailList } from "./emailListImport.service";
import { startAutomation } from "./applicants.service";
import { findReservedEmails } from "./usedEmails.service";
import {
  DEFAULT_SIGNUP_EMAIL_DOMAIN,
  DEFAULT_SIGNUP_EMAIL_PROVIDER,
  getCompanySettings,
} from "./companySettings.service";

const PASSWORD_SUFFIX = "@2026";
const MAX_COUNT = 100;

const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Diego", "Elena", "Felipe", "Gabriela", "Hugo", "Isabela", "Joao",
  "Karen", "Lucas", "Marina", "Nicolas", "Olivia", "Paulo", "Queila", "Rafael", "Sofia", "Tiago",
  "Ursula", "Vitor", "Wendy", "Xavier", "Yara", "Zelia", "Alice", "Breno", "Camila", "Davi",
  "Elisa", "Fabio", "Giovana", "Heitor", "Ingrid", "Jonas", "Katia", "Leandro", "Monica", "Nelson",
  "Otavio", "Patricia", "Renata", "Samuel", "Taina", "Vera", "Wagner", "Yasmin", "Arthur", "Beatriz",
];

const LAST_NAMES = [
  "Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Freitas", "Gomes", "Henrique", "Ibrahim", "Junqueira",
  "Klein", "Lima", "Mendes", "Nogueira", "Oliveira", "Pacheco", "Queiroz", "Ribeiro", "Santos", "Teixeira",
  "Uchoa", "Vasconcelos", "Werneck", "Xavier", "Yamamoto", "Zanetti", "Araujo", "Batista", "Correia", "Dias",
  "Farias", "Guimaraes", "Holanda", "Justino", "Lacerda", "Moraes", "Neves", "Pinto", "Rezende", "Silva",
  "Torres", "Vieira", "Wall", "Ximenes", "Yoshida", "Zamboni", "Castro", "Ferreira", "Souza", "Pereira",
];

/**
 * Mesma regra do adaptador Uber: Sobrenome@2026 (mín. 8 chars).
 */
export function buildLastNamePlatformPassword(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  let base =
    parts.length >= 2
      ? parts[parts.length - 1]!
      : parts[0] || "Motorista";
  base = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  while (`${base}${PASSWORD_SUFFIX}`.length < 8) {
    base += "x";
  }
  return `${base}${PASSWORD_SUFFIX}`;
}

/** Sufixo começa com dígito para o extractNameFromLocalPart não grudar letras no sobrenome. */
function randomSuffix(len = 6): string {
  const digits = "0123456789";
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = digits[Math.floor(Math.random() * digits.length)]!;
  for (let i = 1; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

function pickCandidate(domain: string): {
  email: string;
  password: string;
  fullName: string;
  local: string;
} {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]!;
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]!;
  const local = `${firstName}${lastName}${randomSuffix()}`;
  const fullName = `${firstName} ${lastName}`;
  return {
    local,
    fullName,
    email: `${local}@${domain}`.toLowerCase(),
    password: buildLastNamePlatformPassword(fullName),
  };
}

export interface GenerateAndEnqueueBatchResult {
  requested: number;
  imported: number;
  enqueued: Array<{
    applicantId: string;
    fullName: string;
    email: string;
    jobId: string;
    proxyId: string;
  }>;
  skipped: Array<{ email?: string; fullName?: string; reason: string }>;
  activeProxyCount: number;
}

/**
 * Gera N e-mails inéditos no domínio configurado da empresa,
 * importa (IMAP do provider configurado) e enfileira no rodízio de proxies ACTIVE.
 * Senha Uber = Sobrenome@2026.
 */
export async function generateAndEnqueueBatch(
  companyId: string,
  count: number,
): Promise<GenerateAndEnqueueBatchResult> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new HttpError(
      400,
      "INVALID_COUNT",
      `Informe uma quantidade entre 1 e ${MAX_COUNT}`,
    );
  }

  const settings = await getCompanySettings(companyId);
  const emailDomain = settings.signupEmailDomain || DEFAULT_SIGNUP_EMAIL_DOMAIN;
  const emailProvider = settings.signupEmailProvider || DEFAULT_SIGNUP_EMAIL_PROVIDER;

  const activeProxies = await db
    .select({ id: proxyConfigs.id })
    .from(proxyConfigs)
    .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.status, "ACTIVE")))
    .orderBy(proxyConfigs.port, proxyConfigs.id);
  if (activeProxies.length === 0) {
    throw new HttpError(
      400,
      "NO_ACTIVE_PROXY",
      "Cadastre e teste ao menos um proxy ACTIVE antes de gerar o lote",
    );
  }

  const existingRows = await db
    .select({ email: applicants.email })
    .from(applicants)
    .where(eq(applicants.companyId, companyId));
  const blocked = new Set(existingRows.map((r) => r.email.toLowerCase()));

  const pool: Array<ReturnType<typeof pickCandidate>> = [];
  const maxAttempts = count * 50;
  for (let attempt = 0; attempt < maxAttempts && pool.length < count * 2; attempt++) {
    const candidate = pickCandidate(emailDomain);
    if (blocked.has(candidate.email)) continue;
    blocked.add(candidate.email);
    pool.push(candidate);
  }

  const reserved = await findReservedEmails(
    companyId,
    pool.map((c) => c.email),
  );
  const finalCandidates = pool.filter((c) => !reserved.has(c.email)).slice(0, count);

  if (finalCandidates.length < count) {
    throw new HttpError(
      409,
      "EMAIL_POOL_EXHAUSTED",
      `Só foi possível gerar ${finalCandidates.length} e-mail(s) livre(s) de ${count} pedidos`,
    );
  }

  const textCased = finalCandidates
    .map((c) => `${c.local}@${emailDomain}|${c.password}`)
    .join("\n");

  const importResult = await importEmailList(companyId, textCased, { provider: emailProvider });
  if (importResult.imported === 0) {
    throw new HttpError(
      400,
      "IMPORT_FAILED",
      `Nenhum e-mail importado (${importResult.skipped} ignorado(s))`,
    );
  }

  const emails = finalCandidates.map((c) => c.email);
  const importedApplicants = await db
    .select({
      id: applicants.id,
      fullName: applicants.fullName,
      email: applicants.email,
    })
    .from(applicants)
    .where(and(eq(applicants.companyId, companyId), inArray(applicants.email, emails)));

  const byEmail = new Map(
    importedApplicants.map((a) => [a.email.toLowerCase(), a] as const),
  );

  await clearAutomationStopAll(companyId);

  const enqueued: GenerateAndEnqueueBatchResult["enqueued"] = [];
  const skipped: GenerateAndEnqueueBatchResult["skipped"] = [];
  let proxyIndex = 0;

  for (const candidate of finalCandidates) {
    const row = byEmail.get(candidate.email);
    if (!row) {
      skipped.push({
        email: candidate.email,
        fullName: candidate.fullName,
        reason: "não encontrado após import",
      });
      continue;
    }
    const proxyId = activeProxies[proxyIndex % activeProxies.length]!.id;
    proxyIndex += 1;
    try {
      const { jobId } = await startAutomation(companyId, row.id, {
        proxyId,
        platformPassword: buildLastNamePlatformPassword(row.fullName),
      });
      enqueued.push({
        applicantId: row.id,
        fullName: row.fullName,
        email: row.email,
        jobId,
        proxyId,
      });
    } catch (error) {
      skipped.push({
        email: row.email,
        fullName: row.fullName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    requested: count,
    imported: importResult.imported,
    enqueued,
    skipped,
    activeProxyCount: activeProxies.length,
  };
}
