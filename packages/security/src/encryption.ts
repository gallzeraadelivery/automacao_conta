import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
}

function resolveKey(keyHex?: string): Buffer {
  const hex = keyHex ?? process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be a ${KEY_LENGTH_BYTES}-byte key encoded as hex (${KEY_LENGTH_BYTES * 2} hex characters)`,
    );
  }
  return key;
}

/**
 * Encrypts sensitive credentials (email passwords, proxy credentials) using AES-256-GCM.
 * Never store plaintext secrets - always pass the result through this before persisting.
 */
export function encryptSecret(plaintext: string, keyHex?: string): EncryptedPayload {
  const key = resolveKey(keyHex);
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

export function decryptSecret(payload: EncryptedPayload, keyHex?: string): string {
  const key = resolveKey(keyHex);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
