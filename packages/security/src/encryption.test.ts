import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./encryption";

describe("encryptSecret / decryptSecret", () => {
  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  });

  it("round-trips a plaintext secret", () => {
    const plaintext = "super-secret-gmail-password";
    const payload = encryptSecret(plaintext);
    expect(payload.encrypted).not.toBe(plaintext);
    expect(decryptSecret(payload)).toBe(plaintext);
  });

  it("produces a different ciphertext and iv each time (no iv reuse)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("fails to decrypt when the auth tag is tampered with", () => {
    const payload = encryptSecret("tamper-test");
    const tampered = {
      ...payload,
      authTag: payload.authTag.replace(/.$/, (c) => (c === "0" ? "1" : "0")),
    };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws when the encryption key is missing", () => {
    expect(() => encryptSecret("x", undefined)).not.toThrow();
    const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });
});
