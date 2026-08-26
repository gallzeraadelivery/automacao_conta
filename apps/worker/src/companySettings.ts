import { eq } from "drizzle-orm";
import { db, companySettings } from "@uber-automation/database";
import {
  DEFAULT_PHONE_BASE_DIGITS,
  normalizePhoneBaseDigits,
  resolvePhoneBaseDigits,
} from "@uber-automation/platform-adapters";
import { DEFAULT_EARN_CITY } from "./earnCityPool";

export const DEFAULT_SIGNUP_EMAIL_DOMAIN = "mailsproton.com";
export const DEFAULT_SIGNUP_EMAIL_PROVIDER = "spacemail";
export const DEFAULT_CATCHALL_INBOX_EMAIL = "galldelivery@mail2too.com";
export const DEFAULT_CATCHALL_DOMAINS = "mailsproton.com,mail2too.com";

export interface WorkerCompanySettings {
  placeholderPhoneBase: string;
  earnCity: string;
  signupEmailDomain: string;
  signupEmailProvider: string;
  catchallInboxEmail: string;
  catchallDomains: string;
  source: "database" | "defaults";
}

function normalizeDomain(raw: string | null | undefined, fallback: string): string {
  return (raw ?? "").trim().toLowerCase() || fallback;
}

function normalizeDomainsCsv(raw: string | null | undefined, fallback: string): string {
  const parts = (raw ?? "")
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  return [...new Set(parts)].join(",");
}

/** Mapa domínio → caixa IMAP catch-all a partir das settings da empresa. */
export function buildCatchallDomainMapFromSettings(settings: {
  catchallInboxEmail: string;
  catchallDomains: string;
  signupEmailDomain: string;
}): Record<string, string> {
  const inbox = settings.catchallInboxEmail.trim().toLowerCase();
  const domains = new Set(
    settings.catchallDomains
      .split(/[,;\s]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  );
  domains.add(settings.signupEmailDomain.trim().toLowerCase());
  const map: Record<string, string> = {};
  for (const domain of domains) {
    if (domain) map[domain] = inbox;
  }
  return map;
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
      signupEmailDomain: DEFAULT_SIGNUP_EMAIL_DOMAIN,
      signupEmailProvider: DEFAULT_SIGNUP_EMAIL_PROVIDER,
      catchallInboxEmail: DEFAULT_CATCHALL_INBOX_EMAIL,
      catchallDomains: DEFAULT_CATCHALL_DOMAINS,
      source: "defaults",
    };
  }

  return {
    placeholderPhoneBase:
      normalizePhoneBaseDigits(row.placeholderPhoneBase) || DEFAULT_PHONE_BASE_DIGITS,
    earnCity: row.earnCity.trim() || DEFAULT_EARN_CITY,
    signupEmailDomain: normalizeDomain(row.signupEmailDomain, DEFAULT_SIGNUP_EMAIL_DOMAIN),
    signupEmailProvider: normalizeDomain(
      row.signupEmailProvider,
      DEFAULT_SIGNUP_EMAIL_PROVIDER,
    ),
    catchallInboxEmail:
      (row.catchallInboxEmail ?? "").trim().toLowerCase() || DEFAULT_CATCHALL_INBOX_EMAIL,
    catchallDomains: normalizeDomainsCsv(row.catchallDomains, DEFAULT_CATCHALL_DOMAINS),
    source: "database",
  };
}

export async function loadCatchallDomainMapForCompany(
  companyId: string,
): Promise<Record<string, string>> {
  const settings = await loadCompanySettingsForWorker(companyId);
  return buildCatchallDomainMapFromSettings(settings);
}
