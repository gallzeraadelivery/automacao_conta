import type { UberAdapterConfig } from "./config";
import type { UberSelectors } from "./selectors";

/**
 * Config/seletores apontando para `apps/mock-server` (Fase 3) em vez do
 * site real da Uber - usados exclusivamente pelos testes de integração
 * deste pacote (`uberDriverApplicationAdapter.test.ts`) e pelo gerador de
 * relatório (`generate-report.mjs`).
 *
 * NÃO é exportado por `src/index.ts` - não faz parte da API pública do
 * pacote, só existe para validar `UberDriverApplicationAdapter` com um
 * navegador real contra HTML real, sem tocar a Uber de verdade. `baseUrl`
 * é montado em tempo de execução (a porta do mock-server é efêmera nos
 * testes), então esta função recebe a porta já escolhida.
 */
export function buildMockUberConfig(port: number): UberAdapterConfig {
  return {
    baseUrl: `http://127.0.0.1:${port}/mock-uber`,
    endpoints: {
      login: "/login",
      application: "/application",
      emailVerification: "/email-verification",
    },
    timeouts: {
      pageLoad: 10000,
      elementWait: 5000,
      actionDelay: 0,
    },
    maxContinueClicks: 8,
    expectedEmailSender: "noreply@uber.com",
  };
}

export const MOCK_UBER_SELECTORS: UberSelectors = {
  login: {
    emailInput: '[data-testid="login-email"]',
    passwordInput: '[data-testid="login-password"]',
    submitButton: '[data-testid="login-submit"]',
    errorMessage: '[data-testid="login-error"]',
  },
  applicationForm: {
    fullNameInput: '[data-testid="application-full-name"]',
    emailInput: '[data-testid="application-email"]',
    phoneInput: '[data-testid="application-phone"]',
    addressInput: '[data-testid="application-address"]',
    cityInput: '[data-testid="application-city"]',
    // No mock, "estado" é um input de texto (UF), não um <select> - o site
    // real da Uber pode diferir; é exatamente para absorver esse tipo de
    // diferença que `kind` existe.
    stateField: { selector: '[data-testid="application-state"]', kind: "fill" },
    postalCodeInput: '[data-testid="application-postal-code"]',
    vehicleTypeField: { selector: '[data-testid="application-vehicle-type"]', kind: "select" },
    submitButton: '[data-testid="application-submit"]',
    errorMessage: '[data-testid="application-error"]',
  },
  emailVerification: {
    // O mock já gera e exibe o código assim que a página carrega - não há
    // botão de "solicitar código" separado.
    requestCodeButton: undefined,
    codeInput: '[data-testid="email-verification-code"]',
    submitButton: '[data-testid="email-verification-submit"]',
    errorMessage: '[data-testid="email-verification-error"]',
  },
  // O mock não tem um botão "Continuar" genérico entre a verificação de
  // e-mail e a etapa terminal (o dispatcher redireciona automaticamente) -
  // este seletor nunca deve casar com nada nas páginas mock, o que exercita
  // o caminho "nenhum botão Continuar encontrado -> classificar a página
  // atual" do adaptador.
  continueButton: '[data-testid="__never-matches-in-mock__"]',
};
