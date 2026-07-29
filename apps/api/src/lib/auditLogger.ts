import { AuditLogger } from "@uber-automation/security";
import { createDatabaseAuditLogSink } from "@uber-automation/database";

/**
 * Instância única (por processo) do AuditLogger, gravando em `audit_logs`.
 * Todo `metadata` passado a `.log()` já é mascarado automaticamente antes
 * de chegar ao banco - nenhuma rota precisa lembrar de sanitizar na mão.
 */
export const auditLogger = new AuditLogger({ sink: createDatabaseAuditLogSink() });
