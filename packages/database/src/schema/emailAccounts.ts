import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { applicants } from "./applicants";

export const EMAIL_LOGIN_STATUSES = [
  "NOT_TESTED",
  "VALID",
  "INVALID_CREDENTIALS",
  "REQUIRES_2FA",
  "LOCKED",
  "ERROR",
] as const;
export type EmailLoginStatus = (typeof EMAIL_LOGIN_STATUSES)[number];

export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => applicants.id, { onDelete: "cascade" }),
    emailAddress: varchar("email_address", { length: 255 }).notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    encryptionIv: varchar("encryption_iv", { length: 255 }).notNull(),
    encryptionAuthTag: varchar("encryption_auth_tag", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("gmail"),
    loginStatus: varchar("login_status", { length: 50 }).notNull().default("NOT_TESTED"),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    requiresHumanAction: boolean("requires_human_action").notNull().default(false),
    lastLoginAt: timestamp("last_login_at"),
    lastCodeReceivedAt: timestamp("last_code_received_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    companyApplicantUnique: unique("email_accounts_company_applicant_unique").on(
      table.companyId,
      table.applicantId,
    ),
    companyEmailUnique: unique("email_accounts_company_email_unique").on(
      table.companyId,
      table.emailAddress,
    ),
  }),
);

export type EmailAccount = typeof emailAccounts.$inferSelect;
export type NewEmailAccount = typeof emailAccounts.$inferInsert;
