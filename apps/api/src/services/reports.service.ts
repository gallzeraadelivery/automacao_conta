import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, applicants, auditLogs, operators } from "@uber-automation/database";

export interface ReportPeriod {
  from: Date;
  to: Date;
}

export interface AutomationReport {
  period: ReportPeriod;
  totalProcessed: number;
  successfulCount: number;
  failedCount: number;
  pausedCount: number;
  successRate: number;
  /** Segundos, não milissegundos - do primeiro import (createdAt) até a resolução. */
  averageTimeToCompleteSeconds: number;
  providerDistribution: { socure: number; other: number; unknown: number };
  errorDistribution: Record<string, number>;
  topErrors: Array<{ code: string; count: number; message: string }>;
  /** Motoristas do período com geo do proxy (lookup). */
  proxyGeoRows: Array<{
    id: string;
    externalId: string;
    fullName: string;
    status: string;
    proxyExternalIp: string | null;
    proxyGeoCity: string | null;
    proxyGeoRegion: string | null;
  }>;
}

/**
 * Mensagens legíveis para os códigos de `NonRetryableReason`/`TechnicalReason`
 * (`apps/worker/src/errors.ts`) que aparecem em `audit_logs.metadata_sanitized.reason`.
 * Mantido como um dicionário simples aqui (não importado de apps/worker - apps
 * não importam uns dos outros neste monorepo) só para exibição no relatório.
 */
const ERROR_MESSAGES: Record<string, string> = {
  CAPTCHA: "CAPTCHA detectado - exige verificação manual",
  SECURITY_BLOCK: "Bloqueio de segurança detectado pela plataforma",
  TWO_FACTOR: "Autenticação em duas etapas exigida",
  ACCOUNT_ALREADY_EXISTS: "Conta já existe na plataforma",
  IDENTITY_VERIFICATION_REQUIRED: "Etapa de verificação de identidade detectada",
  DOCUMENT_UPLOAD_REQUIRED: "Envio de documento exigido pela plataforma",
  REFUSED: "Uber Internal Server Error / unauthorized — e-mail descartado",
  DATA_INCONSISTENCY: "Inconsistência de dados detectada",
  NON_SOCURE_PROVIDER: "Provedor de verificação diferente do esperado (não Socure)",
  SUSPICIOUS_ACTIVITY: "Atividade suspeita detectada pela plataforma",
  TIMEOUT: "Tempo limite excedido (falha técnica)",
  CONNECTION_FAILURE: "Falha de conexão (falha técnica)",
  PAGE_UNAVAILABLE: "Página indisponível (falha técnica)",
  PHONE_SMS_RETRY: "Erro de SMS / telefone (retentável)",
  PHONE_PROBLEM: "Problema celular (tentar depois com outros números)",
  LOAD_ERROR: "Erro ao carregar página (falha técnica)",
  PROXY_UNAVAILABLE: "Proxy indisponível (falha técnica)",
  UNKNOWN: "Motivo não classificado",
};

const FAILURE_AUDIT_ACTIONS = ["automation_job_attempt_failed", "automation_job_failed_final"];

export async function buildAutomationReport(
  companyId: string,
  period: ReportPeriod,
): Promise<AutomationReport> {
  const rows = await db
    .select()
    .from(applicants)
    .where(
      and(
        eq(applicants.companyId, companyId),
        gte(applicants.updatedAt, period.from),
        lte(applicants.updatedAt, period.to),
      ),
    );

  const processed = rows.filter((row) => row.status !== "NEW");
  const successful = processed.filter(
    (row) => row.status === "COMPLETED" || row.status === "RESOLVED",
  );
  const failed = processed.filter((row) => row.status === "FAILED" || row.status === "CANCELLED");
  const paused = processed.filter((row) => row.status === "AWAITING_HUMAN_ACTION");

  const completionSeconds = successful
    .map((row) => {
      const end = row.resolvedAt ?? row.updatedAt;
      return (end.getTime() - row.createdAt.getTime()) / 1000;
    })
    .filter((seconds) => seconds >= 0);
  const averageTimeToCompleteSeconds =
    completionSeconds.length > 0
      ? Math.round(
          completionSeconds.reduce((sum, value) => sum + value, 0) / completionSeconds.length,
        )
      : 0;

  const providerDistribution = { socure: 0, other: 0, unknown: 0 };
  for (const row of processed) {
    const provider = row.profilePhotoProvider ?? row.driverLicenseProvider;
    if (!provider) continue;
    if (provider === "SOCURE") providerDistribution.socure += 1;
    else if (provider === "NOT_SOCURE" || provider === "OTHER_PROVIDER")
      providerDistribution.other += 1;
    else providerDistribution.unknown += 1;
  }

  const errorRows = await db
    .select({
      reason: sql<string>`coalesce(${auditLogs.metadataSanitized}->>'reason', 'UNKNOWN')`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.companyId, companyId),
        inArray(auditLogs.action, FAILURE_AUDIT_ACTIONS),
        gte(auditLogs.createdAt, period.from),
        lte(auditLogs.createdAt, period.to),
      ),
    )
    .groupBy(sql`coalesce(${auditLogs.metadataSanitized}->>'reason', 'UNKNOWN')`);

  const errorDistribution: Record<string, number> = {};
  for (const row of errorRows) errorDistribution[row.reason] = row.count;

  const topErrors = [...errorRows]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((row) => ({
      code: row.reason,
      count: row.count,
      message: ERROR_MESSAGES[row.reason] ?? row.reason,
    }));

  return {
    period,
    totalProcessed: processed.length,
    successfulCount: successful.length,
    failedCount: failed.length,
    pausedCount: paused.length,
    successRate: processed.length > 0 ? successful.length / processed.length : 0,
    averageTimeToCompleteSeconds,
    providerDistribution,
    errorDistribution,
    topErrors,
    proxyGeoRows: processed
      .filter((row) => row.proxyGeoCity || row.proxyGeoRegion || row.proxyExternalIp)
      .map((row) => ({
        id: row.id,
        externalId: row.externalId,
        fullName: row.fullName,
        status: row.status,
        proxyExternalIp: row.proxyExternalIp ?? null,
        proxyGeoCity: row.proxyGeoCity ?? null,
        proxyGeoRegion: row.proxyGeoRegion ?? null,
      })),
  };
}

export interface AuditReport {
  period: ReportPeriod;
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByOperator: Array<{ operator: string; count: number }>;
  securityEvents: Array<{ timestamp: Date; event: string; severity: "LOW" | "MEDIUM" | "HIGH" }>;
}

/** Curadoria de quais `action`s de auditoria contam como "evento de segurança" - nem toda ação do dia a dia é um evento de segurança. */
const SECURITY_EVENT_SEVERITY: Record<string, "LOW" | "MEDIUM" | "HIGH"> = {
  login: "LOW",
  logout: "LOW",
  deliver_to_driver: "LOW",
  pending_action_cancelled: "LOW",
  pending_action_resolved: "LOW",
  automation_job_paused: "MEDIUM",
  automation_job_failed_final: "MEDIUM",
  credential_decrypt_failed: "HIGH",
  browser_profile_locked: "HIGH",
};

export async function buildAuditReport(
  companyId: string,
  period: ReportPeriod,
): Promise<AuditReport> {
  const conditions = and(
    eq(auditLogs.companyId, companyId),
    gte(auditLogs.createdAt, period.from),
    lte(auditLogs.createdAt, period.to),
  );

  const [totalRows, byTypeRows, byOperatorRows, securityRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(conditions),
    db
      .select({ action: auditLogs.action, count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(conditions)
      .groupBy(auditLogs.action),
    db
      .select({
        operatorName: sql<string | null>`${operators.name}`,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .leftJoin(operators, eq(auditLogs.operatorId, operators.id))
      .where(conditions)
      .groupBy(operators.name),
    db
      .select({
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
      })
      .from(auditLogs)
      .where(and(conditions, inArray(auditLogs.action, Object.keys(SECURITY_EVENT_SEVERITY))))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
  ]);

  const actionsByType: Record<string, number> = {};
  for (const row of byTypeRows) actionsByType[row.action] = row.count;

  const actionsByOperator = byOperatorRows.map((row) => ({
    operator: row.operatorName ?? "Sistema (worker)",
    count: row.count,
  }));

  const securityEvents = securityRows.map((row) => ({
    timestamp: row.createdAt,
    event: row.action,
    severity: SECURITY_EVENT_SEVERITY[row.action] ?? "LOW",
  }));

  return {
    period,
    totalActions: totalRows[0]?.count ?? 0,
    actionsByType,
    actionsByOperator,
    securityEvents,
  };
}

export type VerificationProviderFilter = "socure" | "veriff" | "all";

export interface VerificationReportRow {
  id: string;
  externalId: string;
  fullName: string;
  email: string;
  status: string;
  pauseReason: string | null;
  currentStep: string | null;
  profilePhotoProvider: string | null;
  profilePhotoConfidence: string | null;
  driverLicenseProvider: string | null;
  driverLicenseConfidence: string | null;
  proxyExternalIp: string | null;
  proxyGeoCity: string | null;
  proxyGeoRegion: string | null;
  cookiesDownloadedAt: Date | null;
  pausedAt: Date | null;
  updatedAt: Date;
}

export interface VerificationReport {
  filter: VerificationProviderFilter;
  counts: { socure: number; veriff: number; all: number };
  total: number;
  items: VerificationReportRow[];
}

function hasProvider(row: VerificationReportRow, code: string): boolean {
  return row.profilePhotoProvider === code || row.driverLicenseProvider === code;
}

/**
 * Lista motoristas com probe de verificação (foto/CNH) para o BI Socure.
 * Filtro padrão: pelo menos um provedor = SOCURE.
 */
export async function listVerificationReport(
  companyId: string,
  filter: VerificationProviderFilter = "socure",
): Promise<VerificationReport> {
  const rows = await db
    .select({
      id: applicants.id,
      externalId: applicants.externalId,
      fullName: applicants.fullName,
      email: applicants.email,
      status: applicants.status,
      pauseReason: applicants.pauseReason,
      currentStep: applicants.currentStep,
      profilePhotoProvider: applicants.profilePhotoProvider,
      profilePhotoConfidence: applicants.profilePhotoConfidence,
      driverLicenseProvider: applicants.driverLicenseProvider,
      driverLicenseConfidence: applicants.driverLicenseConfidence,
      proxyExternalIp: applicants.proxyExternalIp,
      proxyGeoCity: applicants.proxyGeoCity,
      proxyGeoRegion: applicants.proxyGeoRegion,
      cookiesDownloadedAt: applicants.cookiesDownloadedAt,
      pausedAt: applicants.pausedAt,
      updatedAt: applicants.updatedAt,
    })
    .from(applicants)
    .where(
      and(
        eq(applicants.companyId, companyId),
        sql`(${applicants.profilePhotoProvider} is not null or ${applicants.driverLicenseProvider} is not null)`,
      ),
    )
    .orderBy(desc(applicants.updatedAt));

  const counts = { socure: 0, veriff: 0, all: rows.length };
  for (const row of rows) {
    if (hasProvider(row, "SOCURE")) counts.socure += 1;
    if (hasProvider(row, "VERIFF")) counts.veriff += 1;
  }

  const items =
    filter === "all"
      ? rows
      : filter === "socure"
        ? rows.filter((row) => hasProvider(row, "SOCURE"))
        : rows.filter((row) => hasProvider(row, "VERIFF"));

  return { filter, counts, total: items.length, items };
}

export interface SocureProxyGeoCityRow {
  city: string;
  region: string;
  total: number;
  socure: number;
  veriff: number;
  identidade: number;
  security: number;
  phone: number;
  pctSocure: number;
  pctVeriff: number;
}

export interface SocureProxyGeoReport {
  totals: {
    withGeo: number;
    cities: number;
    socure: number;
    veriff: number;
    identidade: number;
    security: number;
    phone: number;
  };
  /** Ranking absoluto por Socure (provider). */
  bySocure: SocureProxyGeoCityRow[];
  /** Ranking absoluto por Veriff (pause NON_SOCURE_PROVIDER). */
  byVeriff: SocureProxyGeoCityRow[];
  /** Melhor taxa Socure com total >= minSample. */
  bySocureRate: SocureProxyGeoCityRow[];
}

/**
 * BI: cidades do proxy × Socure (foto/CNH) e Veriff (pause NON_SOCURE_PROVIDER).
 * Só inclui motoristas com `proxy_geo_city` preenchido.
 */
export async function buildSocureProxyGeoReport(
  companyId: string,
  options: { minSampleForRate?: number } = {},
): Promise<SocureProxyGeoReport> {
  const minSample = options.minSampleForRate ?? 3;

  const rows = await db
    .select({
      proxyGeoCity: applicants.proxyGeoCity,
      proxyGeoRegion: applicants.proxyGeoRegion,
      profilePhotoProvider: applicants.profilePhotoProvider,
      driverLicenseProvider: applicants.driverLicenseProvider,
      pauseReason: applicants.pauseReason,
      currentStep: applicants.currentStep,
    })
    .from(applicants)
    .where(
      and(
        eq(applicants.companyId, companyId),
        sql`${applicants.proxyGeoCity} is not null and trim(${applicants.proxyGeoCity}) <> ''`,
      ),
    );

  const byKey = new Map<
    string,
    {
      city: string;
      region: string;
      total: number;
      socure: number;
      veriff: number;
      identidade: number;
      security: number;
      phone: number;
    }
  >();

  for (const row of rows) {
    const city = (row.proxyGeoCity ?? "").trim() || "(sem cidade)";
    const region = (row.proxyGeoRegion ?? "").trim();
    const key = `${city.toLowerCase()}|${region.toLowerCase()}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { city, region, total: 0, socure: 0, veriff: 0, identidade: 0, security: 0, phone: 0 };
      byKey.set(key, agg);
    }
    agg.total += 1;
    if (row.profilePhotoProvider === "SOCURE" || row.driverLicenseProvider === "SOCURE") {
      agg.socure += 1;
    }
    if (row.pauseReason === "NON_SOCURE_PROVIDER") {
      agg.veriff += 1;
    }
    if (row.pauseReason === "IDENTITY_VERIFICATION_REQUIRED") {
      agg.identidade += 1;
    }
    if (row.pauseReason === "SECURITY_BLOCK") {
      agg.security += 1;
    }
    if (row.pauseReason === "PHONE_PROBLEM" || row.currentStep === "PHONE_PROBLEM") {
      agg.phone += 1;
    }
  }

  const cities: SocureProxyGeoCityRow[] = [...byKey.values()].map((agg) => ({
    ...agg,
    pctSocure: agg.total > 0 ? Math.round((1000 * agg.socure) / agg.total) / 10 : 0,
    pctVeriff: agg.total > 0 ? Math.round((1000 * agg.veriff) / agg.total) / 10 : 0,
  }));

  const bySocure = [...cities]
    .filter((c) => c.socure > 0)
    .sort((a, b) => b.socure - a.socure || b.total - a.total);

  const byVeriff = [...cities]
    .filter((c) => c.veriff > 0)
    .sort((a, b) => b.veriff - a.veriff || b.total - a.total);

  const bySocureRate = [...cities]
    .filter((c) => c.total >= minSample && c.socure > 0)
    .sort((a, b) => b.pctSocure - a.pctSocure || b.socure - a.socure);

  const totals = {
    withGeo: rows.length,
    cities: cities.length,
    socure: cities.reduce((s, c) => s + c.socure, 0),
    veriff: cities.reduce((s, c) => s + c.veriff, 0),
    identidade: cities.reduce((s, c) => s + c.identidade, 0),
    security: cities.reduce((s, c) => s + c.security, 0),
    phone: cities.reduce((s, c) => s + c.phone, 0),
  };

  return { totals, bySocure, byVeriff, bySocureRate };
}
