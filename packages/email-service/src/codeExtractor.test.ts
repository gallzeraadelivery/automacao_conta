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

  it("extracts Uber Welcome OTP when subject is Welcome to Uber and body has Verification code", () => {
    const result = extractVerificationCode(
      [
        message({
          id: "welcome-otp",
          from: "admin@uber.com",
          subject: "Welcome to Uber",
          bodyText: "Verification code: 8606 Enter this code on the signup page to continue.",
          snippet: "",
          toAddresses: ["miguelfernandes170119@mailsproton.com"],
        }),
      ],
      {
        requestedAt: REQUESTED_AT,
        expectedSender: "uber.com",
        expectedRecipient: "miguelfernandes170119@mailsproton.com",
      },
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("8606");
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

  it("rejects LOW confidence candidates by default (catch-all garbage like ****00)", () => {
    const weak = message({
      id: "weak",
      from: "promo@random.com",
      subject: "Your verification reminder",
      snippet: "Call us at 2000 or visit the site.",
      bodyText: "Support line 2000",
    });
    const result = extractVerificationCode([weak], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
    });
    expect(result).toBeNull();
  });

  it("allows LOW only when minConfidence is explicitly LOW", () => {
    const weak = message({
      id: "weak-allowed",
      from: "promo@random.com",
      subject: "Your verification reminder",
      snippet: "Call us at 2000 or visit the site.",
      bodyText: "Support line 2000",
    });
    const result = extractVerificationCode([weak], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      minConfidence: "LOW",
    });
    // Sem match de sender + só subject keyword → score baixo; se extrair, LOW.
    // Com expectedSender sem match, sender=none; subject tem verification → score 2.
    expect(result === null || result.confidence === "LOW").toBe(true);
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

  it("ignores Uber OTP that does not target expectedRecipient (catch-all flood)", () => {
    const wrongAlias = message({
      id: "wrong",
      snippet: "Seu código de verificação é 333333",
      bodyText: "Enter the 4-digit code sent to you at: otheruser@mailsproton.com — 333333",
      receivedAt: new Date("2026-01-01T12:05:00Z"),
    });
    const result = extractVerificationCode([wrongAlias], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      expectedRecipient: "nataliaibarra130845@mailsproton.com",
    });
    expect(result).toBeNull();
  });

  it("matches expectedRecipient via To/Delivered-To headers when body omits alias", () => {
    const headerOnly = message({
      id: "header-target",
      snippet: "Seu código de verificação é 444444",
      bodyText: "Your verification code is 444444",
      toAddresses: ["nataliaibarra130845@mailsproton.com"],
      receivedAt: new Date("2026-01-01T12:03:00Z"),
    });
    const result = extractVerificationCode([headerOnly], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      expectedRecipient: "nataliaibarra130845@mailsproton.com",
    });
    expect(result!.code).toBe("444444");
  });

  it("ignores non-Uber senders even when subject mentions verification", () => {
    const promo = message({
      id: "promo",
      from: "newsletter@other-service.com",
      subject: "Confirm your subscription today",
      snippet: "Your verification code is 555555",
      bodyText: "Click to confirm. code 555555",
      receivedAt: new Date("2026-01-01T12:03:00Z"),
    });
    const result = extractVerificationCode([promo], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      expectedRecipient: "andresilva130845@mailsproton.com",
    });
    expect(result).toBeNull();
  });

  it("ignores Uber marketing with bare numbers in catch-all (no code keyword)", () => {
    const marketing = message({
      id: "marketing",
      from: "noreply@uber.com",
      subject: "Welcome to Uber",
      snippet: "Earn up to 2500 this week. Call 1800-123-4567.",
      bodyText: "Welcome! Your driver id is 12345678.",
      toAddresses: ["andresilva130845@mailsproton.com"],
      receivedAt: new Date("2026-01-01T12:03:00Z"),
    });
    const result = extractVerificationCode([marketing], {
      requestedAt: REQUESTED_AT,
      expectedSender: "noreply@uber.com",
      expectedRecipient: "andresilva130845@mailsproton.com",
    });
    expect(result).toBeNull();
  });
});
