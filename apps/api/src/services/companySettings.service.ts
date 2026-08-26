import { and, eq } from "drizzle-orm";
import {
  db,
  applicants,
  companySettings,
  emailAccounts,
} from "@uber-automation/database";
import type { UpdateCompanySettingsInput } from "@uber-automation/shared";
import { HttpError } from "../middleware/errorHandler";
import { createCredentialVault } from "../lib/credentialVault";

export const DEFAULT_PHONE_BASE = "5613265300";
export const DEFAULT_EARN_CITY = "Orlando, FL";
export const DEFAULT_SIGNUP_EMAIL_DOMAIN = "mailsproton.com";
export const DEFAULT_SIGNUP_EMAIL_PROVIDER = "spacemail";
export const DEFAULT_CATCHALL_INBOX_EMAIL = "galldelivery@mail2too.com";
export const DEFAULT_CATCHALL_DOMAINS = "mailsproton.com,mail2too.com";

export interface CompanySettingsView {
  placeholderPhoneBase: string;
  placeholderPhonePreview: string;
  earnCity: string;
  signupEmailDomain: string;
  signupEmailProvider: string;
  catchallInboxEmail: string;
  catchallDomains: string;
  catchallPasswordSet: boolean;
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

function normalizeDomain(raw: string | null | undefined, fallback: string): string {
  const value = (raw ?? "").trim().toLowerCase();
  return value || fallback;
}

function normalizeDomainsCsv(raw: string | null | undefined, fallback: string): string {
  const parts = (raw ?? "")
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  return [...new Set(parts)].join(",");
}

function normalizeEmail(raw: string | null | undefined, fallback: string): string {
  const value = (raw ?? "").trim().toLowerCase();
  return value || fallback;
}

function normalizeProvider(raw: string | null | undefined, fallback: string): string {
  const value = (raw ?? "").trim().toLowerCase();
  return value || fallback;
}

/** Mapa domínio → caixa IMAP catch-all (para o worker / email-service). */
export function buildCatchallDomainMap(input: {
  catchallInboxEmail: string;
  catchallDomains: string;
  signupEmailDomain?: string;
}): Record<string, string> {
  const inbox = input.catchallInboxEmail.trim().toLowerCase();
  const domains = new Set(
    input.catchallDomains
      .split(/[,;\s]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  );
  if (input.signupEmailDomain) {
    domains.add(input.signupEmailDomain.trim().toLowerCase());
  }
  const map: Record<string, string> = {};
  for (const domain of domains) {
    map[domain] = inbox;
  }
  return map;
}

async function isCatchallPasswordSet(companyId: string, inboxEmail: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(
      and(
        eq(emailAccounts.companyId, companyId),
        eq(emailAccounts.emailAddress, inboxEmail.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function defaultsView(): CompanySettingsView {
  const fromEnv = process.env.UBER_PLACEHOLDER_PHONE_BASE;
  const base = normalizePhoneBase(fromEnv);
  return {
    placeholderPhoneBase: base,
    placeholderPhonePreview: previewPhone(base),
    earnCity: process.env.UBER_EARN_CITY?.trim() || DEFAULT_EARN_CITY,
    signupEmailDomain: DEFAULT_SIGNUP_EMAIL_DOMAIN,
    signupEmailProvider: DEFAULT_SIGNUP_EMAIL_PROVIDER,
    catchallInboxEmail: DEFAULT_CATCHALL_INBOX_EMAIL,
    catchallDomains: DEFAULT_CATCHALL_DOMAINS,
    catchallPasswordSet: false,
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

  if (!row) {
    const view = defaultsView();
    view.catchallPasswordSet = await isCatchallPasswordSet(companyId, view.catchallInboxEmail);
    return view;
  }

  const base = normalizePhoneBase(row.placeholderPhoneBase);
  const catchallInboxEmail = normalizeEmail(row.catchallInboxEmail, DEFAULT_CATCHALL_INBOX_EMAIL);
  return {
    placeholderPhoneBase: base,
    placeholderPhonePreview: previewPhone(base),
    earnCity: row.earnCity.trim() || DEFAULT_EARN_CITY,
    signupEmailDomain: normalizeDomain(row.signupEmailDomain, DEFAULT_SIGNUP_EMAIL_DOMAIN),
    signupEmailProvider: normalizeProvider(
      row.signupEmailProvider,
      DEFAULT_SIGNUP_EMAIL_PROVIDER,
    ),
    catchallInboxEmail,
    catchallDomains: normalizeDomainsCsv(row.catchallDomains, DEFAULT_CATCHALL_DOMAINS),
    catchallPasswordSet: await isCatchallPasswordSet(companyId, catchallInboxEmail),
    source: "database",
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Garante applicant + email_accounts da caixa catch-all (senha criptografada).
 * Se a senha vier vazia e já existir conta, só atualiza e-mail/provider.
 */
async function upsertCatchallEmailAccount(
  companyId: string,
  input: {
    inboxEmail: string;
    previousInboxEmail: string;
    provider: string;
    password?: string;
  },
): Promise<void> {
  const inbox = input.inboxEmail.trim().toLowerCase();
  const previous = input.previousInboxEmail.trim().toLowerCase();
  const password = input.password?.trim() || "";

  const [existing] = await db
    .select()
    .from(emailAccounts)
    .where(
      and(
        eq(emailAccounts.companyId, companyId),
        eq(emailAccounts.emailAddress, previous || inbox),
      ),
    )
    .limit(1);

  const [existingNew] =
    previous !== inbox
      ? await db
          .select()
          .from(emailAccounts)
          .where(and(eq(emailAccounts.companyId, companyId), eq(emailAccounts.emailAddress, inbox)))
          .limit(1)
      : [undefined];

  const target = existingNew ?? existing;

  if (!target && !password) {
    throw new HttpError(
      400,
      "CATCHALL_PASSWORD_REQUIRED",
      "Informe a senha do catch-all na primeira configuração",
    );
  }

  const vault = createCredentialVault(companyId);
  const now = new Date();

  if (target) {
    const updates: Partial<typeof emailAccounts.$inferInsert> = {
      emailAddress: inbox,
      provider: input.provider,
      updatedAt: now,
      deletedAt: null,
    };
    if (password) {
      const sealed = await vault.encrypt(password, { applicantId: target.applicantId });
      updates.encryptedPassword = sealed.ciphertext;
      updates.encryptionIv = sealed.iv;
      updates.encryptionAuthTag = sealed.authTag;
    }
    await db.update(emailAccounts).set(updates).where(eq(emailAccounts.id, target.id));
    await db
      .update(applicants)
      .set({ email: inbox, fullName: `Catchall IMAP ${inbox.split("@")[1] ?? "inbox"}`, updatedAt: now })
      .where(eq(applicants.id, target.applicantId));
    return;
  }

  const local = inbox.split("@")[0] || "catchall";
  const externalId = `${local}-catchall`.slice(0, 64);
  const [applicant] = await db
    .insert(applicants)
    .values({
      companyId,
      externalId,
      fullName: `Catchall IMAP ${inbox.split("@")[1] ?? "inbox"}`,
      email: inbox,
      status: "CANCELLED",
    })
    .returning({ id: applicants.id });

  if (!applicant) {
    throw new HttpError(500, "CATCHALL_APPLICANT_FAILED", "Falha ao criar applicant do catch-all");
  }

  const sealed = await vault.encrypt(password, { applicantId: applicant.id });
  await db.insert(emailAccounts).values({
    companyId,
    applicantId: applicant.id,
    emailAddress: inbox,
    encryptedPassword: sealed.ciphertext,
    encryptionIv: sealed.iv,
    encryptionAuthTag: sealed.authTag,
    provider: input.provider,
  });
}

export async function updateCompanySettings(
  companyId: string,
  input: UpdateCompanySettingsInput,
): Promise<{ previous: CompanySettingsView; current: CompanySettingsView }> {
  const previous = await getCompanySettings(companyId);
  const base = normalizePhoneBase(input.placeholderPhoneBase);
  const earnCity = input.earnCity.trim() || DEFAULT_EARN_CITY;
  const signupEmailDomain = normalizeDomain(input.signupEmailDomain, DEFAULT_SIGNUP_EMAIL_DOMAIN);
  const signupEmailProvider = normalizeProvider(
    input.signupEmailProvider,
    DEFAULT_SIGNUP_EMAIL_PROVIDER,
  );
  const catchallInboxEmail = normalizeEmail(
    input.catchallInboxEmail,
    DEFAULT_CATCHALL_INBOX_EMAIL,
  );
  const catchallDomains = normalizeDomainsCsv(input.catchallDomains, DEFAULT_CATCHALL_DOMAINS);
  const now = new Date();

  await upsertCatchallEmailAccount(companyId, {
    inboxEmail: catchallInboxEmail,
    previousInboxEmail: previous.catchallInboxEmail,
    provider: signupEmailProvider,
    password: input.catchallPassword?.trim() || undefined,
  });

  await db
    .insert(companySettings)
    .values({
      companyId,
      placeholderPhoneBase: base,
      earnCity,
      signupEmailDomain,
      signupEmailProvider,
      catchallInboxEmail,
      catchallDomains,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: companySettings.companyId,
      set: {
        placeholderPhoneBase: base,
        earnCity,
        signupEmailDomain,
        signupEmailProvider,
        catchallInboxEmail,
        catchallDomains,
        updatedAt: now,
      },
    });

  return { previous, current: await getCompanySettings(companyId) };
}
