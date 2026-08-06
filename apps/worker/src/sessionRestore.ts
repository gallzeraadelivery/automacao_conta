import type { Cookie, BrowserContext } from "playwright";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeSiteData } from "@uber-automation/automation";

const STORAGE_STATE_FILE = "storageState.json";
/** Snapshot pós ACCOUNT_CREATED / hub — nunca sobrescrito por falha de login/SMS. */
const GOLDEN_SESSION_FILE = "session-golden.json";

export type PlaywrightSameSite = "Strict" | "Lax" | "None";

/**
 * Playwright rejeita cookies com sameSite inválido / expires quebrado.
 * Normaliza o JSON gravado por context.cookies() para addCookies/storageState.
 */
export function normalizePlaywrightCookies(raw: unknown[]): Cookie[] {
  const out: Cookie[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    const value = typeof c.value === "string" ? c.value : "";
    const domain = typeof c.domain === "string" ? c.domain : "";
    const pathValue = typeof c.path === "string" ? c.path : "/";
    if (!name || !domain) continue;

    let sameSite: PlaywrightSameSite = "Lax";
    const rawSame = String(c.sameSite ?? "Lax");
    if (rawSame === "Strict" || rawSame === "Lax" || rawSame === "None") {
      sameSite = rawSame;
    } else if (rawSame.toLowerCase() === "no_restriction") {
      sameSite = "None";
    }

    let expires = -1;
    if (typeof c.expires === "number" && Number.isFinite(c.expires)) {
      expires = c.expires > 0 ? Math.floor(c.expires) : -1;
    }

    const secure = Boolean(c.secure) || sameSite === "None";

    out.push({
      name,
      value,
      domain,
      path: pathValue,
      expires,
      httpOnly: Boolean(c.httpOnly),
      secure,
      sameSite,
    });
  }
  return out;
}

export interface UberStorageState {
  cookies: Cookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

function emptyState(): UberStorageState {
  return { cookies: [], origins: [] };
}

function hasAuthJwt(cookies: Cookie[]): boolean {
  return cookies.some((c) => c.name === "jwt-session" && c.value.length > 20);
}

/** Cookie de CSRF/redirect no bonjour — NÃO é sessão logada. */
function isEphemeralUberCookie(name: string): boolean {
  return /^(state|__cf_bm|marketing_|x-uber-analytics|_vid|_iidt|_ua|_cc)/i.test(name);
}

/**
 * Sessão “de hub” de verdade.
 * jwt em auth.uber.com + cookies `state*` no bonjour NÃO contam — isso é
 * exatamente o que sobra após redirect para login (pede e-mail/senha).
 */
export function looksLikeHubSessionCookies(cookies: Cookie[]): boolean {
  if (!hasAuthJwt(cookies)) return false;

  const meaningfulBonjour = cookies.filter(
    (c) => /bonjour\.uber\.com/i.test(c.domain ?? "") && !isEphemeralUberCookie(c.name),
  );
  const meaningfulDrivers = cookies.filter(
    (c) => /drivers\.uber\.com/i.test(c.domain ?? "") && !isEphemeralUberCookie(c.name),
  );
  // Fingerprint udi-* sozinho também não autentica no hub.
  const sessionishRoot = cookies.filter(
    (c) =>
      (c.domain === ".uber.com" || c.domain === "uber.com") &&
      !isEphemeralUberCookie(c.name) &&
      !/^udi-/i.test(c.name),
  );

  return meaningfulBonjour.length > 0 || meaningfulDrivers.length > 0 || sessionishRoot.length > 0;
}

function scoreSession(state: UberStorageState): number {
  let score = state.cookies.length;
  if (hasAuthJwt(state.cookies)) score += 50;
  if (looksLikeHubSessionCookies(state.cookies)) score += 100;
  score += state.origins.reduce((n, o) => n + o.localStorage.length, 0);
  // Bonjour/auth com localStorage real vale mais.
  if (state.origins.some((o) => /bonjour\.uber\.com/i.test(o.origin) && o.localStorage.length > 0)) {
    score += 40;
  }
  // Penaliza sessão “só auth” (login) frente a sessão de hub.
  if (hasAuthJwt(state.cookies) && !looksLikeHubSessionCookies(state.cookies)) {
    score -= 60;
  }
  return score;
}

async function readStateFile(filePath: string): Promise<UberStorageState | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as UberStorageState;
    if (!parsed || !Array.isArray(parsed.cookies)) return null;
    return {
      cookies: normalizePlaywrightCookies(parsed.cookies as unknown[]),
      origins: Array.isArray(parsed.origins) ? parsed.origins : [],
    };
  } catch {
    return null;
  }
}

async function writeStateFiles(
  profileDir: string,
  state: { cookies: unknown[]; origins: UberStorageState["origins"] },
): Promise<void> {
  const siteDir = path.join(profileDir, "uber");
  await mkdir(siteDir, { recursive: true });
  const cookies = normalizePlaywrightCookies(state.cookies as unknown[]);
  await writeFile(
    path.join(siteDir, STORAGE_STATE_FILE),
    JSON.stringify({ cookies: state.cookies, origins: state.origins }, null, 0),
    "utf8",
  );
  await writeSiteData(profileDir, "uber", { cookies });

  const flat: Record<string, string> = {};
  for (const origin of state.origins) {
    for (const entry of origin.localStorage) {
      flat[`${origin.origin}::${entry.name}`] = entry.value;
    }
  }
  await writeSiteData(profileDir, "uber", { localStorage: flat });
}

/**
 * Carrega a melhor sessão disponível: golden (checkpoint explícito) >
 * storageState > cookies.json.
 * Golden só existe se gravamos de propósito (cidade/hub) — confiar no arquivo.
 */
export async function loadUberStorageState(profileDir: string): Promise<UberStorageState> {
  const siteDir = path.join(profileDir, "uber");
  const goldenRaw = await readStateFile(path.join(siteDir, GOLDEN_SESSION_FILE));
  const golden = goldenRaw && hasAuthJwt(goldenRaw.cookies) ? goldenRaw : null;
  const current = await readStateFile(path.join(siteDir, STORAGE_STATE_FILE));

  if (golden && current) {
    if (hasAuthJwt(golden.cookies) && !hasAuthJwt(current.cookies)) return golden;
    if (scoreSession(golden) >= scoreSession(current)) return golden;
    return current;
  }
  if (golden) return golden;
  if (current) return current;

  try {
    const cookiesRaw = JSON.parse(
      await readFile(path.join(siteDir, "cookies.json"), "utf8"),
    ) as unknown[];
    const cookies = normalizePlaywrightCookies(Array.isArray(cookiesRaw) ? cookiesRaw : []);

    let origins: UberStorageState["origins"] = [];
    try {
      const ls = JSON.parse(await readFile(path.join(siteDir, "localStorage.json"), "utf8")) as Record<
        string,
        string
      >;
      if (ls && typeof ls === "object" && Object.keys(ls).length > 0) {
        const byOrigin = new Map<string, Array<{ name: string; value: string }>>();
        for (const [key, value] of Object.entries(ls)) {
          const sep = key.indexOf("::");
          if (sep > 0) {
            const origin = key.slice(0, sep);
            const name = key.slice(sep + 2);
            const list = byOrigin.get(origin) ?? [];
            list.push({ name, value: String(value) });
            byOrigin.set(origin, list);
          } else {
            const list = byOrigin.get("https://auth.uber.com") ?? [];
            list.push({ name: key, value: String(value) });
            byOrigin.set("https://auth.uber.com", list);
          }
        }
        origins = [...byOrigin.entries()].map(([origin, localStorage]) => ({
          origin,
          localStorage,
        }));
      }
    } catch {
      // sem localStorage
    }

    return { cookies, origins };
  } catch {
    return emptyState();
  }
}

export interface PersistUberStorageOptions {
  /**
   * Se true, não sobrescreve disco quando a sessão nova é pior (ex: login/SMS
   * sem jwt por cima de sessão pós-conta).
   */
  rejectIfWeakerThanDisk?: boolean;
  /** Grava também session-golden.json (só após hub autenticado de verdade). */
  markGolden?: boolean;
  /** Ignora heurística de hub (uso interno raro). */
  forceGolden?: boolean;
}

/**
 * Persiste cookies + origins (localStorage). Com `rejectIfWeakerThanDisk`,
 * protege a sessão boa contra overwrite de tentativas falhas.
 */
export async function persistUberStorageState(
  context: BrowserContext,
  profileDir: string,
  options: PersistUberStorageOptions = {},
): Promise<{
  cookieCount: number;
  originCount: number;
  skipped?: boolean;
  golden?: boolean;
  skippedGolden?: boolean;
  cookiesOnlyFallback?: boolean;
}> {
  // Electron CDP às vezes não implementa Target.createTarget — storageState()
  // quebra no meio do fluxo. Fallback: só cookies (sem localStorage origins).
  let state: { cookies: Cookie[]; origins: UberStorageState["origins"] };
  let cookiesOnlyFallback = false;
  try {
    const full = await context.storageState();
    state = {
      cookies: normalizePlaywrightCookies(full.cookies as unknown[]),
      origins: full.origins ?? [],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/Target\.createTarget|Not supported|Protocol error/i.test(msg)) {
      throw error;
    }
    const rawCookies = await context.cookies();
    state = {
      cookies: normalizePlaywrightCookies(rawCookies as unknown[]),
      origins: [],
    };
    cookiesOnlyFallback = true;
  }

  const incoming: UberStorageState = {
    cookies: state.cookies,
    origins: state.origins,
  };

  if (options.rejectIfWeakerThanDisk) {
    const onDisk = await loadUberStorageState(profileDir);
    const diskScore = scoreSession(onDisk);
    const newScore = scoreSession(incoming);
    // Não trocar sessão com jwt por outra sem jwt (caso clássico: falha SMS/login).
    if (hasAuthJwt(onDisk.cookies) && !hasAuthJwt(incoming.cookies)) {
      return { cookieCount: onDisk.cookies.length, originCount: onDisk.origins.length, skipped: true };
    }
    if (diskScore > 0 && newScore + 5 < diskScore) {
      return { cookieCount: onDisk.cookies.length, originCount: onDisk.origins.length, skipped: true };
    }
  }

  await writeStateFiles(profileDir, { cookies: state.cookies, origins: state.origins });

  if (options.markGolden && hasAuthJwt(incoming.cookies)) {
    // Só grava golden se parecer sessão de hub — não tela de login com jwt.
    if (!looksLikeHubSessionCookies(incoming.cookies) && !options.forceGolden) {
      return {
        cookieCount: incoming.cookies.length,
        originCount: incoming.origins.length,
        golden: false,
        skippedGolden: true,
        cookiesOnlyFallback,
      };
    }
    const siteDir = path.join(profileDir, "uber");
    await mkdir(siteDir, { recursive: true });
    await writeFile(
      path.join(siteDir, GOLDEN_SESSION_FILE),
      JSON.stringify(
        {
          cookies: state.cookies,
          origins: state.origins,
          savedAt: new Date().toISOString(),
        },
        null,
        0,
      ),
      "utf8",
    );
  }

  const wroteGolden =
    Boolean(options.markGolden) &&
    hasAuthJwt(incoming.cookies) &&
    (looksLikeHubSessionCookies(incoming.cookies) || Boolean(options.forceGolden));

  return {
    cookieCount: incoming.cookies.length,
    originCount: incoming.origins.length,
    golden: wroteGolden,
    cookiesOnlyFallback,
  };
}

export async function goldenSessionExists(profileDir: string): Promise<boolean> {
  try {
    await access(path.join(profileDir, "uber", GOLDEN_SESSION_FILE));
    return true;
  } catch {
    return false;
  }
}

/** URLs em ordem para retomar a sessão. */
export const MANUAL_SESSION_START_URLS = [
  "https://www.uber.com/us/en/",
  "https://bonjour.uber.com/profile",
  "https://bonjour.uber.com/",
  "https://drivers.uber.com/",
] as const;

export function sessionLooksAuthenticated(url: string): boolean {
  // auth.uber.com NUNCA é hub autenticado (mesmo com next_url=bonjour).
  if (/auth\.uber\.com/i.test(url)) return false;
  return (
    /bonjour\.uber\.com/i.test(url) ||
    /drivers\.uber\.com\/.*(?:home|earnings|documents)/i.test(url)
  );
}
