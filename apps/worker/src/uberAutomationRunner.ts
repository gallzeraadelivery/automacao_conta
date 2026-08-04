import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AuditLogger } from "@uber-automation/security";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import {
  BrowserProfileManager,
  type BrowserProfile,
} from "@uber-automation/automation";
import { db, auditLogs } from "@uber-automation/database";
import { and, eq } from "drizzle-orm";
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
import { pickFingerprint, pickMobileFingerprint, type BrowserFingerprint } from "./browserFingerprint";
import { loadUberStorageState, persistUberStorageState } from "./sessionRestore";
import { createPlaceholderPhoneAllocator } from "./placeholderPhonePool";
import { allocateNextEarnCity } from "./earnCityPool";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Mesmo root do manual browser — path relativo no .env resolve na raiz do monorepo. */
function browserProfilesRoot(): string {
  const configured = process.env.BROWSER_PROFILES_STORAGE_PATH;
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) return path.resolve(MONOREPO_ROOT, configured);
  return path.resolve(MONOREPO_ROOT, "apps/worker/storage/browser-profiles");
}

export interface UberAutomationRunnerOptions {
  auditLogger: AuditLogger;
}

/**
 * Tentativas extras após CAPTCHA, "Request failed" (LOAD_ERROR), OTP SMS
 * no placeholder (PHONE_SMS_RETRY) ou IMAP sem código na tela OTP
 * (EMAIL_CODE_RETRY): limpa perfil + novo fingerprint + outro telefone.
 * Total = 1 execução inicial + este número.
 */
const MAX_SESSION_ROTATIONS = 4;

/** Placeholders por sessão em fillPhoneStep — offset avança a cada rotação. */
const PHONE_ATTEMPTS_PER_SESSION = 3;

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
    "PHONE_SMS_RETRY",
    "EMAIL_CODE_RETRY",
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
 * Descarta a sessão atual (cookies/dir) e cria perfil novo - usado depois
 * de CAPTCHA / LOAD_ERROR para a próxima tentativa com fingerprint diferente.
 */
async function rotateBrowserProfile(
  browserProfileManager: BrowserProfileManager,
  profile: BrowserProfile,
  applicantId: string,
  emailAccountId: string,
  proxyId: string,
): Promise<BrowserProfile> {
  await browserProfileManager.clearProfile(profile.id).catch(() => undefined);
  return browserProfileManager.createProfile(applicantId, emailAccountId, proxyId);
}

/** Já gravou ACCOUNT_CREATED no audit — não apagar cookies / não refazer signup. */
async function applicantHasUberAccountCreated(applicantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.applicantId, applicantId),
        eq(auditLogs.action, "uber_real_signup_account_created"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Já passou pela cidade Earn (e/ou Delivery) — hub sozinho não conta. */
async function applicantHasUberEarnSetup(applicantId: string): Promise<boolean> {
  const [service] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.applicantId, applicantId),
        eq(auditLogs.action, "uber_real_signup_service_type_submitted"),
      ),
    )
    .limit(1);
  if (service) return true;

  const [city] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.applicantId, applicantId),
        eq(auditLogs.action, "uber_real_signup_earning_location_confirmed"),
      ),
    )
    .limit(1);
  return Boolean(city);
}

function isCaptchaPause(result: AutomationResult): boolean {
  return (
    (result.status === "PAUSED" || result.status === "VERIFICATION_DETECTED") &&
    result.pauseReason === "CAPTCHA"
  );
}

/** Modal Uber "Request failed" / Unable to process — retentável com sessão nova. */
function isLoadError(result: AutomationResult): boolean {
  return result.status === "ERROR" && result.error?.code === "LOAD_ERROR";
}

/** OTP SMS no 555 — reinicia fluxo com outro placeholder (não pausa humano). */
function isPhoneSmsRetry(result: AutomationResult): boolean {
  return result.status === "ERROR" && result.error?.code === "PHONE_SMS_RETRY";
}

/** IMAP zerou na tela OTP após Resend — sessão nova (e-mail pode ter travado). */
function isEmailCodeRetry(result: AutomationResult): boolean {
  return result.status === "ERROR" && result.error?.code === "EMAIL_CODE_RETRY";
}

function isRotatableSessionFailure(result: AutomationResult): boolean {
  return (
    isCaptchaPause(result) ||
    isLoadError(result) ||
    isPhoneSmsRetry(result) ||
    isEmailCodeRetry(result)
  );
}

function rotationReason(
  result: AutomationResult,
): "CAPTCHA" | "LOAD_ERROR" | "PHONE_SMS_RETRY" | "EMAIL_CODE_RETRY" {
  if (isEmailCodeRetry(result)) return "EMAIL_CODE_RETRY";
  if (isPhoneSmsRetry(result)) return "PHONE_SMS_RETRY";
  if (isLoadError(result)) return "LOAD_ERROR";
  return "CAPTCHA";
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
 * Em CAPTCHA / LOAD_ERROR / PHONE_SMS_RETRY / EMAIL_CODE_RETRY: limpa perfil e
 * troca fingerprint (exceto se a conta Uber já foi criada — aí nunca apaga cookies).
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

    const browserProfileManager = new BrowserProfileManager({
      auditLogger: options.auditLogger,
      companyId: data.companyId,
      storageRoot: browserProfilesRoot(),
    });
    const proxyConnection = await resolveProxyConnection(data.proxyId).catch(() => null);
    const isProduction = env.AUTOMATION_TARGET === "production";
    const uberAccountCreated = await applicantHasUberAccountCreated(data.applicantId);
    const uberEarnSetupComplete = await applicantHasUberEarnSetup(data.applicantId);

    let profile = await hydrateProfile(
      browserProfileManager,
      data.applicantId,
      data.emailAccountId,
      data.proxyId,
    );

    const phoneAllocator = createPlaceholderPhoneAllocator(data.applicantId);

    for (let attempt = 0; attempt <= MAX_SESSION_ROTATIONS; attempt += 1) {
      // Desktop no signup; mobile só com conta já criada (Take Photo Veriff/Socure).
      const fingerprint = uberAccountCreated
        ? pickMobileFingerprint(attempt)
        : pickFingerprint(attempt);
      const result = await runSingleBrowserAttempt({
        data,
        profile,
        fingerprint,
        proxyConnection,
        isProduction,
        emailVerificationWorker,
        auditLogger: options.auditLogger,
        phoneAttemptOffset: attempt * PHONE_ATTEMPTS_PER_SESSION,
        uberAccountCreated,
        uberEarnSetupComplete,
        phoneAllocator,
      });

      // Conta já criada: nunca rotaciona/limpa cookies (perderia o hub).
      if (uberAccountCreated || !isRotatableSessionFailure(result)) {
        handleResult(result, result._screenshotPath);
        return;
      }

      const screenshotPath = result._screenshotPath;
      const reason = rotationReason(result);
      if (attempt >= MAX_SESSION_ROTATIONS) {
        handleResult(result, screenshotPath);
        return;
      }

      await options.auditLogger.log({
        companyId: data.companyId,
        applicantId: data.applicantId,
        action: "browser_session_rotated",
        metadata: {
          reason,
          attempt: attempt + 1,
          maxRotations: MAX_SESSION_ROTATIONS,
          phoneAttemptOffset: (attempt + 1) * PHONE_ATTEMPTS_PER_SESSION,
          previousFingerprintId: fingerprint.id,
          nextFingerprintId: (uberAccountCreated
            ? pickMobileFingerprint(attempt + 1)
            : pickFingerprint(attempt + 1)
          ).id,
          previousProfileId: profile.id,
          screenshotPath,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 2_500 + attempt * 1_500));

      profile = await rotateBrowserProfile(
        browserProfileManager,
        profile,
        data.applicantId,
        data.emailAccountId,
        data.proxyId,
      );
    }
  };
}

type AttemptResult = AutomationResult & { _screenshotPath?: string };

async function runSingleBrowserAttempt(args: {
  data: AutomationJobLike["data"];
  profile: BrowserProfile;
  fingerprint: BrowserFingerprint;
  proxyConnection: Awaited<ReturnType<typeof resolveProxyConnection>>;
  isProduction: boolean;
  emailVerificationWorker: IEmailVerificationWorker;
  auditLogger: AuditLogger;
  phoneAttemptOffset: number;
  uberAccountCreated: boolean;
  uberEarnSetupComplete: boolean;
  phoneAllocator: ReturnType<typeof createPlaceholderPhoneAllocator>;
}): Promise<AttemptResult> {
  const {
    data,
    profile,
    fingerprint,
    proxyConnection,
    isProduction,
    emailVerificationWorker,
    auditLogger,
    phoneAttemptOffset,
    uberAccountCreated,
    uberEarnSetupComplete,
    phoneAllocator,
  } = args;

  const browser: Browser = await chromium.launch({
    headless: env.AUTOMATION_HEADLESS,
    executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });

  let context: BrowserContext | undefined;
  try {
    const storageState = await loadUberStorageState(profile.storagePath);

    context = await browser.newContext({
      proxy:
        isProduction && proxyConnection
          ? {
              server: proxyConnection.server,
              username: proxyConnection.username,
              password: proxyConnection.password,
            }
          : undefined,
      locale: fingerprint.locale,
      userAgent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
      timezoneId: fingerprint.timezoneId,
      deviceScaleFactor: fingerprint.deviceScaleFactor,
      isMobile: Boolean(fingerprint.isMobile),
      hasTouch: Boolean(fingerprint.hasTouch ?? fingerprint.isMobile),
      // Restaura cookies + localStorage (antes só addCookies — sessão “morta”).
      storageState:
        storageState.cookies.length > 0 || storageState.origins.length > 0
          ? { cookies: storageState.cookies, origins: storageState.origins }
          : undefined,
    });

    await auditLogger.log({
      companyId: data.companyId,
      applicantId: data.applicantId,
      action: "browser_session_restored",
      metadata: {
        profileId: profile.id,
        jarSize: storageState.cookies.length,
        originCount: storageState.origins.length,
        hasUberJwt: storageState.cookies.some((c) => c.name === "jwt-session"),
        uberAccountCreated,
      },
    });

    const page = await context.newPage();

    const automationContext: AutomationContext = {
      applicantId: data.applicantId,
      browserProfileId: profile.id,
      emailAccountId: data.emailAccountId,
      proxyId: data.proxyId,
      companyId: data.companyId,
      applicantData: data.applicantData!,
      platformCredential: data.platformCredential!,
      phoneAttemptOffset,
      uberAccountCreated,
      uberEarnSetupComplete,
    };

    const persistSession = async (opts?: { markGolden?: boolean; forceGolden?: boolean }) => {
      if (!context) return;
      const result = await persistUberStorageState(context, profile.storagePath, {
        markGolden: opts?.markGolden,
        forceGolden: opts?.forceGolden,
        // Mid-flow sempre grava o que tem agora (já autenticado).
        rejectIfWeakerThanDisk: false,
      });
      await auditLogger.log({
        companyId: data.companyId,
        applicantId: data.applicantId,
        action: "browser_profile_uber_cookies_saved",
        metadata: {
          profileId: profile.id,
          jarSize: result.cookieCount,
          originCount: result.originCount,
          golden: Boolean(result.golden),
          skippedGolden: Boolean(result.skippedGolden),
          source: opts?.markGolden ? "golden_checkpoint" : "checkpoint",
          forceGolden: Boolean(opts?.forceGolden),
        },
      });

      // Número que chegou ao hub/cidade não pode repetir em outro cadastro.
      if (opts?.markGolden && automationContext.assignedPlaceholderPhone) {
        await phoneAllocator
          .markUsed(automationContext.assignedPlaceholderPhone, "hub_or_city_golden")
          .catch(() => undefined);
        await auditLogger.log({
          companyId: data.companyId,
          applicantId: data.applicantId,
          action: "placeholder_phone_marked_used",
          metadata: {
            phoneLast4: automationContext.assignedPlaceholderPhone.replace(/\D/g, "").slice(-4),
            reason: "hub_or_city_golden",
          },
        });
      }
    };

    const adapter: IPlatformAdapter = isProduction
      ? new RealUberSignupAdapter(page, {
          emailWorker: emailVerificationWorker,
          auditLogger,
          persistSession,
          allocatePlaceholderPhone: () => phoneAllocator.allocateNext(),
          markPlaceholderPhoneUsed: async (phone, reason) => {
            const markReason = reason ?? "explicit";
            await phoneAllocator.markUsed(phone, markReason);
            await auditLogger.log({
              companyId: data.companyId,
              applicantId: data.applicantId,
              action: "placeholder_phone_marked_used",
              metadata: {
                phoneLast4: phone.replace(/\D/g, "").slice(-4),
                reason: markReason,
              },
            });
          },
          allocateEarnCity: async () => {
            const city = await allocateNextEarnCity(data.applicantId);
            await auditLogger.log({
              companyId: data.companyId,
              applicantId: data.applicantId,
              action: "earn_city_allocated",
              metadata: { city },
            });
            return city;
          },
        })
      : new UberDriverApplicationAdapter(page, {
          emailWorker: emailVerificationWorker,
          auditLogger,
          config: buildMockUberConfigFromBaseUrl(env.MOCK_UBER_BASE_URL),
          selectors: MOCK_UBER_SELECTORS,
        });

    const result: AutomationResult = await adapter.start(automationContext);
    const screenshotPath = await captureDebugScreenshot(page, data.applicantId, result.status);
    return { ...result, _screenshotPath: screenshotPath };
  } finally {
    // Nunca marcar golden no finally — só checkpoints explícitos no hub/conta.
    // Senão cookies da tela de login sobrescrevem a “sessão boa”.
    if (context) {
      await persistUberCookies(context, profile, auditLogger, data.companyId, {
        rejectIfWeakerThanDisk: true,
        markGolden: false,
      }).catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
  }
}

/**
 * Persiste cookies Uber + localStorage (storageState) no perfil em disco
 * para reabrir a sessão depois (download no painel / browser manual).
 */
async function persistUberCookies(
  context: BrowserContext,
  profile: BrowserProfile,
  auditLogger: AuditLogger,
  companyId: string,
  options?: { rejectIfWeakerThanDisk?: boolean; markGolden?: boolean },
): Promise<void> {
  const result = await persistUberStorageState(context, profile.storagePath, options);
  await auditLogger.log({
    companyId,
    applicantId: profile.applicantId,
    action: result.skipped
      ? "browser_profile_uber_cookies_save_skipped"
      : "browser_profile_uber_cookies_saved",
    metadata: {
      profileId: profile.id,
      jarSize: result.cookieCount,
      originCount: result.originCount,
      skipped: Boolean(result.skipped),
      golden: Boolean(result.golden),
    },
  });
}

/**
 * Salva um screenshot em PAUSED/VERIFICATION_DETECTED/ERROR - único jeito
 * prático de diagnosticar um seletor errado quando o worker roda sem tela
 * (Docker/headless). Nunca falha o job por conta disso (best-effort).
 */
async function captureDebugScreenshot(
  page: Page,
  applicantId: string,
  status: AutomationResult["status"],
): Promise<string | undefined> {
  if (status === "SUCCESS") return undefined;
  try {
    await mkdir(env.AUTOMATION_SCREENSHOTS_PATH, { recursive: true });
    const fileName = `${applicantId}-${status}-${Date.now()}.png`;
    const filePath = path.join(env.AUTOMATION_SCREENSHOTS_PATH, fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch {
    return undefined;
  }
}

function handleResult(result: AutomationResult, screenshotPath?: string): void {
  if (result.status === "SUCCESS") return;

  const screenshotSuffix = screenshotPath ? ` [screenshot: ${screenshotPath}]` : "";

  if (result.status === "PAUSED" || result.status === "VERIFICATION_DETECTED") {
    const v = result.verificationDetected;
    throw new NonRetryableAutomationError(
      result.pauseReason!,
      (result.error?.message ?? "") + screenshotSuffix,
      v
        ? {
            profilePhotoProvider: v.profilePhotoProvider ?? (v.type === "PROFILE_PHOTO" ? v.provider : undefined),
            profilePhotoConfidence:
              v.profilePhotoConfidence ?? (v.type === "PROFILE_PHOTO" ? v.confidence : undefined),
            driverLicenseProvider:
              v.driverLicenseProvider ?? (v.type === "DRIVER_LICENSE" ? v.provider : undefined),
            driverLicenseConfidence:
              v.driverLicenseConfidence ?? (v.type === "DRIVER_LICENSE" ? v.confidence : undefined),
          }
        : undefined,
    );
  }

  throw new TechnicalAutomationError(
    toTechnicalReason(result.error?.code ?? "PAGE_UNAVAILABLE"),
    (result.error?.message ?? "") + screenshotSuffix,
  );
}
