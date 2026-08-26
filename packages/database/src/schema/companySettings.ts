import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * Configuração operacional por empresa (editável no painel).
 * Fallbacks de env (`UBER_PLACEHOLDER_PHONE_BASE`, etc.) só valem se
 * ainda não houver linha — o worker/API leem daqui em runtime.
 */
export const companySettings = pgTable("company_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  /** 10 dígitos NANP — base dos placeholders (ex.: 5613265300). */
  placeholderPhoneBase: varchar("placeholder_phone_base", { length: 10 }).notNull(),
  /** Cidade na tela Earn with Uber (ex.: "Orlando, FL"). */
  earnCity: varchar("earn_city", { length: 100 }).notNull(),
  /** Domínio dos e-mails gerados no lote (ex.: mailsproton.com). */
  signupEmailDomain: varchar("signup_email_domain", { length: 255 }),
  /** Provider IMAP das contas importadas (gmail, spacemail, …). */
  signupEmailProvider: varchar("signup_email_provider", { length: 50 }),
  /** Caixa IMAP compartilhada onde cai o OTP (catch-all). */
  catchallInboxEmail: varchar("catchall_inbox_email", { length: 255 }),
  /**
   * Domínios (CSV) cujo OTP é lido na caixa catch-all.
   * Ex.: "mailsproton.com,mail2too.com"
   */
  catchallDomains: text("catchall_domains"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompanySettings = typeof companySettings.$inferSelect;
export type NewCompanySettings = typeof companySettings.$inferInsert;
