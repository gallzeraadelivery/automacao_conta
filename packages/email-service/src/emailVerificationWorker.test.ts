import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { AuditLogger } from "@uber-automation/security";
import { CredentialVault } from "@uber-automation/credential-vault";
import { EmailVerificationWorker } from "./emailVerificationWorker";
import { SecurityChallengeError, VerificationCodeNotFoundError } from "./types";
import type { EmailAccountRepository } from "./emailAccountRepository";
import type { GmailMessage, GmailSessionData, IGmailClient, SecurityChallengeType } from "./types";

const FIXED_KEY = randomBytes(32);

function buildVault(auditLogger: AuditLogger) {
  return new CredentialVault({
    masterKeyProvider: { getMasterKey: async () => FIXED_KEY },
    auditLogger,
  });
}

async function encryptedPasswordFor(
  vault: CredentialVault,
  plaintext: string,
  applicantId: string,
) {
  return vault.encrypt(plaintext, { applicantId });
}

class FakeEmailAccountRepository implements EmailAccountRepository {
  requiresHumanAction: { emailAccountId: string; reason: string } | null = null;
  loginResults: Array<{ emailAccountId: string; status: string }> = [];

  constructor(
    private readonly record: {
      id: string;
      emailAddress: string;
      encryptedPassword: string;
      encryptionIv: string;
      encryptionAuthTag: string;
    },
  ) {}

  async getById(emailAccountId: string) {
    if (emailAccountId !== this.record.id) return null;
    return { ...this.record, provider: "gmail" };
  }

  async markRequiresHumanAction(emailAccountId: string, reason: string) {
    this.requiresHumanAction = { emailAccountId, reason };
  }

  async recordLoginResult(emailAccountId: string, status: string) {
    this.loginResults.push({ emailAccountId, status });
  }
}

class MockGmailClient implements IGmailClient {
  loginCalls: Array<{ email: string; password: string }> = [];
  closed = false;
  challenge: SecurityChallengeType | null = null;
  messages: GmailMessage[] = [];

  async login(email: string, password: string) {
    this.loginCalls.push({ email, password });
  }

  async detectSecurityChallenge() {
    return this.challenge;
  }

  async searchMessages() {
    return this.messages;
  }

  async saveSession(): Promise<GmailSessionData> {
    return { cookies: [], localStorage: {} };
  }

  async close() {
    this.closed = true;
  }
}

const REQUESTED_AT = new Date("2026-01-01T12:00:00Z");

function baseMessage(): GmailMessage {
  return {
    id: "msg-1",
    from: "noreply@uber.com",
    subject: "Seu código de confirmação Uber",
    snippet: "Seu código de verificação é 482913.",
    receivedAt: new Date("2026-01-01T12:01:00Z"),
  };
}

describe("EmailVerificationWorker", () => {
  it("returns the verification code when login succeeds and a matching message exists", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = buildVault(auditLogger);
    const encrypted = await encryptedPasswordFor(vault, "gmail-password-123", "app-1");

    const repo = new FakeEmailAccountRepository({
      id: "email-1",
      emailAddress: "driver@gmail.com",
      encryptedPassword: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionAuthTag: encrypted.authTag,
    });

    const client = new MockGmailClient();
    client.messages = [baseMessage()];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      companyId: "company-1",
    });

    const result = await worker.findVerificationCode({
      applicantId: "app-1",
      emailAccountId: "email-1",
      proxyId: "proxy-1",
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });

    expect(result.code).toBe("482913");
    expect(result.confidence).toBe("HIGH");
    expect(client.closed).toBe(true);
    expect(repo.loginResults).toEqual([{ emailAccountId: "email-1", status: "VALID" }]);
  });

  it("pauses immediately on a 2FA challenge without searching messages or leaking the password", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = buildVault(auditLogger);
    const encrypted = await encryptedPasswordFor(vault, "super-secret-pass", "app-1");

    const repo = new FakeEmailAccountRepository({
      id: "email-1",
      emailAddress: "driver@gmail.com",
      encryptedPassword: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionAuthTag: encrypted.authTag,
    });

    const client = new MockGmailClient();
    client.challenge = "TWO_FACTOR";
    const searchSpy = vi.spyOn(client, "searchMessages");

    const lockCalls: Array<{ applicantId: string; reason: string }> = [];
    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      browserProfileHooks: {
        loadGmailSession: async () => undefined,
        saveGmailSession: async () => undefined,
        lockOnSecurityChallenge: async (applicantId, reason) => {
          lockCalls.push({ applicantId, reason });
        },
      },
    });

    await expect(
      worker.findVerificationCode({
        applicantId: "app-1",
        emailAccountId: "email-1",
        proxyId: "proxy-1",
        requestedAt: REQUESTED_AT,
      }),
    ).rejects.toThrow(SecurityChallengeError);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(client.closed).toBe(true);
    expect(repo.requiresHumanAction).toEqual({ emailAccountId: "email-1", reason: "REQUIRES_2FA" });
    expect(lockCalls).toEqual([{ applicantId: "app-1", reason: "TWO_FACTOR" }]);

    const fullLog = JSON.stringify(sink.mock.calls);
    expect(fullLog).not.toContain("super-secret-pass");
  });

  it.each(["TWO_FACTOR", "CAPTCHA", "PHONE_VERIFICATION"] as const)(
    "handleSecurityChallenge returns a PAUSED status for %s without attempting to solve it",
    async (challenge) => {
      const worker = new EmailVerificationWorker({
        auditLogger: new AuditLogger({ sink: () => {} }),
      });
      const result = await worker.handleSecurityChallenge(challenge);
      expect(result.status).toBe("PAUSED");
      expect(result.reason.length).toBeGreaterThan(0);
    },
  );

  it("throws VerificationCodeNotFoundError when no eligible message is found", async () => {
    const auditLogger = new AuditLogger({ sink: () => {} });
    const vault = buildVault(auditLogger);
    const encrypted = await encryptedPasswordFor(vault, "pass", "app-1");

    const repo = new FakeEmailAccountRepository({
      id: "email-1",
      emailAddress: "driver@gmail.com",
      encryptedPassword: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionAuthTag: encrypted.authTag,
    });

    const client = new MockGmailClient();
    client.messages = [];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
    });

    await expect(
      worker.findVerificationCode({
        applicantId: "app-1",
        emailAccountId: "email-1",
        proxyId: "proxy-1",
        requestedAt: REQUESTED_AT,
      }),
    ).rejects.toThrow(VerificationCodeNotFoundError);
    expect(client.closed).toBe(true);
  });

  it("never writes the full verification code or password to the audit log", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = buildVault(auditLogger);
    const encrypted = await encryptedPasswordFor(vault, "top-secret-password", "app-1");

    const repo = new FakeEmailAccountRepository({
      id: "email-1",
      emailAddress: "driver@gmail.com",
      encryptedPassword: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionAuthTag: encrypted.authTag,
    });

    const client = new MockGmailClient();
    client.messages = [baseMessage()];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
    });

    const result = await worker.findVerificationCode({
      applicantId: "app-1",
      emailAccountId: "email-1",
      proxyId: "proxy-1",
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });

    const fullLog = JSON.stringify(sink.mock.calls);
    expect(fullLog).not.toContain("top-secret-password");
    expect(fullLog).not.toContain(result.code);
    expect(fullLog).toContain(`****${result.code.slice(-2)}`);
  });
});
