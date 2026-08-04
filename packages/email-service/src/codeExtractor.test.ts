import { describe, it, expect } from "vitest";
import { extractVerificationCode } from "./codeExtractor";
import type { GmailMessage } from "./types";

const REQUESTED_AT = new Date("2026-01-01T12:00:00Z");

function message(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "msg-1",
    from: "noreply@uber.com",
    subject: "Seu código de confirmação Uber",
    snippet: "Seu código de verificação é 482913. Não compartilhe.",
    receivedAt: new Date("2026-01-01T12:01:00Z"),
    ...overrides,
  };
}

describe("extractVerificationCode", () => {
  it("finds the code in a well-formed, matching message", () => {
    const result = extractVerificationCode([message()], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("482913");
    expect(result!.confidence).toBe("HIGH");
  });

  it("ignores messages received before the code was requested", () => {
    const old = message({
      id: "old",
      receivedAt: new Date("2025-12-31T23:00:00Z"),
      snippet: "Seu código é 111111",
    });
    const result = extractVerificationCode([old], { requestedAt: REQUESTED_AT });
    expect(result).toBeNull();
  });

  it("ignores forwarded messages", () => {
    const forwarded = message({ id: "fwd", subject: "Fwd: Seu código de confirmação Uber" });
    const result = extractVerificationCode([forwarded], { requestedAt: REQUESTED_AT });
    expect(result).toBeNull();
  });

  it("ignores messages from unrelated senders/subjects", () => {
    const unrelated = message({
      id: "unrelated",
      from: "newsletter@somestore.com",
      subject: "50% off this weekend only!",
      snippet: "Check out our deals, code SAVE20 inside",
    });
    const result = extractVerificationCode([unrelated], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });
    expect(result).toBeNull();
  });

  it("ignores codes that were already used", () => {
    const result = extractVerificationCode([message()], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      usedCodes: new Set(["482913"]),
    });
    expect(result).toBeNull();
  });

  it("does not simply pick the most recent message - prefers the best-matching one", () => {
    const genericLater = message({
      id: "generic-later",
      from: "someone-else@example.com",
      subject: "Random subject mentioning 999999 in passing",
      snippet: "no real code keywords here but 999999 appears",
      receivedAt: new Date("2026-01-01T12:05:00Z"),
    });
    const strongEarlier = message({
      id: "strong-earlier",
      receivedAt: new Date("2026-01-01T12:02:00Z"),
    });

    const result = extractVerificationCode([genericLater, strongEarlier], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });

    expect(result!.messageId).toBe("strong-earlier");
    expect(result!.code).toBe("482913");
  });

  it("when scores tie, prefers the newer message (not a stale OTP)", () => {
    const older = message({
      id: "older",
      snippet: "Seu código de verificação é 111111. Não compartilhe.",
      bodyText: "código 111111",
      receivedAt: new Date("2026-01-01T12:01:00Z"),
    });
    const newer = message({
      id: "newer",
      snippet: "Seu código de verificação é 222222. Não compartilhe.",
      bodyText: "código 222222",
      receivedAt: new Date("2026-01-01T12:05:00Z"),
    });

    const result = extractVerificationCode([older, newer], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });

    expect(result!.messageId).toBe("newer");
    expect(result!.code).toBe("222222");
  });

  it("returns MEDIUM confidence when only the subject matches (no sender hint provided)", () => {
    const result = extractVerificationCode([message()], { requestedAt: REQUESTED_AT });
    expect(result!.confidence).toBe("MEDIUM");
  });

  it("extracts a code even when only the domain matches, not the exact sender", () => {
    const domainOnly = message({ from: "no-reply@mail.uber.com" });
    const result = extractVerificationCode([domainOnly], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });
    expect(result).not.toBeNull();
    expect(result!.confidence).not.toBe("LOW");
  });

  it("returns null when no message contains an extractable code", () => {
    const noCode = message({ snippet: "Welcome to Uber! Please complete your registration." });
    const result = extractVerificationCode([noCode], { requestedAt: REQUESTED_AT });
    expect(result).toBeNull();
  });

  it("prefers the message that mentions expectedRecipient in a catch-all inbox", () => {
    const otherAlias = message({
      id: "other",
      snippet: "code for galldelivery@mail2too.com is 111111",
      bodyText: "galldelivery@mail2too.com verification code 111111",
      receivedAt: new Date("2026-01-01T12:05:00Z"),
    });
    const targetAlias = message({
      id: "target",
      snippet: "code for gallsuper10@mail2too.com is 222222",
      bodyText: "gallsuper10@mail2too.com verification code 222222",
      receivedAt: new Date("2026-01-01T12:02:00Z"),
    });

    const result = extractVerificationCode([otherAlias, targetAlias], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      expectedRecipient: "gallsuper10@mail2too.com",
    });

    expect(result!.messageId).toBe("target");
    expect(result!.code).toBe("222222");
  });
});
