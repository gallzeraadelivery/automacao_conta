import path from "node:path";
import { CredentialVault } from "@uber-automation/credential-vault";
import { AuditLogger } from "@uber-automation/security";
import type {
  BrowserProfile,
  BrowserProfileRecord,
  BrowserProfileRepository,
  ProfileValidationResult,
} from "./browserProfile.types";
import { DrizzleBrowserProfileRepository } from "./browserProfileRepository.drizzle";
import {
  checkProfileIntegrity,
  initializeProfileFiles,
  isProfileLocked,
  lockProfileDir,
  readProfileData,
  resolveProfileDir,
  unlockProfileDir,
  wipeProfileDir,
} from "./profileStorage";

export interface BrowserProfileManagerOptions {
  storageRoot?: string;
  repository?: BrowserProfileRepository;
  vault?: CredentialVault;
  auditLogger?: AuditLogger;
  companyId?: string;
  /** Perfis nao usados ha mais que isso sao considerados obsoletos. Padrao: 30 dias. */
  maxAgeDays?: number;
}

interface StoragePathBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
}

const DEFAULT_MAX_AGE_DAYS = 30;

/**
 * Garante isolamento estrito de sessao por motorista: um diretorio proprio
 * (cookies/localStorage/sessionStorage separados para uber/ e gmail/) e uma
 * linha propria em `browser_profiles`. Nunca reutiliza sessao entre
 * motoristas - `createProfile` sempre opera sobre o diretorio do
 * `applicantId` informado, e `validateProfile` recusa reuso quando o
 * e-mail/proxy associado nao bate, a sessao esta obsoleta, corrompida ou
 * bloqueada por seguranca.
 */
export class BrowserProfileManager {
  private readonly storageRoot: string;
  private readonly repository: BrowserProfileRepository;
  private readonly vault: CredentialVault;
  private readonly auditLogger: AuditLogger;
  private readonly companyId?: string;
  private readonly maxAgeDays: number;

  constructor(options: BrowserProfileManagerOptions = {}) {
    this.storageRoot =
      options.storageRoot ??
      process.env.BROWSER_PROFILES_STORAGE_PATH ??
      path.resolve(process.cwd(), "storage", "browser-profiles");
    this.repository = options.repository ?? new DrizzleBrowserProfileRepository();
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.vault =
      options.vault ??
      new CredentialVault({ auditLogger: this.auditLogger, companyId: options.companyId });
    this.companyId = options.companyId;
    this.maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  }

  async createProfile(
    applicantId: string,
    emailAccountId: string,
    proxyId: string,
  ): Promise<BrowserProfile> {
    const profileDir = resolveProfileDir(this.storageRoot, applicantId);
    const existing = await this.repository.findActiveByApplicantId(applicantId);

    if (existing) {
      const matches = existing.emailAccountId === emailAccountId && existing.proxyId === proxyId;
      if (matches) {
        await this.audit(applicantId, existing.id, "browser_profile_reused", {});
        return this.toBrowserProfile(existing, profileDir);
      }

      // E-mail ou proxy mudou para o mesmo motorista: a sessao anterior nao
      // pode ser reaproveitada com credenciais diferentes. Arquiva e reseta.
      await this.repository.archive(existing.id);
      await this.audit(applicantId, existing.id, "browser_profile_superseded", {
        previousEmailAccountId: existing.emailAccountId,
        previousProxyId: existing.proxyId,
      });
    }

    await initializeProfileFiles(profileDir);
    await unlockProfileDir(profileDir);

    const encryptedStoragePath = await this.encryptStoragePath(profileDir, applicantId);

    const record = await this.repository.insert({
      applicantId,
      emailAccountId,
      proxyId,
      encryptedStoragePath,
      status: "CREATED",
    });

    await this.audit(applicantId, record.id, "browser_profile_created", {
      emailAccountId,
      proxyId,
    });

    return this.toBrowserProfile(record, profileDir);
  }

  async loadProfile(profileId: string): Promise<BrowserProfile> {
    const record = await this.repository.findById(profileId);
    if (!record) {
      throw new Error(`Perfil de navegador não encontrado: ${profileId}`);
    }

    const profileDir = await this.decryptStoragePath(record);
    await this.repository.touchLastUsed(profileId);
    await this.audit(record.applicantId, record.id, "browser_profile_loaded", {});

    return this.toBrowserProfile(record, profileDir);
  }

  async validateProfile(profileId: string): Promise<boolean> {
    const result = await this.validateProfileDetailed(profileId);
    return result.valid;
  }

  async validateProfileDetailed(profileId: string): Promise<ProfileValidationResult> {
    const reasons: string[] = [];
    const record = await this.repository.findById(profileId);

    if (!record) {
      return { valid: false, reasons: ["profile_not_found"] };
    }

    if (record.status === "ARCHIVED") {
      reasons.push("profile_archived");
    }

    if (record.emailAccountId) {
      const emailStatus = await this.repository.getEmailAccountStatus(record.emailAccountId);
      if (!emailStatus || !emailStatus.exists) {
        reasons.push("email_account_not_found");
      } else if (emailStatus.deletedAt) {
        reasons.push("email_account_deleted");
      } else if (emailStatus.requiresHumanAction) {
        reasons.push("email_account_requires_human_action");
      }
    } else {
      reasons.push("email_account_missing");
    }

    if (record.proxyId) {
      const proxyStatus = await this.repository.getProxyStatus(record.proxyId);
      if (!proxyStatus || !proxyStatus.exists) {
        reasons.push("proxy_not_found");
      } else if (proxyStatus.status === "ERROR") {
        reasons.push("proxy_unhealthy");
      }
    } else {
      reasons.push("proxy_missing");
    }

    const profileDir = resolveProfileDir(this.storageRoot, record.applicantId);

    const integrity = await checkProfileIntegrity(profileDir);
    if (!integrity.intact) {
      reasons.push("session_integrity_failed");
    }

    const referenceDate = record.lastUsedAt ?? record.createdAt;
    const ageDays = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > this.maxAgeDays) {
      reasons.push("session_stale");
    }

    if (await isProfileLocked(profileDir)) {
      reasons.push("security_lock_active");
    }

    const valid = reasons.length === 0;
    await this.audit(record.applicantId, record.id, "browser_profile_validated", {
      valid,
      reasons,
    });

    return { valid, reasons };
  }

  /** Resolve o perfil ativo (nao arquivado) de um motorista, se houver. */
  async getActiveProfileId(applicantId: string): Promise<string | null> {
    const record = await this.repository.findActiveByApplicantId(applicantId);
    return record?.id ?? null;
  }

  async clearProfile(profileId: string): Promise<void> {
    const record = await this.repository.findById(profileId);
    if (!record) {
      throw new Error(`Perfil de navegador não encontrado: ${profileId}`);
    }

    const profileDir = resolveProfileDir(this.storageRoot, record.applicantId);
    await wipeProfileDir(profileDir);
    await this.repository.archive(profileId);
    await this.audit(record.applicantId, record.id, "browser_profile_cleared", {});
  }

  /**
   * Aplica um bloqueio de seguranca no perfil (ex: o EmailVerificationWorker
   * detectou 2FA/CAPTCHA no Gmail). Um perfil bloqueado falha em
   * `validateProfile` ate ser desbloqueado manualmente ou limpo.
   */
  async lockProfile(profileId: string, reason: string): Promise<void> {
    const record = await this.repository.findById(profileId);
    if (!record) {
      throw new Error(`Perfil de navegador não encontrado: ${profileId}`);
    }
    const profileDir = resolveProfileDir(this.storageRoot, record.applicantId);
    await lockProfileDir(profileDir, reason);
    await this.audit(record.applicantId, record.id, "browser_profile_locked", { reason });
  }

  private async encryptStoragePath(profileDir: string, applicantId: string): Promise<string> {
    const encrypted = await this.vault.encrypt(profileDir, { applicantId });
    const blob: StoragePathBlob = {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      algorithm: encrypted.algorithm,
    };
    return JSON.stringify(blob);
  }

  private async decryptStoragePath(record: BrowserProfileRecord): Promise<string> {
    const blob = JSON.parse(record.encryptedStoragePath) as StoragePathBlob;
    return this.vault.decrypt(blob, { applicantId: record.applicantId }, record.id);
  }

  private async toBrowserProfile(
    record: BrowserProfileRecord,
    profileDir: string,
  ): Promise<BrowserProfile> {
    const data = await readProfileData(profileDir);
    return {
      id: record.id,
      applicantId: record.applicantId,
      emailAccountId: record.emailAccountId,
      proxyId: record.proxyId,
      status: record.status,
      lastUsedAt: record.lastUsedAt,
      createdAt: record.createdAt,
      storagePath: profileDir,
      data,
    };
  }

  private async audit(
    applicantId: string,
    profileId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogger.log({
      companyId: this.companyId ?? "unknown",
      applicantId,
      action,
      metadata: { profileId, ...metadata },
    });
  }
}
