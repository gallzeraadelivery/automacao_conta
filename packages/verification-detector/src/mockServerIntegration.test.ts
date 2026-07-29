import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { VerificationFlowDetector } from "./verificationFlowDetector";
import { extractScriptSrcs } from "./textUtils";

/**
 * Valida o detector contra o HTML REAL renderizado pelo mock server da
 * Fase 3 (apps/mock-server), nao contra fixtures escritas a mao - evita
 * desalinhamento entre o que testamos e o que a automacao realmente veria.
 */

let app: Express;
const detector = new VerificationFlowDetector();

beforeAll(async () => {
  process.env.MOCK_SESSION_SECRET ??= "test-secret";
  const { createApp } = await import("@uber-automation/mock-server/src/app");
  app = createApp();
});

async function fetchPage(path: string) {
  const response = await request(app).get(path);
  expect(response.status).toBe(200);
  const html = response.text;
  return {
    html,
    url: `http://localhost:3001${path}`,
    scripts: extractScriptSrcs(html),
    resources: [] as string[],
  };
}

describe("VerificationFlowDetector vs. mock-server (Fase 3) - foto de perfil", () => {
  it("profile-photo-socure -> SOCURE / HIGH", async () => {
    const ctx = await fetchPage("/mock-uber/profile-photo-socure");
    const result = await detector.detectProfilePhotoProvider({ page: {}, ...ctx });
    expect(result.provider).toBe("SOCURE");
    expect(result.confidence).toBe("HIGH");
    expect(result.detectedDomain).toContain("socure.com");
  });

  it("profile-photo-other -> NOT_SOCURE / HIGH", async () => {
    const ctx = await fetchPage("/mock-uber/profile-photo-other");
    const result = await detector.detectProfilePhotoProvider({ page: {}, ...ctx });
    expect(result.provider).toBe("NOT_SOCURE");
    expect(result.confidence).toBe("HIGH");
    expect(result.detectedDomain).toContain("verificador-xyz.com");
  });

  it("profile-photo-unknown -> UNKNOWN / LOW", async () => {
    const ctx = await fetchPage("/mock-uber/profile-photo-unknown");
    const result = await detector.detectProfilePhotoProvider({ page: {}, ...ctx });
    expect(result.provider).toBe("UNKNOWN");
    expect(result.confidence).toBe("LOW");
  });
});

describe("VerificationFlowDetector vs. mock-server (Fase 3) - CNH", () => {
  it("driver-license-socure -> SOCURE / HIGH", async () => {
    const ctx = await fetchPage("/mock-uber/driver-license-socure");
    const result = await detector.detectDriverLicenseProvider({ page: {}, ...ctx });
    expect(result.provider).toBe("SOCURE");
    expect(result.confidence).toBe("HIGH");
  });

  it("driver-license-other -> NOT_SOCURE / HIGH", async () => {
    const ctx = await fetchPage("/mock-uber/driver-license-other");
    const result = await detector.detectDriverLicenseProvider({ page: {}, ...ctx });
    expect(result.provider).toBe("NOT_SOCURE");
    expect(result.confidence).toBe("HIGH");
  });
});

describe("VerificationFlowDetector vs. mock-server (Fase 3) - páginas de desafio", () => {
  it("captcha -> classifyPageType CAPTCHA, isVerificationPage false", async () => {
    const ctx = await fetchPage("/mock-uber/captcha");
    expect(detector.isCaptchaPage(ctx.html)).toBe(true);
    expect(detector.classifyPageType(ctx.html)).toBe("CAPTCHA");
    expect(detector.isVerificationPage(ctx.html)).toBe(false);
  });

  it("two-factor -> classifyPageType TWO_FACTOR, isVerificationPage false", async () => {
    const ctx = await fetchPage("/mock-uber/two-factor");
    expect(detector.isTwoFactorPage(ctx.html)).toBe(true);
    expect(detector.classifyPageType(ctx.html)).toBe("TWO_FACTOR");
    expect(detector.isVerificationPage(ctx.html)).toBe(false);
  });

  it("security-block -> classifyPageType SECURITY_BLOCK, isVerificationPage false", async () => {
    const ctx = await fetchPage("/mock-uber/security-block");
    expect(detector.isSecurityBlockPage(ctx.html)).toBe(true);
    expect(detector.classifyPageType(ctx.html)).toBe("SECURITY_BLOCK");
    expect(detector.isVerificationPage(ctx.html)).toBe(false);
  });
});

describe("VerificationFlowDetector vs. mock-server (Fase 3) - página de login/formulário", () => {
  it("login page is not classified as any verification/challenge page", async () => {
    const ctx = await fetchPage("/mock-uber/login");
    expect(detector.isVerificationPage(ctx.html)).toBe(false);
    expect(detector.isCaptchaPage(ctx.html)).toBe(false);
    expect(detector.isTwoFactorPage(ctx.html)).toBe(false);
    expect(detector.isSecurityBlockPage(ctx.html)).toBe(false);
    expect(detector.classifyPageType(ctx.html)).toBe("UNKNOWN");
  });
});
