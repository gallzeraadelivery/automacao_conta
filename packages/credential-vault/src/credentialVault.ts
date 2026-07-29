import { encryptWithKey, decryptWithKey, AuditLogger } from "@uber-automation/security";
import type { CredentialContext, EncryptedCredential, ICredentialVault } from "./types";
import { createMasterKeyProvider, type MasterKeyProvider } from "./masterKeyProvider";

export interface CredentialVaultOptions {
  masterKeyProvider?: MasterKeyProvider;
  auditLogger?: AuditLogger;
  /** companyId usado nos eventos de auditoria emitidos por esta instancia. */
  companyId?: string;
}

const ALGORITHM = "AES-256-GCM" as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Unico ponto do sistema autorizado a cifrar/decifrar credenciais de
 * motoristas (senha de e-mail, credenciais de proxy). Nunca retorna a senha
 * para o frontend - apenas processos de backend (API para gravar, worker
 * para autenticar) devem instanciar isso.
 */
export class CredentialVault implements ICredentialVault {
  private readonly masterKeyProvider: MasterKeyProvider;
  private readonly auditLogger: AuditLogger;
  private readonly companyId?: string;

  constructor(options: CredentialVaultOptions = {}) {
    this.masterKeyProvider = options.masterKeyProvider ?? createMasterKeyProvider();
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.companyId = options.companyId;
  }

  async encrypt(
    plaintext: string,
    context: CredentialContext,
    credentialId?: string,
  ): Promise<EncryptedCredential> {
    const key = await this.masterKeyProvider.getMasterKey();
    let payload;
    try {
      payload = encryptWithKey(plaintext, key);
    } finally {
      // Melhor esforco: o V8 nao garante zeramento de memoria de strings,
      // mas evitamos manter qualquer referencia extra ao plaintext depois daqui.
      plaintext = "";
    }

    await this.auditAccessForContext(credentialId, context, "encrypt");

    return {
      ciphertext: payload.encrypted,
      iv: payload.iv,
      authTag: payload.authTag,
      algorithm: ALGORITHM,
    };
  }

  async decrypt(
    encrypted: EncryptedCredential,
    context: CredentialContext,
    credentialId?: string,
  ): Promise<string> {
    const key = await this.masterKeyProvider.getMasterKey();

    let plaintext: string;
    try {
      plaintext = decryptWithKey(
        { encrypted: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
        key,
      );
    } catch (error) {
      // Nunca inclua o ciphertext/iv/authTag na mensagem de erro.
      await this.auditAccessForContext(credentialId, context, "decrypt_failed");
      throw new Error("Falha ao decifrar credencial (chave incorreta ou dado corrompido)", {
        cause: error,
      });
    }

    await this.auditAccessForContext(credentialId, context, "decrypt");
    return plaintext;
  }

  /**
   * A cifra em si vive nas tabelas do banco (email_accounts, proxy_configs) -
   * o vault nao possui um datastore proprio. `delete` registra o evento de
   * auditoria; apagar/anular as colunas cifradas e responsabilidade de quem
   * possui a linha (a API, ao remover o motorista/proxy).
   */
  async delete(credentialId: string): Promise<void> {
    await this.auditLogger.log({
      companyId: this.companyId ?? "unknown",
      action: "credential_delete",
      metadata: { credentialId },
    });
  }

  async auditAccess(credentialId: string, action: string): Promise<void> {
    await this.auditLogger.log({
      companyId: this.companyId ?? "unknown",
      action: `credential_${action}`,
      metadata: { credentialId },
    });
  }

  private async auditAccessForContext(
    credentialId: string | undefined,
    context: CredentialContext,
    action: string,
  ): Promise<void> {
    // `audit_logs.applicant_id` e uma FK real para `applicants.id` (UUID).
    // Nem todo credencial e associado a um motorista (ex: proxies sao da
    // empresa, e chamadores usam um identificador sentinela como
    // "system:proxy" no contexto) - so preenchemos o campo estruturado
    // quando o valor realmente parece um UUID; caso contrario ele ainda fica
    // registrado em metadata (JSONB, sem constraint) para fins de auditoria.
    await this.auditLogger.log({
      companyId: this.companyId ?? "unknown",
      applicantId: isUuid(context.applicantId) ? context.applicantId : undefined,
      action: `credential_${action}`,
      metadata: {
        credentialId: credentialId ?? context.applicantId,
        applicantId: context.applicantId,
      },
    });
  }
}
