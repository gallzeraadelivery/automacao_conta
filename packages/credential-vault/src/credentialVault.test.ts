import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { AuditLogger } from "@uber-automation/security";
import { CredentialVault } from "./credentialVault";
import type { MasterKeyProvider } from "./masterKeyProvider";

function fakeKeyProvider(key = randomBytes(32)): MasterKeyProvider {
  return { getMasterKey: async () => key };
}

describe("CredentialVault", () => {
  it("round-trips a plaintext credential", async () => {
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider() });
    const encrypted = await vault.encrypt("s3cr3t-gmail-password", { applicantId: "app-1" });

    expect(encrypted.algorithm).toBe("AES-256-GCM");
    expect(encrypted.ciphertext).not.toContain("s3cr3t-gmail-password");

    const decrypted = await vault.decrypt(encrypted, { applicantId: "app-1" });
    expect(decrypted).toBe("s3cr3t-gmail-password");
  });

  it("never leaks the plaintext in a thrown error when decryption fails", async () => {
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider() });
    const encrypted = await vault.encrypt("super-secret-value", { applicantId: "app-1" });

    const tamperedVault = new CredentialVault({ masterKeyProvider: fakeKeyProvider() });

    try {
      await tamperedVault.decrypt(encrypted, { applicantId: "app-1" });
      expect.unreachable("decrypt should have thrown with a different key");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("super-secret-value");
      expect(message).not.toContain(encrypted.ciphertext);
      expect(message).not.toContain(encrypted.iv);
      expect(message).not.toContain(encrypted.authTag);
    }
  });

  it("never leaks the plaintext in audit log metadata for encrypt/decrypt", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = new CredentialVault({
      masterKeyProvider: fakeKeyProvider(),
      auditLogger,
      companyId: "company-1",
    });

    const encrypted = await vault.encrypt("hunter2-secret", { applicantId: "app-1" }, "cred-1");
    await vault.decrypt(encrypted, { applicantId: "app-1" }, "cred-1");

    expect(sink).toHaveBeenCalledTimes(2);
    for (const call of sink.mock.calls) {
      const entry = call[0];
      expect(JSON.stringify(entry)).not.toContain("hunter2-secret");
      expect(entry.metadata.credentialId).toBe("cred-1");
    }
    expect(sink.mock.calls[0]![0].action).toBe("credential_encrypt");
    expect(sink.mock.calls[1]![0].action).toBe("credential_decrypt");
  });

  it("audits decrypt failures without leaking the ciphertext", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider(), auditLogger });
    const otherVault = new CredentialVault({ masterKeyProvider: fakeKeyProvider(), auditLogger });

    const encrypted = await vault.encrypt("value", { applicantId: "app-1" });
    sink.mockClear();

    await expect(otherVault.decrypt(encrypted, { applicantId: "app-1" })).rejects.toThrow(
      /Falha ao decifrar/,
    );

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0].action).toBe("credential_decrypt_failed");
  });

  it("delete() and auditAccess() write audit events without a datastore of their own", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = new CredentialVault({
      masterKeyProvider: fakeKeyProvider(),
      auditLogger,
      companyId: "company-1",
    });

    await vault.delete("cred-1");
    await vault.auditAccess("cred-1", "manual_review");

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0]![0].action).toBe("credential_delete");
    expect(sink.mock.calls[1]![0].action).toBe("credential_manual_review");
  });

  it("omits applicantId from the structured audit entry when it is not a real UUID (e.g. a sentinel like 'system:proxy')", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider(), auditLogger });

    await vault.encrypt("proxy-secret-blob", { applicantId: "system:proxy" }, "proxy-1");

    expect(sink).toHaveBeenCalledTimes(1);
    const entry = sink.mock.calls[0]![0];
    // Este campo mapeia para uma FK real (audit_logs.applicant_id, UUID) -
    // um sentinela nao-UUID aqui quebraria o insert no banco.
    expect(entry.applicantId).toBeUndefined();
    // A informacao nao se perde: continua disponivel em metadata (JSONB).
    expect(entry.metadata.applicantId).toBe("system:proxy");
  });

  it("keeps applicantId in the structured audit entry when it is a real UUID", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider(), auditLogger });
    const realApplicantId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    await vault.encrypt("email-password", { applicantId: realApplicantId }, "email-1");

    const entry = sink.mock.calls[0]![0];
    expect(entry.applicantId).toBe(realApplicantId);
  });

  it("produces a different ciphertext/iv each time even for the same plaintext (no IV reuse)", async () => {
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider() });
    const a = await vault.encrypt("same-value", { applicantId: "app-1" });
    const b = await vault.encrypt("same-value", { applicantId: "app-1" });

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
