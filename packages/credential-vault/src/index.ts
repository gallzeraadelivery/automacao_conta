import { encryptSecret, decryptSecret, type EncryptedPayload } from "@uber-automation/security";

/**
 * Camada fina sobre @uber-automation/security dedicada a credenciais de
 * motoristas (senhas de e-mail, credenciais de proxy). Centraliza o ponto de
 * criptografia/descriptografia para que nenhuma rota da API manipule
 * AES-256-GCM diretamente.
 */

export interface VaultedSecret {
  encrypted: string;
  iv: string;
  authTag: string;
}

export function sealSecret(plaintext: string): VaultedSecret {
  return encryptSecret(plaintext);
}

export function unsealSecret(payload: EncryptedPayload): string {
  return decryptSecret(payload);
}

export type { EncryptedPayload } from "@uber-automation/security";
