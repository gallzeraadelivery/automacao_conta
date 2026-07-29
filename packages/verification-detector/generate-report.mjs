import request from "supertest";

process.env.MOCK_SESSION_SECRET ??= "report-secret";
const { createApp } = await import("@uber-automation/mock-server/src/app");
const { VerificationFlowDetector } = await import("./src/verificationFlowDetector.ts");
const { extractScriptSrcs } = await import("./src/textUtils.ts");

const app = createApp();
const detector = new VerificationFlowDetector();

async function fetchPage(path) {
  const response = await request(app).get(path);
  const html = response.text;
  return {
    html,
    url: `http://localhost:3001${path}`,
    scripts: extractScriptSrcs(html),
    resources: [],
  };
}

const rows = [];

async function runVerification(label, path, kind, expectedProvider, expectedConfidence) {
  const ctx = await fetchPage(path);
  const result =
    kind === "photo"
      ? await detector.detectProfilePhotoProvider({ page: {}, ...ctx })
      : await detector.detectDriverLicenseProvider({ page: {}, ...ctx });

  const pass = result.provider === expectedProvider && result.confidence === expectedConfidence;
  rows.push({
    scenario: label,
    path,
    expectedProvider,
    expectedConfidence,
    actualProvider: result.provider,
    actualConfidence: result.confidence,
    detectionMethod: result.detectionMethod,
    detectedDomain: result.detectedDomain ?? "-",
    signals: result.signals,
    pass,
  });
}

async function runChallenge(label, path, expectedType) {
  const ctx = await fetchPage(path);
  const actualType = detector.classifyPageType(ctx.html);
  const pass = actualType === expectedType;
  rows.push({
    scenario: label,
    path,
    expectedProvider: expectedType,
    expectedConfidence: "-",
    actualProvider: actualType,
    actualConfidence: "-",
    detectionMethod: "classifyPageType",
    detectedDomain: "-",
    signals: [
      `isVerificationPage=${detector.isVerificationPage(ctx.html)}`,
      `isCaptchaPage=${detector.isCaptchaPage(ctx.html)}`,
      `isTwoFactorPage=${detector.isTwoFactorPage(ctx.html)}`,
      `isSecurityBlockPage=${detector.isSecurityBlockPage(ctx.html)}`,
    ],
    pass,
  });
}

await runVerification(
  "Foto de perfil - Socure",
  "/mock-uber/profile-photo-socure",
  "photo",
  "SOCURE",
  "HIGH",
);
await runVerification(
  "Foto de perfil - outro provedor",
  "/mock-uber/profile-photo-other",
  "photo",
  "NOT_SOCURE",
  "HIGH",
);
await runVerification(
  "Foto de perfil - desconhecido",
  "/mock-uber/profile-photo-unknown",
  "photo",
  "UNKNOWN",
  "LOW",
);
await runVerification(
  "CNH - Socure",
  "/mock-uber/driver-license-socure",
  "license",
  "SOCURE",
  "HIGH",
);
await runVerification(
  "CNH - outro provedor",
  "/mock-uber/driver-license-other",
  "license",
  "NOT_SOCURE",
  "HIGH",
);

await runChallenge("CAPTCHA", "/mock-uber/captcha", "CAPTCHA");
await runChallenge("2FA", "/mock-uber/two-factor", "TWO_FACTOR");
await runChallenge("Bloqueio de segurança", "/mock-uber/security-block", "SECURITY_BLOCK");

const total = rows.length;
const passed = rows.filter((r) => r.pass).length;

let md = `# Relatório de precisão - VerificationFlowDetector vs. mock-server (Fase 3)\n\n`;
md += `Gerado executando o detector real contra o HTML real renderizado por \`apps/mock-server\` (não fixtures escritas à mão) - reflete exatamente o que a automação veria.\n\n`;
md += `**Taxa de acerto: ${passed}/${total} (${Math.round((passed / total) * 100)}%)**\n\n`;

md += `## Foto de perfil / CNH (provedor)\n\n`;
md += `| Cenário | URL | Esperado | Obtido | Método | Domínio | OK? |\n`;
md += `|---|---|---|---|---|---|---|\n`;
for (const row of rows.filter((r) => r.detectionMethod !== "classifyPageType")) {
  md += `| ${row.scenario} | \`${row.path}\` | ${row.expectedProvider} / ${row.expectedConfidence} | ${row.actualProvider} / ${row.actualConfidence} | ${row.detectionMethod} | ${row.detectedDomain} | ${row.pass ? "✅" : "❌"} |\n`;
}

md += `\n## Páginas de desafio (CAPTCHA / 2FA / bloqueio)\n\n`;
md += `| Cenário | URL | Esperado | Obtido | OK? |\n`;
md += `|---|---|---|---|---|\n`;
for (const row of rows.filter((r) => r.detectionMethod === "classifyPageType")) {
  md += `| ${row.scenario} | \`${row.path}\` | ${row.expectedProvider} | ${row.actualProvider} | ${row.pass ? "✅" : "❌"} |\n`;
}

md += `\n## Sinais detectados por cenário\n\n`;
for (const row of rows) {
  md += `### ${row.scenario} (\`${row.path}\`)\n\n`;
  if (row.signals.length === 0) {
    md += `_Nenhum sinal encontrado._\n\n`;
  } else {
    for (const signal of row.signals) {
      md += `- ${signal}\n`;
    }
    md += `\n`;
  }
}

console.log(md);
process.stdout.write("\n---REPORT-END---\n");

import { writeFileSync } from "node:fs";
writeFileSync(new URL("./ACCURACY_REPORT.md", import.meta.url), md.trimStart());
console.error(`\nWrote ACCURACY_REPORT.md - ${passed}/${total} passed`);
