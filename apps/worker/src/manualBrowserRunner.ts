import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import IORedis from "ioredis";
import { AuditLogger } from "@uber-automation/security";
import { BrowserProfileManager } from "@uber-automation/automation";
import { env } from "./env";
import { resolveProxyConnection } from "./proxyConnection";
import { TechnicalAutomationError } from "./errors";
import { pickFingerprint } from "./browserFingerprint";
import type { AutomationJobLike } from "./processor";
import {
  loadUberStorageState,
  persistUberStorageState,
  looksLikeHubSessionCookies,
  MANUAL_SESSION_START_URLS,
  sessionLooksAuthenticated,
} from "./sessionRestore";
import {
  MANUAL_BROWSER_ACTIVE_TTL_SEC,
  manualBrowserActiveJobKey,
  manualBrowserStopKey,
} from "./manualBrowserControl";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function browserProfilesRoot(): string {
  const configured = process.env.BROWSER_PROFILES_STORAGE_PATH;
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) {
    // Relativo à raiz do monorepo (não ao cwd do pnpm --filter).
    return path.resolve(MONOREPO_ROOT, configured);
  }
  return path.resolve(MONOREPO_ROOT, "apps/worker/storage/browser-profiles");
}

export interface ManualBrowserRunnerOptions {
  auditLogger: AuditLogger;
}

/**
 * Abre Chromium headed com o MESMO proxy/fingerprint da automação (desktop
 * no signup; sessão restaurada) e restaura storageState (cookies + localStorage).
 *
 * Se a sessão salva for só de auth/login (sem hub), a Uber pede
 * e-mail/senha de novo — esperado até existir um login real no hub.
 * Após login manual no hub, ao fechar a janela a sessão boa é gravada.
 */
export function createManualBrowserRunner(
  options: ManualBrowserRunnerOptions,
): (job: AutomationJobLike) => Promise<void> {
  return async function runManualBrowser(job: AutomationJobLike): Promise<void> {
    const data = job.data;
    const auditLogger = options.auditLogger;
    const fingerprint = pickFingerprint(0);
    const jobId = String(job.id ?? "");
    const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    let clearActiveOnExit = true;

    try {
      const activeKey = manualBrowserActiveJobKey(data.applicantId);
      const stopKey = manualBrowserStopKey(data.applicantId);
      const previousActive = await redis.get(activeKey);

      // Reentrega stalled (worker reiniciou / tsx watch): NÃO abrir outro Chrome.
      if (previousActive && previousActive === jobId) {
        clearActiveOnExit = false;
        await auditLogger.log({
          companyId: data.companyId,
          applicantId: data.applicantId,
          action: "manual_browser_skipped_stalled_redelivery",
          metadata: { jobId },
        });
        return;
      }

      // Pedido de fechar ainda pendente (clique rápido Fechar→Abrir): limpa.
      await redis.del(stopKey);
      if (jobId) {
        await redis.set(activeKey, jobId, "EX", MANUAL_BROWSER_ACTIVE_TTL_SEC);
      }

      const browserProfileManager = new BrowserProfileManager({
        auditLogger,
        companyId: data.companyId,
        storageRoot: browserProfilesRoot(),
      });

      const proxyConnection = await resolveProxyConnection(data.proxyId).catch(() => null);
      if (!proxyConnection) {
        throw new TechnicalAutomationError(
          "PROXY_UNAVAILABLE",
          "Proxy do browser manual não encontrado ou credenciais inválidas",
        );
      }

      let profile = await browserProfileManager.getActiveProfileId(data.applicantId).then(async (id) => {
        if (id) {
          try {
            return await browserProfileManager.loadProfile(id);
          } catch {
            return null;
          }
        }
        return null;
      });

      if (!profile) {
        profile = await browserProfileManager.createProfile(
          data.applicantId,
          data.emailAccountId,
          data.proxyId,
        );
      }

      const storageState = await loadUberStorageState(profile.storagePath);
      const loadedCookieCount = storageState.cookies.length;
      const hubSessionLikely = looksLikeHubSessionCookies(storageState.cookies);

      await auditLogger.log({
        companyId: data.companyId,
        applicantId: data.applicantId,
        action: "manual_browser_opening",
        metadata: {
          profileId: profile.id,
          proxyId: data.proxyId,
          jarSize: loadedCookieCount,
          originCount: storageState.origins.length,
          fingerprintId: fingerprint.id,
          hasUberJwt: storageState.cookies.some((c) => c.name === "jwt-session"),
          hubSessionLikely,
          jobId,
        },
      });

      if (loadedCookieCount === 0) {
        throw new TechnicalAutomationError(
          "PAGE_UNAVAILABLE",
          "Nenhum cookie Uber no perfil — rode a automação antes de abrir o browser manual",
        );
      }

      const browser: Browser = await chromium.launch({
        headless: false,
        executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ["--disable-blink-features=AutomationControlled"],
      });

      let saveTimer: ReturnType<typeof setInterval> | undefined;
      let stopPollTimer: ReturnType<typeof setInterval> | undefined;
      let lastGoodCookieCount = loadedCookieCount;
      let closedByStopSignal = false;

      try {
        const context = await browser.newContext({
          proxy: {
            server: proxyConnection.server,
            username: proxyConnection.username,
            password: proxyConnection.password,
          },
          locale: fingerprint.locale,
          userAgent: fingerprint.userAgent,
          viewport: fingerprint.viewport,
          timezoneId: fingerprint.timezoneId,
          deviceScaleFactor: fingerprint.deviceScaleFactor,
          isMobile: Boolean(fingerprint.isMobile),
          hasTouch: Boolean(fingerprint.hasTouch ?? fingerprint.isMobile),
          storageState: {
            cookies: storageState.cookies,
            origins: storageState.origins,
          },
        });

        const injected = await context.cookies();
        await auditLogger.log({
          companyId: data.companyId,
          applicantId: data.applicantId,
          action: "manual_browser_cookies_injected",
          metadata: {
            profileId: profile.id,
            jarSize: injected.length,
            hasUberJwt: injected.some((c) => c.name === "jwt-session"),
            hubSessionLikely: looksLikeHubSessionCookies(injected),
            domains: [...new Set(injected.map((c) => c.domain))],
          },
        });

        const page = context.pages()[0] ?? (await context.newPage());

        let finalUrl = page.url();
        for (const url of MANUAL_SESSION_START_URLS) {
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            finalUrl = page.url();
            if (sessionLooksAuthenticated(finalUrl)) break;
            if (!/login|signup|welcome|phone|sms|auth\.uber/i.test(finalUrl)) break;
          } catch {
            // tenta próxima
          }
        }

        const needsLogin =
          /auth\.uber\.com/i.test(finalUrl) ||
          (await page
            .getByRole("heading", {
              name: /enter your mobile number|phone number or email|log in|what'?s your phone|welcome back/i,
            })
            .first()
            .isVisible({ timeout: 2_000 })
            .catch(() => false));

        if (needsLogin) {
          await auditLogger.log({
            companyId: data.companyId,
            applicantId: data.applicantId,
            action: "manual_browser_login_required",
            metadata: {
              url: finalUrl,
              hint: "Cookies no disco não autenticam no hub — faça login manual; ao fechar no hub a sessão boa será salva",
            },
          });
        }

        await auditLogger.log({
          companyId: data.companyId,
          applicantId: data.applicantId,
          action: "manual_browser_ready",
          metadata: {
            url: finalUrl,
            jarSize: (await context.cookies()).length,
            loginRequired: needsLogin,
          },
        });

        const saveSafe = async (source: string) => {
          const onHub = sessionLooksAuthenticated(page.url());
          const result = await persistUberStorageState(context, profile.storagePath, {
            // Em tela de login não sobrescreve sessão melhor no disco.
            rejectIfWeakerThanDisk: !onHub,
            markGolden: onHub,
          });
          if (result.skipped) {
            await auditLogger.log({
              companyId: data.companyId,
              applicantId: data.applicantId,
              action: "browser_profile_uber_cookies_save_skipped",
              metadata: {
                source,
                jarSize: result.cookieCount,
                reason: "weaker_than_disk",
              },
            });
            return;
          }
          lastGoodCookieCount = Math.max(lastGoodCookieCount, result.cookieCount);
          await auditLogger.log({
            companyId: data.companyId,
            applicantId: data.applicantId,
            action: "browser_profile_uber_cookies_saved",
            metadata: {
              profileId: profile.id,
              source,
              jarSize: result.cookieCount,
              originCount: result.originCount,
              golden: Boolean(result.golden),
              onHub,
            },
          });
        };

        saveTimer = setInterval(() => {
          void saveSafe("manual_browser_interval").catch(() => undefined);
        }, 30_000);

        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          browser.on("disconnected", finish);
          stopPollTimer = setInterval(() => {
            void redis.get(stopKey).then((flag) => {
              if (!flag) return;
              closedByStopSignal = true;
              void browser.close().catch(() => undefined);
            });
          }, 1_000);
        });

        if (saveTimer) clearInterval(saveTimer);
        if (stopPollTimer) clearInterval(stopPollTimer);
        await saveSafe("manual_browser").catch(() => undefined);
      } finally {
        if (saveTimer) clearInterval(saveTimer);
        if (stopPollTimer) clearInterval(stopPollTimer);
        await browser.close().catch(() => undefined);
      }

      await auditLogger.log({
        companyId: data.companyId,
        applicantId: data.applicantId,
        action: "manual_browser_closed",
        metadata: { closedByStopSignal, jobId },
      });
    } finally {
      if (clearActiveOnExit) {
        await redis.del(manualBrowserActiveJobKey(data.applicantId)).catch(() => undefined);
      }
      await redis.del(manualBrowserStopKey(data.applicantId)).catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }
  };
}
