import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

export const OPERATOR_ROLES = ["admin", "operator", "viewer"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const operators = pgTable("operators", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("operator"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
