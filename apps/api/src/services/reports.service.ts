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
