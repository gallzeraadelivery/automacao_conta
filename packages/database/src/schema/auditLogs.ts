import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { operators } from "./operators";
import { applicants } from "./applicants";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    operatorId: uuid("operator_id").references(() => operators.id),
    applicantId: uuid("applicant_id").references(() => applicants.id),
    // Ex: 'import_applicants', 'start_automation', 'proxy_test', 'login', 'logout'
    action: varchar("action", { length: 255 }).notNull(),
    // NUNCA incluir senhas, tokens, codigos de verificacao ou qualquer segredo aqui.
    metadataSanitized: jsonb("metadata_sanitized"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("idx_company_created").on(table.companyId, table.createdAt),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
