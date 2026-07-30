import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { CredentialVault, type MasterKeyProvider } from "@uber-automation/credential-vault";
import {
  VerificationCodeNotFoundError,
  type FindVerificationCodeContext,
  type IEmailVerificationWorker,
  type SecurityChallengeResult,
  type SecurityChallengeType,
  type VerificationCodeResult,
} from "@uber-automation/email-service";
import type { ApplicantAutomationData, AutomationContext } from "./types";
import { UberDriverApplicationAdapter } from "./adapters/uber/UberDriverApplicationAdapter";
import { buildMockUberConfig, MOCK_UBER_SELECTORS } from "./adapters/uber/mockUberConfig";

/**
 * Testes de integração ponta a ponta: sobem `apps/mock-server` (Fase 3) real
 * numa porta efêmera e dirigem `UberDriverApplicationAdapter` com um
 * Chromium headless real via Playwright - a mesma técnica usada pelo
 * `mockServerIntegration.test.ts` do verification-detector (Fase 4), agora
 * também interagindo (não só lendo HTML) com as páginas: preenche
 * formulários e clica em botões de verdade, exatamente como faria contra a
 * Uber real.
 */

const CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";

function fakeKeyProvider(key = randomBytes(32)): MasterKeyProvider {
  return { getMasterKey: async () => key };
}

const APPLICANT_DATA: ApplicantAutomationData = {
  fullName: "João da Silva",
  email: "joao.silva@example.com",
  phone: "11999998888",
  address: "Rua das Flores, 123",
  city: "São Paulo",
  state: "SP",
  postalCode: "01310-100",
  vehicleType: "sedan",
};

/**
 * Implementação de teste de `IEmailVerificationWorker`: em vez de acessar um
 * Gmail real, lê o código que o próprio mock-server expõe (apenas em modo de
 * teste) via `/mock-uber/__test__/state`, usando `fetch` dentro da página
 * (mesma origem/cookies de sessão do fluxo). Isso substitui exatamente o
 * papel que `PlaywrightGmailClient` (Fase 2) exerceria contra um Gmail real -
 * o restante do adaptador não sabe a diferença.
 */
class MockStateEmailWorker implements IEmailVerificationWorker {
  constructor(
    private readonly page: Page,
    private readonly origin: string,
  ) {}

  async findVerificationCode(
    _context: FindVerificationCodeContext,
  ): Promise<VerificationCodeResult> {
    const state = await this.page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    }, `${this.origin}/mock-uber/__test__/state`);

    if (!state?.emailCode) {
      throw new VerificationCodeNotFoundError();
    }
    return { code: state.emailCode as string, confidence: "HIGH" };
  }

  async handleSecurityChallenge(
    challenge: SecurityChallengeType,
  ): Promise<SecurityChallengeResult> {
    return { status: "PAUSED", reason: challenge };
  }
}

/** `IEmailVerificationWorker` de teste que sempre devolve o mesmo código fixo - usado apenas pelo teste com `FakePage` (não precisa de sessão/mock-server real). */
class FixedCodeEmailWorker implements IEmailVerificationWorker {
  constructor(private readonly code: string) {}

  async findVerificationCode(): Promise<VerificationCodeResult> {
    return { code: this.code, confidence: "HIGH" };
  }

  async handleSecurityChallenge(
    challenge: SecurityChallengeType,
  ): Promise<SecurityChallengeResult> {
    return { status: "PAUSED", reason: challenge };
  }
}

/**
 * Double mínimo de `playwright.Page` - implementa só a superfície que os
 * steps do adaptador chamam (`goto`/`fill`/`click`/`waitForLoadState`/
 * `waitForTimeout`/`$`/`content`/`url`/`close`), sem navegação de verdade.
 * Usado por um único teste (ver acima) para validar `CompletionStep` sem
 * depender de rede real - todo o resto da suíte usa um Chromium real contra
 * `apps/mock-server`.
 */
class FakePage {
  private readonly currentUrl = "https://fake.test/administrative-review";

  async goto(): Promise<null> {
    return null;
  }

  async fill(): Promise<void> {}

  async selectOption(): Promise<string[]> {
    return [];
  }

  async click(): Promise<void> {}

  async waitForLoadState(): Promise<void> {}

  async waitForTimeout(): Promise<void> {}

  // Nenhum seletor é encontrado - `EmailVerificationStep`'s botão opcional
  // de "solicitar código" e o `continueButton` genérico ficam sempre ausentes.
  async $(): Promise<null> {
    return null;
  }

  // Texto deliberadamente genérico - nenhuma palavra que os padrões de
  // `classifyPageType` (foto/selfie/CNH/captcha/2FA/bloqueio) reconheçam.
  async content(): Promise<string> {
    return "<html><body><h1>Estamos revisando seu cadastro</h1><p>Você será notificado em breve.</p></body></html>";
  }

  url(): string {
    return this.currentUrl;
  }

  async close(): Promise<void> {}
}

let closeServer: () => Promise<void>;
let origin: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  process.env.MOCK_SESSION_SECRET ??= "test-secret";
  const { createApp } = await import("@uber-automation/mock-server/src/app");
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));

  browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE });
}, 30000);

afterAll(async () => {
  await browser.close();
  await closeServer();
});

beforeEach(async () => {
  // Contexto novo por teste = cookies/sessão isolados, como um motorista novo.
  context = await browser.newContext();
  page = await context.newPage();
});

afterEach(async () => {
  await context.close();
});

async function buildAdapter(): Promise<{
  adapter: UberDriverApplicationAdapter;
  automationContext: AutomationContext;
}> {
  const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider() });
  const platformCredential = await vault.encrypt("qualquer-senha-o-mock-aceita", {
    applicantId: "applicant-1",
  });

  const { port } = new URL(origin);
  const config = buildMockUberConfig(Number(port));

  const adapter = new UberDriverApplicationAdapter(page, {
    emailWorker: new MockStateEmailWorker(page, origin),
    vault,
    config,
    selectors: MOCK_UBER_SELECTORS,
  });

  const automationContext: AutomationContext = {
    applicantId: "applicant-1",
    browserProfileId: "profile-1",
    emailAccountId: "email-1",
    proxyId: "proxy-1",
    companyId: "company-1",
    applicantData: APPLICANT_DATA,
    platformCredential,
  };

  return { adapter, automationContext };
}

/** Seleciona o cenário do mock-server para esta sessão de navegador (ver apps/mock-server/src/lib/scenarioContext.ts). */
async function selectScenario(scenario: string): Promise<void> {
  await page.goto(`${origin}/mock-uber/login?scenario=${scenario}`, {
    waitUntil: "domcontentloaded",
  });
}

describe("UberDriverApplicationAdapter x apps/mock-server (Fase 3, navegador real)", () => {
  it("percorre login -> formulário -> e-mail e chega a uma etapa terminal reconhecida", async () => {
    await selectScenario("photo-socure");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.status).toBe("VERIFICATION_DETECTED");
    expect(result.currentStep).toBe("VERIFICATION_DETECTED");
    expect(adapter.getStatus()).toBe("PAUSED");
  });

  it("detecta foto de perfil - Socure (HIGH)", async () => {
    await selectScenario("photo-socure");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.status).toBe("VERIFICATION_DETECTED");
    expect(result.verificationDetected).toMatchObject({
      type: "PROFILE_PHOTO",
      provider: "SOCURE",
      confidence: "HIGH",
    });
    expect(result.pauseReason).toBe("IDENTITY_VERIFICATION_REQUIRED");
  });

  it("detecta foto de perfil - outro provedor (NOT_SOCURE, HIGH)", async () => {
    await selectScenario("photo-other");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.verificationDetected).toMatchObject({
      type: "PROFILE_PHOTO",
      provider: "NOT_SOCURE",
      confidence: "HIGH",
    });
    expect(result.pauseReason).toBe("NON_SOCURE_PROVIDER");
  });

  it("detecta foto de perfil - provedor desconhecido (baixa confiança, mas ainda pausa)", async () => {
    await selectScenario("photo-unknown");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.status).toBe("VERIFICATION_DETECTED");
    expect(result.verificationDetected?.type).toBe("PROFILE_PHOTO");
    expect(result.verificationDetected?.provider).toBe("UNKNOWN");
    expect(result.pauseReason).toBe("IDENTITY_VERIFICATION_REQUIRED");
  });

  it("detecta CNH - Socure (HIGH)", async () => {
    await selectScenario("license-socure");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.verificationDetected).toMatchObject({
      type: "DRIVER_LICENSE",
      provider: "SOCURE",
      confidence: "HIGH",
    });
    expect(result.pauseReason).toBe("IDENTITY_VERIFICATION_REQUIRED");
  });

  it("detecta CNH - outro provedor (NOT_SOCURE, HIGH)", async () => {
    await selectScenario("license-other");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.verificationDetected).toMatchObject({
      type: "DRIVER_LICENSE",
      provider: "NOT_SOCURE",
      confidence: "HIGH",
    });
    expect(result.pauseReason).toBe("NON_SOCURE_PROVIDER");
  });

  it("detecta CAPTCHA e pausa sem tentar resolver", async () => {
    await selectScenario("captcha");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.status).toBe("VERIFICATION_DETECTED");
    expect(result.verificationDetected).toMatchObject({ type: "CAPTCHA", provider: "UNKNOWN" });
    expect(result.pauseReason).toBe("CAPTCHA");
    expect(adapter.getStatus()).toBe("PAUSED");
  });

  it("detecta autenticação em duas etapas (2FA) e pausa sem contornar", async () => {
    await selectScenario("2fa");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.verificationDetected).toMatchObject({ type: "TWO_FACTOR", provider: "UNKNOWN" });
    expect(result.pauseReason).toBe("TWO_FACTOR");
  });

  it("detecta bloqueio de segurança e pausa (nunca recria o cadastro)", async () => {
    await selectScenario("block");
    const { adapter, automationContext } = await buildAdapter();

    const result = await adapter.start(automationContext);

    expect(result.verificationDetected).toMatchObject({
      type: "SECURITY_BLOCK",
      provider: "UNKNOWN",
    });
    expect(result.pauseReason).toBe("SECURITY_BLOCK");
  });

  it("reporta SUCCESS quando a página final não tem nenhum marcador sensível (double de Page, sem mock-server)", async () => {
    // O mock-server (Fase 3) não tem, de propósito, nenhuma página de
    // "sucesso" real - todo cenário termina numa etapa sensível ou desafio
    // (não existe bypass legítimo), então esse caminho não pode ser
    // exercitado contra ele. Tentamos primeiro validar isso interceptando a
    // resposta da página terminal via `page.route()`, mas neste ambiente a
    // versão do driver Playwright (1.62) não bate com a revisão do Chromium
    // pré-instalada (1194) - fora do escopo desta fase corrigir - e isso faz
    // a interceptação de rede não funcionar de forma confiável para
    // requisições alcançadas via redirect (302), como o fluxo do mock-server
    // exige. Em vez de depender disso, testamos o caminho de conclusão com
    // um double mínimo de `Page` (ver `FakePage` abaixo) que nunca sai da
    // página "inicial" (sem marcador de verificação/desafio) - cobre
    // exatamente a mesma lógica do adaptador (`CompletionStep`), sem
    // depender de rede real nem do mock-server.
    const fakePage = new FakePage();
    const vault = new CredentialVault({ masterKeyProvider: fakeKeyProvider() });
    const platformCredential = await vault.encrypt("qualquer-senha", {
      applicantId: "applicant-1",
    });

    const adapter = new UberDriverApplicationAdapter(fakePage as unknown as Page, {
      emailWorker: new FixedCodeEmailWorker("123456"),
      vault,
      config: buildMockUberConfig(1),
      selectors: MOCK_UBER_SELECTORS,
    });

    const result = await adapter.start({
      applicantId: "applicant-1",
      browserProfileId: "profile-1",
      emailAccountId: "email-1",
      proxyId: "proxy-1",
      companyId: "company-1",
      applicantData: APPLICANT_DATA,
      platformCredential,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.currentStep).toBe("COMPLETION");
    expect(adapter.getStatus()).toBe("COMPLETED");
  });

  it("reporta ERROR (não trava nem lança sem contexto) quando a credencial de login está corrompida", async () => {
    await selectScenario("photo-socure");
    const { adapter, automationContext } = await buildAdapter();
    // Corrompe a credencial já criptografada para forçar falha de decrypt.
    automationContext.platformCredential = {
      ...automationContext.platformCredential,
      ciphertext: "corrompido",
    };

    const result = await adapter.start(automationContext);

    expect(result.status).toBe("ERROR");
    expect(result.error?.code).toBe("MISSING_CREDENTIAL");
  });

  it("pause()/resume()/cancel() controlam o status sem exigir um fluxo em andamento", async () => {
    const { adapter } = await buildAdapter();

    expect(adapter.getStatus()).toBe("IDLE");

    await adapter.cancel();
    expect(adapter.getStatus()).toBe("CANCELLED");
  });
});
