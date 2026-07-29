import { describe, it, expect } from "vitest";
import { VerificationFlowDetector } from "./verificationFlowDetector";

const detector = new VerificationFlowDetector();

/**
 * Estas fixtures NAO reproduzem o markup do nosso proprio mock server
 * (Fase 3) - simulam como uma pagina real da Socure/IDology/etc poderia se
 * parecer, para provar que o detector generaliza alem do `data-testid`
 * proprio do ambiente de teste. A validacao contra as paginas reais da
 * Fase 3 esta em `mockServerIntegration.test.ts`.
 */
const socureHtml = `
<html>
  <head><title>Socure Identity Verification</title></head>
  <body>
    <div class="header">Powered by Socure</div>
    <img src="https://cdn.socure.com/assets/socure-logo.png" alt="Socure logo" />
    <p>Please complete identity verification to continue your registration.</p>
  </body>
</html>`;

const idologyHtml = `
<html>
  <head><title>IDology Identity Verification</title></head>
  <body>
    <div class="header">Powered by IDology</div>
    <img src="https://static.idology.com/logo.png" alt="IDology" />
    <p>Please complete identity verification to continue.</p>
  </body>
</html>`;

const jumioHtml = `
<html>
  <head><title>Document Verification</title></head>
  <body>
    <div class="footer">Verification provided by Jumio</div>
  </body>
</html>`;

const genericUnknownHtml = `
<html>
  <head><title>Identity Verification</title></head>
  <body>
    <p>Please verify your identity to continue.</p>
  </body>
</html>`;

const uberInternalHtml = `
<html>
  <head><title>Uber Verification</title></head>
  <body>
    <p>Uber is verifying your account details.</p>
  </body>
</html>`;

describe("VerificationFlowDetector.detectProfilePhotoProvider", () => {
  it("classifies Socure with HIGH confidence from name + domain + script signals", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "https://verify.socure.com/session/abc123",
      html: socureHtml,
      scripts: ["https://cdn.socure.com/verify.js", "socure-verify.js"],
      resources: ["cdn.socure.com/assets/logo.png"],
    });

    expect(result.type).toBe("PROFILE_PHOTO_VERIFICATION");
    expect(result.provider).toBe("SOCURE");
    expect(result.confidence).toBe("HIGH");
    expect(result.detectedDomain).toContain("socure.com");
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("classifies a named competitor (IDology) as NOT_SOCURE with HIGH confidence", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "https://api.idology.com/verify?session=xyz",
      html: idologyHtml,
      scripts: ["https://api.idology.com/verify.js"],
      resources: ["api.idology.com/session"],
    });

    expect(result.provider).toBe("NOT_SOCURE");
    expect(result.confidence).toBe("HIGH");
    expect(result.detectedDomain).toContain("idology.com");
  });

  it("classifies another named competitor (Jumio) as NOT_SOCURE purely from page text (no domain/script match)", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "https://partner-verify.example.com/session/1",
      html: jumioHtml,
      scripts: [],
      resources: [],
    });

    expect(result.provider).toBe("NOT_SOCURE");
    expect(result.confidence).toBe("HIGH");
    expect(result.detectionMethod).toBe("HTML_TEXT");
  });

  it("classifies a generic verification page with no provider evidence as UNKNOWN / LOW", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "http://localhost:9999/verify",
      html: genericUnknownHtml,
      scripts: [],
      resources: [],
    });

    expect(result.provider).toBe("UNKNOWN");
    expect(result.confidence).toBe("LOW");
  });

  it("classifies a completely empty/irrelevant page as UNKNOWN with UNKNOWN confidence", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "http://localhost:9999/",
      html: "<html><body></body></html>",
      scripts: [],
      resources: [],
    });

    expect(result.provider).toBe("UNKNOWN");
    expect(result.confidence).toBe("UNKNOWN");
    expect(result.signals).toEqual([]);
  });

  it("classifies a page served from Uber's own domain with no third-party signal as UBER_INTERNAL", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "https://drivers.uber.com/verify-photo",
      html: uberInternalHtml,
      scripts: [],
      resources: [],
    });

    expect(result.provider).toBe("UBER_INTERNAL");
  });

  it("never lets a conflicting weak signal override a strong Socure signal", async () => {
    const result = await detector.detectProfilePhotoProvider({
      page: {},
      url: "https://verify.socure.com/session/abc123",
      html: `${socureHtml}<div>Powered by SomeRandomVerifier</div>`,
      scripts: ["https://cdn.socure.com/verify.js"],
      resources: [],
    });

    expect(result.provider).toBe("SOCURE");
    expect(result.confidence).toBe("HIGH");
  });
});

describe("VerificationFlowDetector.detectDriverLicenseProvider", () => {
  it("classifies Socure with HIGH confidence", async () => {
    const result = await detector.detectDriverLicenseProvider({
      page: {},
      url: "https://verify.socure.com/license/abc123",
      html: socureHtml,
      scripts: ["socure-verify.js"],
      resources: ["cdn.socure.com/..."],
    });

    expect(result.type).toBe("DRIVER_LICENSE_VERIFICATION");
    expect(result.provider).toBe("SOCURE");
    expect(result.confidence).toBe("HIGH");
  });

  it("classifies a named competitor (Jumio) as NOT_SOCURE with HIGH confidence", async () => {
    const result = await detector.detectDriverLicenseProvider({
      page: {},
      url: "https://api.jumio.com/verify",
      html: jumioHtml,
      scripts: ["jumio-verify.js"],
      resources: ["api.jumio.com/..."],
    });

    expect(result.provider).toBe("NOT_SOCURE");
    expect(result.confidence).toBe("HIGH");
  });

  it("classifies a generic unidentified provider as UNKNOWN / LOW", async () => {
    const result = await detector.detectDriverLicenseProvider({
      page: {},
      url: "http://localhost:9999/license",
      html: genericUnknownHtml,
      scripts: [],
      resources: [],
    });

    expect(result.provider).toBe("UNKNOWN");
    expect(result.confidence).toBe("LOW");
  });
});

describe("VerificationFlowDetector page classification helpers", () => {
  it("isVerificationPage / isProfilePhotoPage / isDriverLicensePage", () => {
    expect(detector.isVerificationPage(socureHtml)).toBe(true);
    expect(detector.isProfilePhotoPage('<div data-step-type="profile-photo"></div>')).toBe(true);
    expect(detector.isDriverLicensePage('<div data-step-type="driver-license"></div>')).toBe(true);
    expect(detector.isDriverLicensePage("<p>Please upload your CNH</p>")).toBe(true);
  });

  it("detects CAPTCHA pages as a distinct challenge type", () => {
    const html = "<div>Prove que você é humano</div><div>reCAPTCHA</div>";
    expect(detector.isCaptchaPage(html)).toBe(true);
    expect(detector.isVerificationPage(html)).toBe(false);
    expect(detector.classifyPageType(html)).toBe("CAPTCHA");
  });

  it("detects 2FA pages as a distinct challenge type", () => {
    const html = "<h1>Autenticação em Dois Fatores</h1><p>Digite o código enviado por SMS</p>";
    expect(detector.isTwoFactorPage(html)).toBe(true);
    expect(detector.classifyPageType(html)).toBe("TWO_FACTOR");
  });

  it("detects security block pages as a distinct challenge type", () => {
    const html = "<h1>Atividade Suspeita Detectada</h1><p>Sua conta foi bloqueada</p>";
    expect(detector.isSecurityBlockPage(html)).toBe(true);
    expect(detector.classifyPageType(html)).toBe("SECURITY_BLOCK");
  });

  it("classifyPageType returns UNKNOWN for pages that match nothing", () => {
    expect(detector.classifyPageType("<div>Welcome</div>")).toBe("UNKNOWN");
  });
});
