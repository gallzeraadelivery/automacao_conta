import { eq } from "drizzle-orm";
import { db, companySettings } from "@uber-automation/database";
import type { UpdateCompanySettingsInput } from "@uber-automation/shared";

export const DEFAULT_PHONE_BASE = "5613265300";
export const DEFAULT_EARN_CITY = "Orlando, FL";

export interface CompanySettingsView {
  placeholderPhoneBase: string;
  placeholderPhonePreview: string;
  earnCity: string;
  source: "database" | "defaults";
  updatedAt: string | null;
}

function normalizePhoneBase(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length !== 10) return DEFAULT_PHONE_BASE;
  return digits;
}

function previewPhone(digits: string): string {
  const d = normalizePhoneBase(digits);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

function defaultsView(): CompanySettingsView {
  const fromEnv = process.env.UBER_PLACEHOLDER_PHONE_BASE;
  const base = normalizePhoneBase(fromEnv);
  return {
    placeholderPhoneBase: base,
    placeholderPhonePreview: previewPhone(base),
    earnCity: process.env.UBER_EARN_CITY?.trim() || DEFAULT_EARN_CITY,
    source: "defaults",
    updatedAt: null,
  };
}

export async function getCompanySettings(companyId: string): Promise<CompanySettingsView> {
  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (!row) return defaultsView();

  const base = normalizePhoneBase(row.placeholderPhoneBase);
  return {
    placeholderPhoneBase: base,
    placeholderPhonePreview: previewPhone(base),
    earnCity: row.earnCity.trim() || DEFAULT_EARN_CITY,
    source: "database",
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateCompanySettings(
  companyId: string,
  input: UpdateCompanySettingsInput,
): Promise<{ previous: CompanySettingsView; current: CompanySettingsView }> {
  const previous = await getCompanySettings(companyId);
  const base = normalizePhoneBase(input.placeholderPhoneBase);
  const earnCity = input.earnCity.trim() || DEFAULT_EARN_CITY;
  const now = new Date();

  await db
    .insert(companySettings)
    .values({
      companyId,
      placeholderPhoneBase: base,
      earnCity,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: companySettings.companyId,
      set: {
        placeholderPhoneBase: base,
        earnCity,
        updatedAt: now,
      },
    });

  return { previous, current: await getCompanySettings(companyId) };
}
