export const PROFILE_SITES = ["uber", "gmail"] as const;
export type ProfileSite = (typeof PROFILE_SITES)[number];

export const PROFILE_FILES = ["cookies.json", "localStorage.json", "sessionStorage.json"] as const;
export type ProfileFile = (typeof PROFILE_FILES)[number];

export interface BrowserProfileRecord {
  id: string;
  applicantId: string;
  emailAccountId: string | null;
  proxyId: string | null;
  /** Blob opaco (ciphertext+iv+authTag serializados) - nunca o path em texto puro. */
  encryptedStoragePath: string;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewBrowserProfileRecord = Omit<
  BrowserProfileRecord,
  "id" | "createdAt" | "updatedAt" | "lastUsedAt"
>;

export interface EmailAccountLookup {
  exists: boolean;
  deletedAt: Date | null;
  requiresHumanAction: boolean;
}

export interface ProxyLookup {
  exists: boolean;
  status: string;
}

/**
 * Abstrai o acesso ao banco para que a logica de negocio do
 * BrowserProfileManager (isolamento, validacao, bloqueio) seja testavel sem
 * um Postgres real. A implementacao padrao usa @uber-automation/database.
 */
export interface BrowserProfileRepository {
  findById(id: string): Promise<BrowserProfileRecord | null>;
  findActiveByApplicantId(applicantId: string): Promise<BrowserProfileRecord | null>;
  insert(row: NewBrowserProfileRecord): Promise<BrowserProfileRecord>;
  archive(id: string): Promise<void>;
  touchLastUsed(id: string): Promise<void>;
  getEmailAccountStatus(emailAccountId: string): Promise<EmailAccountLookup | null>;
  getProxyStatus(proxyId: string): Promise<ProxyLookup | null>;
}

export interface ProfileSiteData {
  cookies: unknown[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface BrowserProfile {
  id: string;
  applicantId: string;
  emailAccountId: string | null;
  proxyId: string | null;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** Absoluto, apenas em memoria - nunca persistido em texto puro nem exposto a UI. */
  storagePath: string;
  data: Record<ProfileSite, ProfileSiteData>;
}

export interface ProfileValidationResult {
  valid: boolean;
  reasons: string[];
}
