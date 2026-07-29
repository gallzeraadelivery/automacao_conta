import type { AuditLogEntry } from "@uber-automation/security";
import { auditLogger } from "../lib/auditLogger";

export type AuditLogInput = AuditLogEntry;

/**
 * Fina camada de compatibilidade sobre o AuditLogger compartilhado - mantém
 * a assinatura já usada em todas as rotas. `metadata` é mascarado
 * automaticamente pelo AuditLogger antes de ser persistido.
 */
export async function logAudit(input: AuditLogInput): Promise<void> {
  await auditLogger.log(input);
}
