import { db, auditLogs } from "@uber-automation/database";

export interface AuditLogInput {
  companyId: string;
  operatorId?: string;
  applicantId?: string;
  action: string;
  // Nunca incluir senhas, tokens ou codigos de verificacao aqui.
  metadata?: Record<string, unknown>;
}

export async function logAudit(input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    companyId: input.companyId,
    operatorId: input.operatorId,
    applicantId: input.applicantId,
    action: input.action,
    metadataSanitized: input.metadata ?? null,
  });
}
