import { pgTable, uuid, varchar, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

/**
 * Registro permanente de e-mails já usados na empresa.
 * Sobrevive à exclusão do motorista (ex.: limpeza de Veriff) para o
 * import nunca recriar o mesmo endereço.
 */
export const usedEmails = pgTable(
  "used_emails",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    source: varchar("source", { length: 50 }).notNull().default("import"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    companyEmailUnique: unique("used_emails_company_email_unique").on(
      table.companyId,
      table.email,
    ),
  }),
);

export type UsedEmail = typeof usedEmails.$inferSelect;
export type NewUsedEmail = typeof usedEmails.$inferInsert;
