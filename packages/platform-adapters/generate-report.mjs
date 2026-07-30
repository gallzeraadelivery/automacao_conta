import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

process.env.MOCK_SESSION_SECRET ??= "report-secret";

const { createApp } = await import("@uber-automation/mock-server/src/app");
const { CredentialVault } = await import("@uber-automation/credential-vault");
const { VerificationCodeNotFoundError } = await import("@uber-automation/email-service");
const { UberDriverApplicationAdapter } =
  await import("./src/adapters/uber/UberDriverApplicationAdapter.ts");
const { buildMockUberConfig, MOCK_UBER_SELECTORS } =
  await import("./src/adapters/uber/mockUberConfig.ts");

const CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";

const APPLICANT_DATA = {
  fullName: "João da Silva",
  email: "joao.silva@example.com",
  phone: "11999998888",
  address: "Rua das Flores, 123",
  city: "São Paulo",
  state: "SP",
  postalCode: "01310-100",
  vehicleType: "sedan",
};

function fixedKeyProvider(key = randomBytes(32)) {
  return { getMasterKey: async () => key };
}

class MockStateEmailWorker {
  constructor(page, origin) {
    this.page = page;
    this.origin = origin;
  }

  async findVerificationCode() {
    const state = await this.page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    }, `${this.origin}/mock-uber/__test__/state`);
    if (!state?.emailCode) throw new VerificationCodeNotFoundError();
    return { code: state.emailCode, confidence: "HIGH" };
  }

  async handleSecurityChallenge(challenge) {
    return { status: "PAUSED", reason: challenge };
  }
}

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE });

const rows = [];

async function runScenario(label, scenario, expected) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/mock-uber/login?scenario=${scenario}`, {
    waitUntil: "domcontentloaded",
  });

  const vault = new CredentialVault({ masterKeyProvider: fixedKeyProvider() });
  const platformCredential = await vault.encrypt("qualquer-senha-o-mock-aceita", {
    applicantId: "applicant-1",
  });

  const adapter = new UberDriverApplicationAdapter(page, {
    emailWorker: new MockStateEmailWorker(page, origin),
    vault,
    config: buildMockUberConfig(port),
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

  const pass =
    result.status === expected.status &&
    (expected.provider === undefined ||
      result.verificationDetected?.provider === expected.provider) &&
    (expected.pauseReason === undefined || result.pauseReason === expected.pauseReason);

  rows.push({
    scenario: label,
    expected: `${expected.status}${expected.provider ? ` / ${expected.provider}` : ""}${expected.pauseReason ? ` / ${expected.pauseReason}` : ""}`,
    actual: `${result.status}${result.verificationDetected?.provider ? ` / ${result.verificationDetected.provider}` : ""}${result.pauseReason ? ` / ${result.pauseReason}` : ""}`,
    detail: JSON.stringify(result),
    pass,
  });

  await context.close();
}

await runScenario("Foto de perfil - Socure", "photo-socure", {
  status: "VERIFICATION_DETECTED",
  provider: "SOCURE",
  pauseReason: "IDENTITY_VERIFICATION_REQUIRED",
});
await runScenario("Foto de perfil - outro provedor", "photo-other", {
  status: "VERIFICATION_DETECTED",
  provider: "NOT_SOCURE",
  pauseReason: "NON_SOCURE_PROVIDER",
});
await runScenario("Foto de perfil - desconhecido", "photo-unknown", {
  status: "VERIFICATION_DETECTED",
  provider: "UNKNOWN",
  pauseReason: "IDENTITY_VERIFICATION_REQUIRED",
});
await runScenario("CNH - Socure", "license-socure", {
  status: "VERIFICATION_DETECTED",
  provider: "SOCURE",
  pauseReason: "IDENTITY_VERIFICATION_REQUIRED",
});
await runScenario("CNH - outro provedor", "license-other", {
  status: "VERIFICATION_DETECTED",
  provider: "NOT_SOCURE",
  pauseReason: "NON_SOCURE_PROVIDER",
});
await runScenario("CAPTCHA", "captcha", {
  status: "VERIFICATION_DETECTED",
  provider: "UNKNOWN",
  pauseReason: "CAPTCHA",
});
await runScenario("Autenticação em duas etapas (2FA)", "2fa", {
  status: "VERIFICATION_DETECTED",
  provider: "UNKNOWN",
  pauseReason: "TWO_FACTOR",
});
await runScenario("Bloqueio de segurança", "block", {
  status: "VERIFICATION_DETECTED",
  provider: "UNKNOWN",
  pauseReason: "SECURITY_BLOCK",
});

await browser.close();
await new Promise((resolve) => server.close(resolve));

const total = rows.length;
const passed = rows.filter((r) => r.pass).length;

let md = `# Relatório de testes - UberDriverApplicationAdapter vs. mock-server (Fase 3)\n\n`;
md += `Gerado executando o adaptador real (login → formulário → verificação de e-mail → detecção da etapa terminal) `;
md += `com um Chromium headless real via Playwright, contra o HTML real renderizado por \`apps/mock-server\` (não fixtures escritas à mão) - reflete exatamente o que a automação faria contra a Uber real, só que apontando \`baseUrl\`/seletores para o mock em vez do site real (ver \`src/adapters/uber/mockUberConfig.ts\`).\n\n`;
md += `**Taxa de acerto: ${passed}/${total} (${Math.round((passed / total) * 100)}%)**\n\n`;

md += `## Cenários (login → formulário → e-mail → etapa terminal)\n\n`;
md += `| Cenário | Esperado | Obtido | OK? |\n`;
md += `|---|---|---|---|\n`;
for (const row of rows) {
  md += `| ${row.scenario} | ${row.expected} | ${row.actual} | ${row.pass ? "✅" : "❌"} |\n`;
}

md += `\n## Cobertura adicional (fora deste script, ver \`uberDriverApplicationAdapter.test.ts\`)\n\n`;
md += `Estes três casos exigem controlar precisamente o HTML da página (nenhum marcador sensível) ou corromper uma credencial - não fazem sentido como cenário de mock-server e são cobertos pela suíte de testes (\`pnpm --filter @uber-automation/platform-adapters test\`), não por este gerador:\n\n`;
md += `- **Fluxo completo (login → formulário → e-mail → etapa terminal reconhecida)**: valida a progressão de \`currentStep\` a cada passo usando o cenário \`photo-socure\` contra o mock-server real.\n`;
md += `- **SUCCESS/conclusão sem etapa sensível**: o mock-server não tem, de propósito, nenhuma página de sucesso real (nenhum bypass legítimo existe) - testado com um double mínimo de \`Page\` (\`FakePage\`) que nunca sai de uma página administrativa genérica, para validar \`CompletionStep\` isoladamente.\n`;
md += `- **ERROR ao descriptografar uma credencial corrompida**: garante que uma falha técnica (ex: credencial corrompida, seletor desatualizado, timeout) vira um \`AutomationResult\` com \`status: 'ERROR'\` e um código estável, em vez de lançar uma exceção sem contexto.\n`;

console.log(md);
writeFileSync(new URL("./TEST_REPORT.md", import.meta.url), md.trimStart());
console.error(`\nWrote TEST_REPORT.md - ${passed}/${total} passed`);

if (passed !== total) {
  process.exitCode = 1;
}
