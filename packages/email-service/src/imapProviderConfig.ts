import type { ImapEmailClientOptions } from "./imapEmailClient";

/**
 * Host/porta IMAP por provedor de conta (`email_accounts.provider`).
 * Spacemail: mail.spacemail.com:993 SSL (IMAP precisa estar habilitado
 * nas configurações da caixa no Spacemail Manager).
 */
export const IMAP_PROVIDER_CONFIG = {
  gmail: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  yahoo: { host: "imap.mail.yahoo.com", port: 993 },
  spacemail: { host: "mail.spacemail.com", port: 993 },
} as const;

export type KnownImapProvider = keyof typeof IMAP_PROVIDER_CONFIG;

const ALIASES: Record<string, KnownImapProvider> = {
  gmail: "gmail",
  google: "gmail",
  "google workspace": "gmail",
  outlook: "outlook",
  "microsoft 365": "outlook",
  office365: "outlook",
  hotmail: "outlook",
  yahoo: "yahoo",
  spacemail: "spacemail",
  space: "spacemail",
};

export function normalizeImapProvider(provider: string): KnownImapProvider | null {
  const key = provider.trim().toLowerCase();
  if (!key) return null;
  if (key in IMAP_PROVIDER_CONFIG) {
    return key as KnownImapProvider;
  }
  return ALIASES[key] ?? null;
}

/**
 * Resolve host/porta IMAP a partir do `provider` da conta.
 * Provedor desconhecido falha de propósito (não cai em Gmail por engano).
 */
export function resolveImapOptions(provider: string): ImapEmailClientOptions {
  const known = normalizeImapProvider(provider);
  if (!known) {
    const supported = Object.keys(IMAP_PROVIDER_CONFIG).join(", ");
    throw new Error(
      `Provedor de e-mail IMAP desconhecido: "${provider}". Use um de: ${supported}`,
    );
  }
  return { ...IMAP_PROVIDER_CONFIG[known] };
}
