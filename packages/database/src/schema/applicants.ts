import { pgTable, uuid, varchar, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { operators } from "./operators";

export const APPLICANT_STATUSES = [
  "NEW",
  "CONSENT_PENDING",
  "READY_TO_START",
  "IN_PROGRESS",
  "AWAITING_HUMAN_ACTION",
  "RESOLVED",
  "CANCELLED",
  "COMPLETED",
  "FAILED",
] as const;
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];

/**
 * Motivo pelo qual a automação pausou e pediu ação humana - mesmos valores
 * de `AutomationPauseReason` em `@uber-automation/platform-adapters` (Fase
 * 5), que por sua vez foram desenhados para bater com o subconjunto
 * relevante de `NonRetryableReason` (`apps/worker/src/errors.ts`, Fase 2).
 */
export const PAUSE_REASONS = [
  "IDENTITY_VERIFICATION_REQUIRED",
  "NON_SOCURE_PROVIDER",
  "CAPTCHA",
  "TWO_FACTOR",
  "SECURITY_BLOCK",
  "REFUSED",
  "PHONE_PROBLEM",
] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export const VERIFICATION_PROVIDER_STATUSES = [
  "SOCURE",
  "NOT_SOCURE",
  "OTHER_PROVIDER",
  "UNKNOWN",
] as const;
export type VerificationProviderStatus = (typeof VERIFICATION_PROVIDER_STATUSES)[number];

export const applicants = pgTable(
  "applicants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    postalCode: varchar("postal_code", { length: 20 }),
    vehicleType: varchar("vehicle_type", { length: 50 }),
    consentAt: timestamp("consent_at"),
    status: varchar("status", { length: 50 }).notNull().default("NEW"),
    currentStep: varchar("current_step", { length: 100 }),
    profilePhotoProvider: varchar("profile_photo_provider", { length: 50 }),
    profilePhotoConfidence: varchar("profile_photo_confidence", { length: 20 }),
    driverLicenseProvider: varchar("driver_license_provider", { length: 50 }),
    driverLicenseConfidence: varchar("driver_license_confidence", { length: 20 }),
    // Preenchidos quando status = AWAITING_HUMAN_ACTION - nunca contêm dado
    // sensível, apenas a categoria do motivo (ver PAUSE_REASONS) e quando
    // ocorreu. O detalhe legível fica no log de auditoria correspondente.
    pauseReason: varchar("pause_reason", { length: 50 }),
    pausedAt: timestamp("paused_at"),
    assignedOperatorId: uuid("assigned_operator_id").references(() => operators.id),
    resolvedByOperatorId: uuid("resolved_by_operator_id").references(() => operators.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyExternalIdUnique: unique("applicants_company_external_id_unique").on(
      table.companyId,
      table.externalId,
    ),
    companyEmailUnique: unique("applicants_company_email_unique").on(table.companyId, table.email),
  }),
);

export type Applicant = typeof applicants.$inferSelect;
export type NewApplicant = typeof applicants.$inferInsert;
