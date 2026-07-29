import type { AuditLogSink, AuditLogEntry } from "@uber-automation/security";
import { db } from "./client";
import { auditLogs } from "./schema/auditLogs";

/**
 * Sink de AuditLogger que persiste em `audit_logs`. O AuditLogger ja mascara
 * `metadata` antes de chamar o sink, entao esta funcao nunca recebe segredo
 * em texto puro - apenas grava o que ja chegou sanitizado.
 */
export function createDatabaseAuditLogSink(): AuditLogSink {
  return async (entry: AuditLogEntry) => {
    await db.insert(auditLogs).values({
      companyId: entry.companyId,
      operatorId: entry.operatorId,
      applicantId: entry.applicantId,
      action: entry.action,
      metadataSanitized: entry.metadata ?? null,
    });
  };
}
