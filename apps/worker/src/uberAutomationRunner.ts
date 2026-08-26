import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, type Page } from "playwright";
import { AuditLogger } from "@uber-automation/security";
import type { IEmailVerificationWorker } from "@uber-automation/email-service";
import {
  BrowserProfileManager,
  type BrowserProfile,
} from "@uber-automation/automation";
import { db, auditLogs, proxyConfigs } from "@uber-automation/database";
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
import {
  applicantNeedsProxyGeo,
  formatProxyGeoLabel,
  lookupProxyGeoViaPage,
  saveApplicantProxyGeo,
} from "./proxyGeoLookup";
import { NonRetryableAutomationError, TechnicalAutomationError, AutomationStoppedError, type TechnicalReason } from "./errors";
import type { AutomationJobLike } from "./processor";
import { pickSignupMobileFingerprint, mobilePlatformOf, type BrowserFingerprint } from "./browserFingerprint";
import { loadUberStorageState, persistUberStorageState } from "./sessionRestore";
import { createPlaceholderPhoneAllocator } from "./placeholderPhonePool";
import { allocateNextEarnCity } from "./earnCityPool";
import { loadCompanySettingsForWorker } from "./companySettings";
import {
  automationStopAllKey,
  automationStopKey,
} from "./automationStopControl";
import {
  advanceFingerprintIndex,
  getFingerprintIndex,
} from "./fingerprintRotation";
import { alignFingerprintToProxy } from "./fingerprintAlign";
import {
  applyStealthToContext,
  humanPauseMs,
} from "./browserStealth";
import { launchAutomationBrowserSession } from "./browserLaunch";
import IORedis from "ioredis";
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
 * (EMAIL_CODE_RETRY): limpa perfil + novo fingerprint (índice Redis persistente).
 * Total = 1 execução inicial + este número.
 */
const MAX_SESSION_ROTATIONS = 6;

/** Placeholders por sessão em fillPhoneStep — offset avança a cada rotação. */
const PHONE_ATTEMPTS_PER_SESSION = 2;

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
export async function applicantHasUberAccountCreated(applicantId: string): Promise<boolean> {
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

/** IMAP zerou na tela OTP após Resend — sessão nova (e-mail pode ter travado). */
function isEmailCodeRetry(result: AutomationResult): boolean {
  return result.status === "ERROR" && result.error?.code === "EMAIL_CODE_RETRY";
}

const SLOW_PROXY_CODES = new Set([
  "TIMEOUT",
  "CONNECTION_FAILURE",
  "PAGE_UNAVAILABLE",
  "PROXY_UNAVAILABLE",
  "LOAD_ERROR",
  "ELEMENT_TIMEOUT",
]);

/** goto/timeout/rede — proxy lento, não precisa esperar retry Bull no mesmo IP. */
function isSlowProxyFailure(result: AutomationResult): boolean {
  if (result.status !== "ERROR") return false;
  const code = result.error?.code ?? "";
  if (SLOW_PROXY_CODES.has(code)) return true;
  const msg = result.error?.message ?? "";
  return /Timeout \d+ms exceeded|ERR_TIMED_OUT|ERR_PROXY|ERR_CONNECTION|ERR_TUNNEL|ERR_SOCKS|net::ERR/i.test(
    msg,
  );
}

function isRotatableSessionFailure(result: AutomationResult): boolean {
  // SMS (PHONE_SMS_RETRY) NÃO rotaciona fingerprint: só troca números no retry Bull.
  return (
    isCaptchaPause(result) ||
    isLoadError(result) ||
    isEmailCodeRetry(result) ||
    isSlowProxyFailure(result)
  );
}

function rotationReason(
  result: AutomationResult,
): "CAPTCHA" | "LOAD_ERROR" | "EMAIL_CODE_RETRY" | "PROXY_SLOW" {
  if (isEmailCodeRetry(result)) return "EMAIL_CODE_RETRY";
  if (isSlowProxyFailure(result)) return "PROXY_SLOW";
  if (isLoadError(result)) return "LOAD_ERROR";
  return "CAPTCHA";
}

async function listActiveProxyIds(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ id: proxyConfigs.id })
    .from(proxyConfigs)
    .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.status, "ACTIVE")))
    .orderBy(proxyConfigs.port, proxyConfigs.id);
  return rows.map((row) => row.id);
}

function nextActiveProxyId(ids: string[], currentId: string): string | null {
  if (ids.length < 2) return null;
  const index = ids.indexOf(currentId);
  return ids[(index < 0 ? 0 : index + 1) % ids.length] ?? null;
}

async function persistJobProxyId(job: AutomationJobLike, proxyId: string): Promise<void> {
  job.data.proxyId = proxyId;
  const updater = (job as AutomationJobLike & { updateData?: (data: typeof job.data) => Promise<void> })
    .updateData;
  if (typeof updater === "function") {
    await updater.call(job, { ...job.data, proxyId }).catch(() => undefined);
  }
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
 * Em CAPTCHA / LOAD_ERROR / EMAIL_CODE_RETRY / proxy lento (TIMEOUT):
 * limpa perfil e avança fingerprint. Timeout/rede troca para o próximo
 * proxy ACTIVE (conta ainda não criada). SMS esgotado vira PHONE_SMS_RETRY.
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
    let proxyConnection = await resolveProxyConnection(data.proxyId).catch(() => null);
    const isProduction = env.AUTOMATION_TARGET === "production";
    let accountCreatedFlag = await applicantHasUberAccountCreated(data.applicantId);
    const uberEarnSetupComplete = await applicantHasUberEarnSetup(data.applicantId);

    let profile = await hydrateProfile(
      browserProfileManager,
      data.applicantId,
      data.emailAccountId,
      data.proxyId,
    );

    const phoneAllocator = createPlaceholderPhoneAllocator(data.applicantId, {
      resolvePhoneBase: async () => {
        const settings = await loadCompanySettingsForWorker(data.companyId);
        return settings.placeholderPhoneBase;
      },
    });
    const resolveEarnCity = async () => {
      const settings = await loadCompanySettingsForWorker(data.companyId);
      return settings.earnCity;
    };
    const rotationRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    let fingerprintIndex = await getFingerprintIndex(rotationRedis, data.applicantId).catch(
      () => 0,
    );

    try {
      for (let attempt = 0; attempt <= MAX_SESSION_ROTATIONS; attempt += 1) {
        // Sempre mobile (Android ↔ iPhone). Desktop desativado.
        const fingerprint = alignFingerprintToProxy(
          pickSignupMobileFingerprint(fingerprintIndex),
          proxyConnection?.declaredRegion,
        );
        const result = await runSingleBrowserAttempt({
          data,
          profile,
          fingerprint,
          proxyConnection,
          isProduction,
          emailVerificationWorker,
          auditLogger: options.auditLogger,
          phoneAttemptOffset: attempt * PHONE_ATTEMPTS_PER_SESSION,
          uberAccountCreated: accountCreatedFlag,
          uberEarnSetupComplete,
          phoneAllocator,
          resolveEarnCity,
          // Lookup geo do IP até gravar (retry após CAPTCHA/rotação).
          shouldLookupProxyGeo:
            attempt === 0 || (await applicantNeedsProxyGeo(data.applicantId).catch(() => true)),
        });

        // Conta pode ser criada no meio da tentativa — reconsulta antes de rotacionar.
        accountCreatedFlag =
          accountCreatedFlag || (await applicantHasUberAccountCreated(data.applicantId));

        // Conta já criada: nunca rotaciona/limpa cookies (perderia o hub).
        if (accountCreatedFlag || !isRotatableSessionFailure(result)) {
          handleResult(result, result._screenshotPath);
          return;
        }

        const screenshotPath = result._screenshotPath;
        const reason = rotationReason(result);
        const previousProxyId = data.proxyId;

        if (reason === "PROXY_SLOW") {
          const activeIds = await listActiveProxyIds(data.companyId);
          const nextProxyId = nextActiveProxyId(activeIds, data.proxyId);
          if (nextProxyId) {
            await persistJobProxyId(job, nextProxyId);
            proxyConnection = await resolveProxyConnection(nextProxyId).catch(() => null);
            await options.auditLogger.log({
              companyId: data.companyId,
              applicantId: data.applicantId,
              action: "proxy_rotated_slow",
              metadata: {
                previousProxyId,
                nextProxyId,
                attempt: attempt + 1,
                errorCode: result.error?.code,
                screenshotPath,
              },
            });
          }
        }

        // Sempre avança fingerprint (OTP não chegou / captcha / load error / proxy lento).
        const nextIndex = await advanceFingerprintIndex(rotationRedis, data.applicantId).catch(
          () => fingerprintIndex + 1,
        );
        const nextFingerprint = alignFingerprintToProxy(
          pickSignupMobileFingerprint(nextIndex),
          proxyConnection?.declaredRegion,
        );

        await options.auditLogger.log({
          companyId: data.companyId,
          applicantId: data.applicantId,
          action: "browser_session_rotated",
          metadata: {
            reason,
            previousProxyId,
            proxyId: data.proxyId,
            attempt: attempt + 1,
            maxRotations: MAX_SESSION_ROTATIONS,
            phoneAttemptOffset: (attempt + 1) * PHONE_ATTEMPTS_PER_SESSION,
            fingerprintIndex,
            nextFingerprintIndex: nextIndex,
            previousFingerprintId: fingerprint.id,
            nextFingerprintId: nextFingerprint.id,
            nextDeviceName: nextFingerprint.deviceName,
            nextAudioNoiseSeed: nextFingerprint.audioNoiseSeed,
            nextWebglRenderer: nextFingerprint.webglRenderer.slice(0, 80),
            previousProfileId: profile.id,
            screenshotPath,
            exhausted: attempt >= MAX_SESSION_ROTATIONS,
          },
        });

        // Limpa perfil mesmo na última tentativa: próximo retry BullMQ já nasce limpo.
        profile = await rotateBrowserProfile(
          browserProfileManager,
          profile,
          data.applicantId,
          data.emailAccountId,
          data.proxyId,
        );
        fingerprintIndex = nextIndex;

        if (attempt >= MAX_SESSION_ROTATIONS) {
          handleResult(result, screenshotPath);
          return;
        }

        // CAPTCHA: cooldown maior. Proxy lento: troca rápido e segue.
        const cooldownMs =
          reason === "CAPTCHA"
            ? 8_000 + attempt * 3_500
            : reason === "PROXY_SLOW"
              ? 800 + attempt * 400
              : 2_500 + attempt * 1_500;
        await new Promise((resolve) => setTimeout(resolve, cooldownMs));
      }
    } finally {
      await rotationRedis.quit().catch(() => undefined);
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
  resolveEarnCity: () => Promise<string>;
  shouldLookupProxyGeo?: boolean;
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
    resolveEarnCity,
    shouldLookupProxyGeo = false,
  } = args;

  const session = await launchAutomationBrowserSession({
    fingerprint,
    proxy: isProduction ? proxyConnection : null,
    profileStoragePath: profile.storagePath,
  });
  const browser = session.browser;

  const redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  let stopPollTimer: ReturnType<typeof setInterval> | undefined;
  let stoppedByOperator = false;

  let context: BrowserContext | undefined;
  try {
    // Limpa sinal antigo e começa a escutar Parar / Parar todos.
    await redis.del(automationStopKey(data.applicantId)).catch(() => undefined);
    stopPollTimer = setInterval(() => {
      void Promise.all([
        redis.get(automationStopKey(data.applicantId)),
        redis.get(automationStopAllKey(data.companyId)),
      ]).then(([one, all]) => {
        if (!one && !all) return;
        stoppedByOperator = true;
        void session.close().catch(() => undefined);
      });
    }, 1_000);

    const storageState = await loadUberStorageState(profile.storagePath);

    if (session.engine === "electron") {
      // Electron já abriu janela mobile + UA + proxy. Reusa o context CDP.
      const existing = browser.contexts()[0];
      if (!existing) {
        throw new Error("Electron CDP sem BrowserContext");
      }
      context = existing;
      // Emula mobile no CDP (touch / meta viewport) quando possível.
      await context
        .addInitScript(() => {
          try {
            Object.defineProperty(navigator, "maxTouchPoints", {
              get: () => 5,
              configurable: true,
            });
          } catch {
            /* ignore */
          }
        })
        .catch(() => undefined);
      if (storageState.cookies.length > 0) {
        await context.addCookies(storageState.cookies).catch(() => undefined);
      }
    } else {
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
        isMobile: true,
        hasTouch: true,
        storageState:
          storageState.cookies.length > 0 || storageState.origins.length > 0
            ? { cookies: storageState.cookies, origins: storageState.origins }
            : undefined,
      });
    }

    await applyStealthToContext(context, {
      locale: fingerprint.locale,
      fingerprint,
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
        fingerprintId: fingerprint.id,
        mobilePlatform: mobilePlatformOf(fingerprint),
        browserEngine: session.engine,
        timezoneId: fingerprint.timezoneId,
        deviceName: fingerprint.deviceName,
        hardwareConcurrency: fingerprint.hardwareConcurrency,
        deviceMemory: fingerprint.deviceMemory,
        webglRenderer: fingerprint.webglRenderer.slice(0, 80),
        audioNoiseSeed: fingerprint.audioNoiseSeed,
        webrtcMode: fingerprint.webrtcMode,
        canvasMode: fingerprint.canvasMode,
        proxyRegion: proxyConnection?.declaredRegion ?? null,
        stealth: true,
      },
    });

    const page =
      session.engine === "electron" && context.pages().length > 0
        ? context.pages()[0]!
        : await context.newPage();

    // Cidade real do IP de saída do proxy via IP2Location no browser (com proxy).
    // Usa a página principal — newPage() no Electron/CDP é instável.
    if (shouldLookupProxyGeo && isProduction && proxyConnection) {
      const geo = await lookupProxyGeoViaPage(page).catch(() => null);
      if (geo && (geo.city || geo.region || geo.externalIp)) {
        await saveApplicantProxyGeo(data.applicantId, geo).catch(() => undefined);
        await auditLogger
          .log({
            companyId: data.companyId,
            applicantId: data.applicantId,
            action: "proxy_geo_looked_up",
            metadata: {
              externalIp: geo.externalIp,
              city: geo.city,
              region: geo.region,
              country: geo.country ?? null,
              label: formatProxyGeoLabel(geo.city, geo.region),
              proxyId: data.proxyId,
              source: geo.source,
            },
          })
          .catch(() => undefined);
      } else {
        await auditLogger
          .log({
            companyId: data.companyId,
            applicantId: data.applicantId,
            action: "proxy_geo_lookup_failed",
            metadata: { proxyId: data.proxyId, via: "ip2location_demo_page" },
          })
          .catch(() => undefined);
      }
    }

    // Pausa curta antes do fluxo — reduz padrão goto→submit instantâneo.
    await page.waitForTimeout(humanPauseMs(600, 1_400));

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
      try {
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
            cookiesOnlyFallback: Boolean(result.cookiesOnlyFallback),
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
      } catch (error) {
        // Nunca derruba o fluxo de signup por falha ao gravar cookies.
        await auditLogger.log({
          companyId: data.companyId,
          applicantId: data.applicantId,
          action: "browser_profile_uber_cookies_save_failed",
          metadata: {
            profileId: profile.id,
            error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
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
            const city = await allocateNextEarnCity(data.applicantId, await resolveEarnCity());
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
    if (stoppedByOperator) {
      throw new AutomationStoppedError();
    }
    const screenshotPath = await captureDebugScreenshot(page, data.applicantId, result.status);
    return { ...result, _screenshotPath: screenshotPath };
  } catch (error) {
    if (stoppedByOperator) {
      throw new AutomationStoppedError();
    }
    throw error;
  } finally {
    if (stopPollTimer) clearInterval(stopPollTimer);
    await redis.del(automationStopKey(data.applicantId)).catch(() => undefined);
    await redis.quit().catch(() => undefined);
    // Nunca marcar golden no finally — só checkpoints explícitos no hub/conta.
    // Senão cookies da tela de login sobrescrevem a “sessão boa”.
    if (context) {
      await persistUberCookies(context, profile, auditLogger, data.companyId, {
        rejectIfWeakerThanDisk: true,
        markGolden: false,
      }).catch(() => undefined);
    }
    await session.close().catch(() => undefined);
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
