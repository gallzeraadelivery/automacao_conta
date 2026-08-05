import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";
import { chromium } from "playwright";
import { env } from "./env";
import { stealthLaunchOptions } from "./browserStealth";
import type { BrowserFingerprint } from "./browserFingerprint";
import type { ProxyConnection } from "./proxyConnection";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, "../../..");
const MOBILE_SHELL_DIR = path.resolve(MONOREPO_ROOT, "apps/mobile-shell");
const MOBILE_SHELL_MAIN = path.join(MOBILE_SHELL_DIR, "main.cjs");

export type BrowserEngine = "electron" | "chromium";

export interface AutomationBrowserSession {
  browser: Browser;
  engine: BrowserEngine;
  /** Processo Electron (se engine=electron). */
  electronProcess?: ChildProcess;
  close: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Não foi possível alocar porta CDP"));
        return;
      }
      const port = addr.port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

function resolveElectronBinary(): string {
  const candidates = [
    path.join(MOBILE_SHELL_DIR, "node_modules/electron"),
    path.join(MONOREPO_ROOT, "node_modules/electron"),
    "electron",
  ];
  for (const id of candidates) {
    try {
      const electronPath = require(id) as string;
      if (electronPath) return electronPath;
    } catch {
      /* next */
    }
  }
  throw new Error(
    "Binário Electron não encontrado — rode pnpm install (apps/mobile-shell)",
  );
}

async function waitForReadyFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(filePath, "utf8");
      if (raw.includes('"ready":true') || raw.includes('"ready": true')) return;
    } catch {
      /* ainda não */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timeout esperando Electron MOBILE_SHELL_READY (${timeoutMs}ms)`);
}

/**
 * Lança Electron mobile + conecta Playwright via CDP.
 */
export async function launchElectronMobileSession(args: {
  fingerprint: BrowserFingerprint;
  proxy?: ProxyConnection | null;
  headless?: boolean;
}): Promise<AutomationBrowserSession> {
  const { fingerprint, proxy } = args;
  const cdpPort = await freePort();
  const readyDir = await mkdtemp(path.join(tmpdir(), "mobile-shell-"));
  const readyFile = path.join(readyDir, "ready.json");
  await writeFile(readyFile, "", "utf8");

  const shellConfig = {
    cdpPort,
    userAgent: fingerprint.userAgent,
    width: fingerprint.viewport.width,
    height: fingerprint.viewport.height,
    deviceScaleFactor: fingerprint.deviceScaleFactor,
    proxy: proxy
      ? {
          server: proxy.server,
          username: proxy.username,
          password: proxy.password,
        }
      : undefined,
  };

  const electronBin = resolveElectronBinary();
  const child = spawn(electronBin, ["--no-sandbox", "--disable-setuid-sandbox", MOBILE_SHELL_MAIN], {
    cwd: MOBILE_SHELL_DIR,
    env: {
      ...process.env,
      MOBILE_SHELL_CONFIG: JSON.stringify(shellConfig),
      MOBILE_SHELL_READY_FILE: readyFile,
      ELECTRON_ENABLE_LOGGING: "1",
      ELECTRON_DISABLE_SANDBOX: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (text.includes("MOBILE_SHELL_READY")) {
      // ok
    }
  });

  try {
    await waitForReadyFile(readyFile, 45_000);
  } catch (error) {
    child.kill("SIGKILL");
    await rm(readyDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(
      `Falha ao subir Electron mobile: ${
        error instanceof Error ? error.message : String(error)
      } | stderr=${stderrBuf.slice(-500)}`,
    );
  }

  // CDP HTTP endpoint
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  let browser: Browser | undefined;
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) {
    child.kill("SIGKILL");
    await rm(readyDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(
      `CDP Electron indisponível em ${cdpUrl}: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  return {
    browser,
    engine: "electron",
    electronProcess: child,
    close: async () => {
      await browser?.close().catch(() => undefined);
      if (!child.killed) {
        child.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        if (!child.killed) child.kill("SIGKILL");
      }
      await rm(readyDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * Chromium Playwright (fallback) — ainda com opções stealth.
 */
export async function launchChromiumSession(
  overrides: Pick<LaunchOptions, "headless"> = {},
): Promise<AutomationBrowserSession> {
  const headless = overrides.headless ?? env.AUTOMATION_HEADLESS;
  const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const preferredChannel = executablePath ? undefined : env.PLAYWRIGHT_BROWSER_CHANNEL;

  const tryLaunch = (channel?: "chrome" | "chromium") =>
    chromium.launch(
      stealthLaunchOptions({
        headless,
        executablePath,
        channel: executablePath ? undefined : channel,
      }),
    );

  let browser: Browser;
  if (!preferredChannel || preferredChannel === "chromium") {
    browser = await tryLaunch(preferredChannel);
  } else {
    try {
      browser = await tryLaunch("chrome");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[worker] canal chrome indisponível (${msg.slice(0, 160)}) — fallback chromium`);
      browser = await tryLaunch("chromium");
    }
  }

  return {
    browser,
    engine: "chromium",
    close: async () => {
      await browser.close().catch(() => undefined);
    },
  };
}

/**
 * Sempre Electron mobile. Chromium só se AUTOMATION_BROWSER_ENGINE=chromium
 * (debug explícito) — sem fallback silencioso.
 */
export async function launchAutomationBrowserSession(args: {
  fingerprint: BrowserFingerprint;
  proxy?: ProxyConnection | null;
  headless?: boolean;
}): Promise<AutomationBrowserSession> {
  const engine = env.AUTOMATION_BROWSER_ENGINE;
  if (engine === "chromium") {
    console.warn("[worker] AUTOMATION_BROWSER_ENGINE=chromium (debug) — não é o caminho de produção");
    return launchChromiumSession({ headless: args.headless });
  }

  return launchElectronMobileSession(args);
}

/** @deprecated use launchAutomationBrowserSession */
export async function launchAutomationBrowser(
  overrides: Pick<LaunchOptions, "headless"> = {},
): Promise<Browser> {
  const session = await launchChromiumSession(overrides);
  return session.browser;
}

/** Primeira página útil do browser (Electron já tem about:blank). */
export async function getOrCreatePage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    const context = contexts[0]!;
    const pages = context.pages();
    if (pages.length > 0) {
      return { context, page: pages[0]! };
    }
    const page = await context.newPage();
    return { context, page };
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
