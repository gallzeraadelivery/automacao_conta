import { describe, it, expect } from "vitest";
import { normalizeImapProvider, resolveImapOptions } from "./imapProviderConfig";

describe("imapProviderConfig", () => {
  it("resolves Spacemail to mail.spacemail.com:993", () => {
    expect(resolveImapOptions("spacemail")).toEqual({
      host: "mail.spacemail.com",
      port: 993,
    });
  });

  it("normalizes aliases case-insensitively", () => {
    expect(normalizeImapProvider("SpaceMail")).toBe("spacemail");
    expect(normalizeImapProvider("Google Workspace")).toBe("gmail");
    expect(normalizeImapProvider("outlook")).toBe("outlook");
  });

  it("keeps Gmail as the gmail preset", () => {
    expect(resolveImapOptions("gmail")).toEqual({
      host: "imap.gmail.com",
      port: 993,
    });
  });

  it("rejects unknown providers instead of falling back to Gmail", () => {
    expect(() => resolveImapOptions("cpanel-custom")).toThrow(/desconhecido/i);
  });
});
