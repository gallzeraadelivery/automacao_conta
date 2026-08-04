import type { AuditLogSink, AuditLogEntry } from "@uber-automation/security";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { auditLogs } from "./schema/auditLogs";
import { applicants } from "./schema/applicants";
import { liveStepFromAuditAction } from "./liveProgress";

/**
 * Sink de AuditLogger que persiste em `audit_logs`. O AuditLogger ja mascara
 * `metadata` antes de chamar o sink, entao esta funcao nunca recebe segredo
 * em texto puro - apenas grava o que ja chegou sanitizado.
 *
 * Também espelha o progresso fino em `applicants.current_step` para o painel
 * mostrar a etapa ao vivo (lista + detalhe) sem polling extra de logs.
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

    const liveStep = entry.applicantId ? liveStepFromAuditAction(entry.action) : null;
    if (entry.applicantId && liveStep) {
      await db
        .update(applicants)
        .set({ currentStep: liveStep, updatedAt: new Date() })
        .where(eq(applicants.id, entry.applicantId))
        .catch(() => undefined);
    }
  };
}
