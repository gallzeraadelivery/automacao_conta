import { chromium } from "playwright";
import { AuditLogger } from "@uber-automation/security";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import { BrowserProfileManager, type BrowserProfile } from "@uber-automation/automation";
import {
  UberDriverApplicationAdapter,
  UBER_CONFIG,
  UBER_SELECTORS,
  buildMockUberConfigFromBaseUrl,
  MOCK_UBER_SELECTORS,
  type UberAdapterConfig,
  type UberSelectors,
  type AutomationContext,
  type AutomationResult,
} from "@uber-automation/platform-adapters";
import { env } from "./env";
import { resolveProxyConnection } from "./proxyConnection";
import { NonRetryableAutomationError, TechnicalAutomationError, type TechnicalReason } from "./errors";
import type { AutomationJobLike } from "./processor";

export interface UberAutomationRunnerOptions {
  auditLogger: AuditLogger;
}

function resolveTargetConfig(): { config: UberAdapterConfig; selectors: UberSelectors } {
  if (env.AUTOMATION_TARGET === "production") {
    return { config: UBER_CONFIG, selectors: UBER_SELECTORS };
  }
  return {
    config: buildMockUberConfigFromBaseUrl(env.MOCK_UBER_BASE_URL),
    selectors: MOCK_UBER_SELECTORS,
  };
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
 * Fase 3), aplica o proxy do motorista quando houver, e roda
 * `UberDriverApplicationAdapter` (Fase 5) até concluir ou pausar numa etapa
 * sensível. Alvo controlado por `AUTOMATION_TARGET` (padrão: mock-server,
 * nunca a Uber real) - ver env.ts.
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
    const { config, selectors } = resolveTargetConfig();

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
      });

      if (profile.data.uber.cookies.length > 0) {
        await context.addCookies(profile.data.uber.cookies as Parameters<typeof context.addCookies>[0]);
      }

      const page = await context.newPage();

      const adapter = new UberDriverApplicationAdapter(page, {
        emailWorker: emailVerificationWorker,
        auditLogger: options.auditLogger,
        config,
        selectors,
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
