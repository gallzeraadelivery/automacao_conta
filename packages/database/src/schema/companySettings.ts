import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompanySettings = typeof companySettings.$inferSelect;
export type NewCompanySettings = typeof companySettings.$inferInsert;
