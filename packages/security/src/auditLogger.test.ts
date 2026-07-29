import { describe, it, expect, vi } from "vitest";
import { AuditLogger, maskSensitiveData } from "./auditLogger";

describe("maskSensitiveData", () => {
  it("redacts fields whose name indicates a secret", () => {
    const result = maskSensitiveData({
      password: "hunter2",
      encryptedPassword: "abcd1234",
      encryptionIv: "deadbeef",
      encryptionAuthTag: "cafebabe",
      refreshToken: "eyJhbGciOi...",
      cookies: [{ name: "session", value: "s3cr3t" }],
      verificationCode: "482913",
    });

    expect(result.password).toBe("[REDACTED]");
    expect(result.encryptedPassword).toBe("[REDACTED]");
    expect(result.encryptionIv).toBe("[REDACTED]");
    expect(result.encryptionAuthTag).toBe("[REDACTED]");
    expect(result.refreshToken).toBe("[REDACTED]");
    expect(result.cookies).toBe("[REDACTED]");
    expect(result.verificationCode).toBe("[REDACTED]");
  });

  it("does not redact unrelated fields that merely share substrings with sensitive words", () => {
    const result = maskSensitiveData({
      driverLicenseProvider: "SOCURE",
      profilePhotoProvider: "NOT_SOCURE",
      assignedOperatorId: "op-1",
      postalCode: "01000-000",
    });

    expect(result.driverLicenseProvider).toBe("SOCURE");
    expect(result.profilePhotoProvider).toBe("NOT_SOCURE");
    expect(result.assignedOperatorId).toBe("op-1");
  });

  it("passes through fields already pre-masked by the caller (maskedXxx convention)", () => {
    const result = maskSensitiveData({
      maskedCode: "****13",
      maskedPhone: "****8888",
      code: "482913",
    });

    expect(result.maskedCode).toBe("****13");
    expect(result.maskedPhone).toBe("****8888");
    expect(result.code).toBe("[REDACTED]");
  });

  it("masks email and phone fields by field-name heuristic", () => {
    const result = maskSensitiveData({
      email: "joao.silva@gmail.com",
      phone: "11999998888",
    });

    expect(result.email).toBe("j***@gmail.com");
    expect(result.phone).toBe("****8888");
  });

  it("recurses into nested objects and arrays", () => {
    const result = maskSensitiveData({
      applicant: { email: "a@b.com", credentials: { password: "x" } },
      items: [{ token: "abc" }, { name: "ok" }],
    });

    expect(result.applicant.email).toBe("a***@b.com");
    expect(result.applicant.credentials.password).toBe("[REDACTED]");
    expect(result.items[0]!.token).toBe("[REDACTED]");
    expect(result.items[1]!.name).toBe("ok");
  });

  it("handles circular references without crashing", () => {
    const obj: Record<string, unknown> = { name: "x" };
    obj.self = obj;
    expect(() => maskSensitiveData(obj)).not.toThrow();
  });
});

describe("AuditLogger", () => {
  it("passes masked entries to the configured sink", async () => {
    const sink = vi.fn();
    const logger = new AuditLogger({ sink });

    await logger.log({
      companyId: "company-1",
      operatorId: "op-1",
      action: "email_login_attempt",
      metadata: { password: "hunter2", emailAccountId: "email-1" },
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const entry = sink.mock.calls[0]![0];
    expect(entry.metadata.password).toBe("[REDACTED]");
    expect(entry.metadata.emailAccountId).toBe("email-1");
    expect(JSON.stringify(entry)).not.toContain("hunter2");
  });

  it("defaults to a console sink that never receives unmasked secrets", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new AuditLogger();

    await logger.log({
      companyId: "company-1",
      action: "proxy_test",
      metadata: { proxyPassword: "s3cret-proxy-pass" },
    });

    const loggedOutput = consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedOutput).not.toContain("s3cret-proxy-pass");
    consoleSpy.mockRestore();
  });
});
