import { pgTable, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

export const PROXY_PROTOCOLS = ["http", "https", "socks5"] as const;
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

export const PROXY_STATUSES = ["UNTESTED", "ACTIVE", "INACTIVE", "ERROR"] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

export const proxyConfigs = pgTable("proxy_configs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  hostEncrypted: text("host_encrypted").notNull(),
  port: integer("port").notNull(),
  protocol: varchar("protocol", { length: 10 }).notNull().default("http"),
  usernameEncrypted: text("username_encrypted"),
  passwordEncrypted: text("password_encrypted"),
  encryptionIv: varchar("encryption_iv", { length: 255 }).notNull(),
  encryptionAuthTag: varchar("encryption_auth_tag", { length: 255 }).notNull(),
  declaredRegion: varchar("declared_region", { length: 50 }),
  status: varchar("status", { length: 50 }).notNull().default("UNTESTED"),
  latencyMs: integer("latency_ms"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProxyConfig = typeof proxyConfigs.$inferSelect;
export type NewProxyConfig = typeof proxyConfigs.$inferInsert;
