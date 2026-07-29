import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { applicants } from "./applicants";
import { emailAccounts } from "./emailAccounts";
import { proxyConfigs } from "./proxyConfigs";

export const BROWSER_PROFILE_STATUSES = ["CREATED", "IN_USE", "IDLE", "ARCHIVED"] as const;
export type BrowserProfileStatus = (typeof BROWSER_PROFILE_STATUSES)[number];

export const browserProfiles = pgTable("browser_profiles", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  applicantId: uuid("applicant_id")
    .notNull()
    .references(() => applicants.id, { onDelete: "cascade" }),
  emailAccountId: uuid("email_account_id").references(() => emailAccounts.id),
  proxyId: uuid("proxy_id").references(() => proxyConfigs.id),
  encryptedStoragePath: text("encrypted_storage_path").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("CREATED"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BrowserProfile = typeof browserProfiles.$inferSelect;
export type NewBrowserProfile = typeof browserProfiles.$inferInsert;
