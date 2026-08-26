import { eq } from "drizzle-orm";
import { db, companySettings } from "@uber-automation/database";
import {
  DEFAULT_PHONE_BASE_DIGITS,
  normalizePhoneBaseDigits,
  resolvePhoneBaseDigits,
} from "@uber-automation/platform-adapters";
import { DEFAULT_EARN_CITY } from "./earnCityPool";

export interface WorkerCompanySettings {
  placeholderPhoneBase: string;
  earnCity: string;
  source: "database" | "defaults";
}

/** Settings efetivas da empresa — lidas a cada allocate (sem restart). */
export async function loadCompanySettingsForWorker(
  companyId: string,
): Promise<WorkerCompanySettings> {
  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (!row) {
    return {
      placeholderPhoneBase: resolvePhoneBaseDigits(),
      earnCity: process.env.UBER_EARN_CITY?.trim() || DEFAULT_EARN_CITY,
      source: "defaults",
    };
  }

  return {
    placeholderPhoneBase:
      normalizePhoneBaseDigits(row.placeholderPhoneBase) || DEFAULT_PHONE_BASE_DIGITS,
    earnCity: row.earnCity.trim() || DEFAULT_EARN_CITY,
    source: "database",
  };
}
