import { chromium } from "playwright";
import { AuditLogger } from "@uber-automation/security";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import { BrowserProfileManager, type BrowserProfile } from "@uber-automation/automation";
import {
  UberDriverApplicationAdapter,
  RealUberSignupAdapter,
  buildMockUberConfigFromBaseUrl,
  MOCK_UBER_SELECTORS,
  type AutomationContext,
  type AutomationResult,
  type IPlatformAdapter,
} from "@uber-automation/platform-adapters";
import { env } from "./env";
import { resolveProxyConnection } from "./proxyConnection";
import { NonRetryableAutomationError, TechnicalAutomationError, type TechnicalReason } from "./errors";
import type { AutomationJobLike } from "./processor";

export interface UberAutomationRunnerOptions {
  auditLogger: AuditLogger;
}

/**
 * Mapeia `AutomationErrorInfo.code` (livre, definido em cada step de
 * `packages/platform-adapters`) para o enum fechado de `TechnicalReason`
 * deste worker - qualquer código não reconhecido cai em `PAGE_UNAVAILABLE`,
 * o mesmo "catch-all" já usado antes desta etapa existir.
 */
function toTechnicalReason(code: string): TechnicalReason {
  const known: TechnicalReason[] = [
    "TIMEOUT",
    "CONNECTION_FAILURE",
    "PAGE_UNAVAILABLE",
    "LOAD_ERROR",
    "PROXY_UNAVAILABLE",
  ];
  return (known as string[]).includes(code) ? (code as TechnicalReason) : "PAGE_UNAVAILABLE";
}

async function hydrateProfile(
  browserProfileManager: BrowserProfileManager,
  applicantId: string,
  emailAccountId: string,
  proxyId: string,
): Promise<BrowserProfile> {
  const existingId = await browserProfileManager.getActiveProfileId(applicantId);
  if (existingId) {
    const valid = await browserProfileManager.validateProfile(existingId);
    if (valid) return browserProfileManager.loadProfile(existingId);
  }
  return browserProfileManager.createProfile(applicantId, emailAccountId, proxyId);
}

/**
 * Fabrica o `AdministrativeFlowRunner` (ver processor.ts) usado em produção:
 * abre um Chromium real, isola a sessão por motorista (BrowserProfileManager,
 * Fase 3), aplica o proxy do motorista quando houver, e roda o adaptador da
 * Uber até concluir ou pausar numa etapa sensível. Alvo controlado por
 * `AUTOMATION_TARGET` (env.ts):
 * - "mock" (padrão): `UberDriverApplicationAdapter` contra apps/mock-server.
 * - "production": `RealUberSignupAdapter` contra drivers.uber.com/
 *   bonjour.uber.com de verdade (Fase 8) - `platformCredential` do job é
 *   ignorado nesse modo (o adaptador gera a própria senha a partir do
 *   sobrenome do motorista; não há login numa conta pré-existente).
 *
 * Limitação conhecida: cookies salvos do perfil são aplicados no início da
 * sessão, mas a sessão resultante (cookies/localStorage novos) ainda não é
 * persistida de volta no perfil ao final - mesmo estágio de completude já
 * aceito para a sessão do Gmail em `index.ts` (`saveGmailSession` é um
 * no-op documentado como refinamento futuro).
 */
export function createUberAutomationRunner(
  options: UberAutomationRunnerOptions,
): (job: AutomationJobLike, emailVerificationWorker: IEmailVerificationWorker) => Promise<void> {
  return async function runUberAdministrativeFlow(
    job: AutomationJobLike,
    emailVerificationWorker: IEmailVerificationWorker,
  ): Promise<void> {
    const data = job.data;
    if (!data.applicantData || !data.platformCredential) {
      throw new TechnicalAutomationError(
        "PAGE_UNAVAILABLE",
        "Job RUN_ADMINISTRATIVE_FLOW sem applicantData/platformCredential",
      );
    }

    // Instância própria por execução (em vez da compartilhada em index.ts,
    // usada só pelos hooks de sessão do Gmail) - precisa do companyId real
    // do job para que os audit logs de criação de perfil gravem um
    // company_id válido (coluna UUID em audit_logs); a instância
    // compartilhada não tem como saber a empresa de cada job. Estado real
    // (Postgres + disco) é o mesmo dos dois jeitos, então isso é seguro.
    const browserProfileManager = new BrowserProfileManager({
      auditLogger: options.auditLogger,
      companyId: data.companyId,
    });
    const profile = await hydrateProfile(
      browserProfileManager,
      data.applicantId,
      data.emailAccountId,
      data.proxyId,
    );
    const proxyConnection = await resolveProxyConnection(data.proxyId).catch(() => null);
    const isProduction = env.AUTOMATION_TARGET === "production";

    const browser = await chromium.launch({
      headless: true,
      executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    });

    try {
      const context = await browser.newContext({
        proxy: proxyConnection
          ? {
              server: proxyConnection.server,
              username: proxyConnection.username,
              password: proxyConnection.password,
            }
          : undefined,
        // Fluxo real (Uber de produção) foi documentado em inglês - fixa o
        // locale para reduzir o risco de a tela inicial vir em outro idioma
        // dependendo de onde o proxy resolve (ver fillIdentifierStep, que já
        // tem um fallback bilíngue para essa mesma tela por precaução extra).
        locale: isProduction ? "en-US" : undefined,
      });

      if (profile.data.uber.cookies.length > 0) {
        await context.addCookies(profile.data.uber.cookies as Parameters<typeof context.addCookies>[0]);
      }

      const page = await context.newPage();

      const adapter: IPlatformAdapter = isProduction
        ? new RealUberSignupAdapter(page, {
            emailWorker: emailVerificationWorker,
            auditLogger: options.auditLogger,
          })
        : new UberDriverApplicationAdapter(page, {
            emailWorker: emailVerificationWorker,
            auditLogger: options.auditLogger,
            config: buildMockUberConfigFromBaseUrl(env.MOCK_UBER_BASE_URL),
            selectors: MOCK_UBER_SELECTORS,
          });

      const automationContext: AutomationContext = {
        applicantId: data.applicantId,
        browserProfileId: profile.id,
        emailAccountId: data.emailAccountId,
        proxyId: data.proxyId,
        companyId: data.companyId,
        applicantData: data.applicantData,
        platformCredential: data.platformCredential,
      };

      const result: AutomationResult = await adapter.start(automationContext);
      handleResult(result);
    } finally {
      await browser.close().catch(() => undefined);
    }
  };
}

function handleResult(result: AutomationResult): void {
  if (result.status === "SUCCESS") return;

  if (result.status === "PAUSED" || result.status === "VERIFICATION_DETECTED") {
    // `pauseReason` é sempre preenchido pelo adaptador nesses dois status -
    // ver PlatformAdapter.start() em packages/platform-adapters.
    throw new NonRetryableAutomationError(result.pauseReason!, result.error?.message);
  }

  throw new TechnicalAutomationError(
    toTechnicalReason(result.error?.code ?? "PAGE_UNAVAILABLE"),
    result.error?.message,
  );
}
