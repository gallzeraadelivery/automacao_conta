import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
}

export function assertValidKey(key: Buffer, sourceDescription: string): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `${sourceDescription} must be a ${KEY_LENGTH_BYTES}-byte key (${KEY_LENGTH_BYTES * 2} hex characters)`,
    );
  }
}

/**
 * Encrypts with an already-resolved 32-byte key buffer. Used by callers
 * (e.g. the credential vault) that fetch the key from AWS Secrets Manager or
 * a local key file rather than an environment variable.
 */
export function encryptWithKey(plaintext: string, key: Buffer): EncryptedPayload {
  assertValidKey(key, "Encryption key");
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptWithKey(payload: EncryptedPayload, key: Buffer): string {
  assertValidKey(key, "Encryption key");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function resolveKeyFromEnv(keyHex?: string): Buffer {
  const hex = keyHex ?? process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts sensitive credentials (email passwords, proxy credentials) using AES-256-GCM.
 * Never store plaintext secrets - always pass the result through this before persisting.
 *
 * @deprecated Prefer @uber-automation/credential-vault's CredentialVault, which
 * resolves the master key via AWS Secrets Manager or a local key file instead
 * of reading it directly from an environment variable. Kept for callers that
 * still rely on CREDENTIAL_ENCRYPTION_KEY directly.
 */
export function encryptSecret(plaintext: string, keyHex?: string): EncryptedPayload {
  return encryptWithKey(plaintext, resolveKeyFromEnv(keyHex));
}

/** @deprecated see encryptSecret */
export function decryptSecret(payload: EncryptedPayload, keyHex?: string): string {
  return decryptWithKey(payload, resolveKeyFromEnv(keyHex));
}
