import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { applicants } from "./applicants";
import { operators } from "./operators";

/**
 * Link seguro e temporário entregue ao motorista pela Central de
 * Pendências, para que ele complete pessoalmente a etapa sensível
 * (foto/CNH/CAPTCHA/2FA) diretamente na plataforma real - nunca um
 * "handoff" de uma sessão de navegador/automação ao vivo, apenas uma
 * página informativa com instruções e o prazo de expiração.
 *
 * Só o hash SHA-256 do token é armazenado (mesmo padrão de token de reset
 * de senha) - o token em texto puro existe apenas no momento da criação
 * (devolvido uma única vez na resposta da API) e no link entregue ao
 * motorista, nunca no banco.
 */
export const driverDeliveries = pgTable("driver_deliveries", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  applicantId: uuid("applicant_id")
    .notNull()
    .references(() => applicants.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  createdByOperatorId: uuid("created_by_operator_id").references(() => operators.id),
  expiresAt: timestamp("expires_at").notNull(),
  openedAt: timestamp("opened_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DriverDelivery = typeof driverDeliveries.$inferSelect;
export type NewDriverDelivery = typeof driverDeliveries.$inferInsert;
