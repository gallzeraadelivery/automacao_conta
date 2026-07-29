export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
}

export interface CredentialContext {
  applicantId: string;
}

/**
 * credentialId e opcional em encrypt/decrypt (nem sempre existe um ID de
 * credencial antes de ela ser criada), mas quando informado e usado para
 * correlacionar o evento de auditoria. Quando ausente, o applicantId do
 * contexto e usado como chave de correlacao.
 */
export interface ICredentialVault {
  encrypt(
    plaintext: string,
    context: CredentialContext,
    credentialId?: string,
  ): Promise<EncryptedCredential>;
  decrypt(
    encrypted: EncryptedCredential,
    context: CredentialContext,
    credentialId?: string,
  ): Promise<string>;
  delete(credentialId: string): Promise<void>;
  auditAccess(credentialId: string, action: string): Promise<void>;
}
