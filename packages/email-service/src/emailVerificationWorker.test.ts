import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { AuditLogger } from "@uber-automation/security";
import { CredentialVault } from "@uber-automation/credential-vault";
import { EmailVerificationWorker } from "./emailVerificationWorker";
import { SecurityChallengeError, VerificationCodeNotFoundError } from "./types";
import type { EmailAccountRepository, EmailAccountCredentialRecord } from "./emailAccountRepository";
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

function accountRecord(
  overrides: Partial<EmailAccountCredentialRecord> &
    Pick<
      EmailAccountCredentialRecord,
      "id" | "emailAddress" | "encryptedPassword" | "encryptionIv" | "encryptionAuthTag"
    >,
): EmailAccountCredentialRecord {
  return {
    companyId: "company-1",
    applicantId: "app-1",
    provider: "gmail",
    ...overrides,
  };
}

class FakeEmailAccountRepository implements EmailAccountRepository {
  requiresHumanAction: { emailAccountId: string; reason: string } | null = null;
  loginResults: Array<{ emailAccountId: string; status: string }> = [];
  private readonly byId = new Map<string, EmailAccountCredentialRecord>();

  constructor(records: EmailAccountCredentialRecord | EmailAccountCredentialRecord[]) {
    for (const record of Array.isArray(records) ? records : [records]) {
      this.byId.set(record.id, record);
    }
  }

  async getById(emailAccountId: string) {
    return this.byId.get(emailAccountId) ?? null;
  }

  async getByCompanyAndEmail(companyId: string, emailAddress: string) {
    const needle = emailAddress.trim().toLowerCase();
    for (const record of this.byId.values()) {
      if (record.companyId === companyId && record.emailAddress.toLowerCase() === needle) {
        return record;
      }
    }
    return null;
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

    const repo = new FakeEmailAccountRepository(
      accountRecord({
        id: "email-1",
        emailAddress: "driver@gmail.com",
        encryptedPassword: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
      }),
    );

    const client = new MockGmailClient();
    client.messages = [baseMessage()];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      companyId: "company-1",
      pollTimeoutMs: 0,
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

    const repo = new FakeEmailAccountRepository(
      accountRecord({
        id: "email-1",
        emailAddress: "driver@gmail.com",
        encryptedPassword: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
      }),
    );

    const client = new MockGmailClient();
    client.challenge = "TWO_FACTOR";
    const searchSpy = vi.spyOn(client, "searchMessages");

    const lockCalls: Array<{ applicantId: string; reason: string }> = [];
    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      pollTimeoutMs: 0,
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
        pollTimeoutMs: 0,
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

    const repo = new FakeEmailAccountRepository(
      accountRecord({
        id: "email-1",
        emailAddress: "driver@gmail.com",
        encryptedPassword: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
      }),
    );

    const client = new MockGmailClient();
    client.messages = [];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      pollTimeoutMs: 0,
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

  it("polls IMAP until the verification email arrives", async () => {
    const auditLogger = new AuditLogger({ sink: () => {} });
    const vault = buildVault(auditLogger);
    const encrypted = await encryptedPasswordFor(vault, "pass", "app-1");

    const repo = new FakeEmailAccountRepository(
      accountRecord({
        id: "email-1",
        emailAddress: "driver@gmail.com",
        encryptedPassword: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
      }),
    );

    const client = new MockGmailClient();
    let searches = 0;
    client.searchMessages = async () => {
      searches += 1;
      if (searches < 3) return [];
      return [baseMessage()];
    };

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      pollTimeoutMs: 5_000,
      pollIntervalMs: 10,
    });

    const result = await worker.findVerificationCode({
      applicantId: "app-1",
      emailAccountId: "email-1",
      proxyId: "proxy-1",
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });

    expect(result.code).toBe("482913");
    expect(searches).toBeGreaterThanOrEqual(3);
    expect(client.closed).toBe(true);
  });

  it("never writes the full verification code or password to the audit log", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = buildVault(auditLogger);
    const encrypted = await encryptedPasswordFor(vault, "top-secret-password", "app-1");

    const repo = new FakeEmailAccountRepository(
      accountRecord({
        id: "email-1",
        emailAddress: "driver@gmail.com",
        encryptedPassword: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
      }),
    );

    const client = new MockGmailClient();
    client.messages = [baseMessage()];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      pollTimeoutMs: 0,
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

  it("logs into catch-all inbox for @mail2too.com aliases", async () => {
    const sink = vi.fn();
    const auditLogger = new AuditLogger({ sink });
    const vault = buildVault(auditLogger);
    const inboxEncrypted = await encryptedPasswordFor(vault, "catchall-pass", "app-inbox");
    const aliasEncrypted = await encryptedPasswordFor(vault, "wrong-pass", "app-alias");

    const repo = new FakeEmailAccountRepository([
      accountRecord({
        id: "email-inbox",
        applicantId: "app-inbox",
        emailAddress: "galldelivery@mail2too.com",
        encryptedPassword: inboxEncrypted.ciphertext,
        encryptionIv: inboxEncrypted.iv,
        encryptionAuthTag: inboxEncrypted.authTag,
        provider: "spacemail",
      }),
      accountRecord({
        id: "email-alias",
        applicantId: "app-alias",
        emailAddress: "gallsuper10@mail2too.com",
        encryptedPassword: aliasEncrypted.ciphertext,
        encryptionIv: aliasEncrypted.iv,
        encryptionAuthTag: aliasEncrypted.authTag,
        provider: "spacemail",
      }),
    ]);

    const client = new MockGmailClient();
    client.messages = [
      {
        ...baseMessage(),
        bodyText: "Enter the 4-digit code sent to you at: gallsuper10@mail2too.com — 482913",
      },
    ];

    const worker = new EmailVerificationWorker({
      gmailClientFactory: () => client,
      emailAccountRepository: repo,
      vault,
      auditLogger,
      companyId: "company-1",
      pollTimeoutMs: 0,
    });

    const result = await worker.findVerificationCode({
      applicantId: "app-alias",
      emailAccountId: "email-alias",
      proxyId: "proxy-1",
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });

    expect(result.code).toBe("482913");
    expect(client.loginCalls).toEqual([
      { email: "galldelivery@mail2too.com", password: "catchall-pass" },
    ]);
    expect(repo.loginResults).toEqual([{ emailAccountId: "email-inbox", status: "VALID" }]);
  });
});
