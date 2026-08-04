import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../../types";
import type { RealStepContext } from "../realStepContext";
import type { Page } from "playwright";

/**
 * Sessão pós-conta: cookies válidos → hub bonjour, sem refazer signup.
 */

export async function looksLikeSmsChallenge(page: Page): Promise<boolean> {
  const sms = page
    .getByRole("heading", { name: /sent via sms|c[oó]digo.*(sms|texto)|code sent via sms/i })
    .or(page.getByText(/sent via sms at/i))
    .or(page.getByRole("button", { name: /resend code via sms|call me with code/i }));
  return sms.first().isVisible({ timeout: 1_200 }).catch(() => false);
}

export async function looksLikeAuthGate(page: Page): Promise<boolean> {
  if (await looksLikeSmsChallenge(page)) return true;

  const coldLogin = page
    .getByRole("heading", {
      name: /what'?s your phone number or email|phone number or email|log in to uber|sign up to drive/i,
    })
    .or(page.getByRole("button", { name: /^log in with qr code$/i }));
  return coldLogin.first().isVisible({ timeout: 1_500 }).catch(() => false);
}

export async function looksLikeOnboardingScreens(page: Page): Promise<boolean> {
  const ui = page
    .getByRole("heading", {
      name: /gender|g[eê]nero|earn with uber|what'?s your gender|all set|choose how you want to earn/i,
    })
    .or(page.getByText(/where would you like to earn/i))
    .or(page.getByText(/^delivery with car$/i));
  return ui.first().isVisible({ timeout: 2_500 }).catch(() => false);
}

export async function looksLikeUberHub(page: Page): Promise<boolean> {
  if (await looksLikeAuthGate(page)) return false;

  // NÃO aceitar só a URL bonjour/drivers — spinner branco em
  // bonjour.uber.com/profile passava como "hub" e pulava o Earn.
  const hubUi = page
    .getByText(/driver requirements/i)
    .or(page.getByRole("tab", { name: /^documents$/i }))
    .or(page.getByText(/^documents$/i))
    .or(page.getByRole("heading", { name: /welcome/i }))
    .or(page.getByText(/add my vehicle|go online|you're offline|earnings/i));

  return hubUi.first().isVisible({ timeout: 2_500 }).catch(() => false);
}

async function waitOutWhiteSpinner(page: Page, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await looksLikeUberHub(page)) return;
    if (await looksLikeAuthGate(page)) return;
    if (await looksLikeOnboardingScreens(page)) return;
    const gender = page.getByRole("heading", { name: /gender|g[eê]nero|what'?s your gender/i });
    if (await gender.first().isVisible({ timeout: 400 }).catch(() => false)) return;
    await page.waitForTimeout(800);
  }
}

const HUB_CANDIDATE_URLS = [
  "https://bonjour.uber.com/profile",
  "https://bonjour.uber.com/",
  "https://bonjour.uber.com/home",
  "https://drivers.uber.com/",
] as const;

/**
 * Se já há cookies de conta criada, abre bonjour e confirma sessão logada.
 * Retorna true → pular signup (identifier/OTP/phone/…) e ir ao hub.
 */
export async function tryResumeHubSession(ctx: RealStepContext): Promise<boolean> {
  const { page, config } = ctx;
  const urls = [config.profileUrl, ...HUB_CANDIDATE_URLS.filter((u) => u !== config.profileUrl)];

  for (const url of urls) {
    try {
      await page.goto(url, {
        timeout: Math.max(config.timeouts.pageLoad, 45_000),
        waitUntil: "domcontentloaded",
      });
    } catch {
      continue;
    }

    // Mobile (Android/iPhone) demora mais no spinner branco do bonjour.
    await waitOutWhiteSpinner(page, 45_000);

    if (await looksLikeSmsChallenge(page)) {
      await ctx.recordStep("HUB_RESUME_BLOCKED_SMS", { url: page.url() });
      continue;
    }

    if (await looksLikeAuthGate(page)) {
      continue;
    }

    // Hub com Documents OU ainda no onboarding (gênero/cidade) — ambos
    // evitam refazer signup/IMAP.
    if ((await looksLikeUberHub(page)) || (await looksLikeOnboardingScreens(page))) {
      await ctx.recordStep("HUB_SESSION_RESUMED", { url: page.url(), via: url });
      await ctx.persistSession?.({ markGolden: true });
      return true;
    }

    // Última chance: reload curto se ainda estiver em spinner/URL de perfil.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await waitOutWhiteSpinner(page, 25_000);
    if ((await looksLikeUberHub(page)) || (await looksLikeOnboardingScreens(page))) {
      await ctx.recordStep("HUB_SESSION_RESUMED", { url: page.url(), via: `${url}#reload` });
      await ctx.persistSession?.({ markGolden: true });
      return true;
    }
  }

  return false;
}

/**
 * Conta já criada no audit, mas hub não abriu: pausa humana (NÃO refaz signup
 * nem espera IMAP — isso apaga/ignora cookies e pede SMS no 561).
 */
export function pauseForHubManualResume(): never {
  throw new AutomationPauseSignal("SECURITY_BLOCK", {
    type: "SECURITY_BLOCK",
    provider: "HUB_SESSION",
    confidence: "HIGH",
  });
}

/** goto tolerante a ERR_ABORTED (redirect chain da Uber cancela a navegação). */
export async function softGoto(
  page: Page,
  url: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/ERR_ABORTED|interrupted|Navigation cancelled/i.test(msg)) {
      throw error;
    }
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(800);
}

/**
 * Após ACCOUNT_CREATED: não pular para o hub ainda — precisa gênero → cidade
 * → Delivery. Sai de auth.uber.com / spinner e aterra em drivers com a UI
 * de onboarding (ou hub se a Uber já pulou essas telas).
 */
export async function settleAfterAccountCreated(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  const timeout = Math.max(config.timeouts.pageLoad, 45_000);

  await waitOutWhiteSpinner(page, 25_000);

  const onboardingUi = page
    .getByRole("heading", { name: /gender|g[eê]nero|earn with uber|what'?s your gender|all set/i })
    .or(page.getByText(/where would you like to earn/i));

  if (await onboardingUi.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await ctx.recordStep("POST_ACCOUNT_SETTLED", { url: page.url(), already: "onboarding" });
    return;
  }

  if (await looksLikeUberHub(page)) {
    await ctx.recordStep("POST_ACCOUNT_SETTLED", { url: page.url(), already: "hub" });
    return;
  }

  // auth.uber.com / branco — força o next_url do fluxo (drivers).
  await softGoto(page, config.driversBaseUrl, timeout);
  await waitOutWhiteSpinner(page, 25_000);

  if (await onboardingUi.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
    await ctx.recordStep("POST_ACCOUNT_SETTLED", { url: page.url(), via: "drivers" });
    return;
  }

  if (await looksLikeUberHub(page)) {
    await ctx.recordStep("POST_ACCOUNT_SETTLED", { url: page.url(), via: "drivers_hub" });
    return;
  }

  await ctx.recordStep("POST_ACCOUNT_SETTLED", {
    url: page.url(),
    via: "drivers",
    warning: "onboarding_ui_not_confirmed",
  });
}

/**
 * Logo após ACCOUNT_CREATED: garante cookies + entrada no hub (não fica
 * preso em spinner branco da tela de gênero).
 */
export async function ensureHubAfterAccountCreated(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;

  await waitOutWhiteSpinner(page, 25_000);

  if (await looksLikeUberHub(page)) {
    await ctx.recordStep("HUB_OPENED", { url: page.url(), source: "post_account_wait" });
    await ctx.persistSession?.({ markGolden: true });
    return;
  }

  const genderOrEarn = page
    .getByRole("heading", { name: /gender|g[eê]nero|earn with uber|what'?s your gender/i })
    .or(page.getByText(/where would you like to earn/i));
  if (await genderOrEarn.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return;
  }

  const resumed = await tryResumeHubSession(ctx);
  if (resumed) return;

  try {
    await page.goto(config.profileUrl, {
      timeout: Math.max(config.timeouts.pageLoad, 45_000),
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    throw toTechnicalError(
      error,
      "PAGE_LOAD_TIMEOUT",
      "Conta criada mas falhou ao abrir bonjour.uber.com/profile com a sessão",
    );
  }

  await waitOutWhiteSpinner(page, 20_000);

  if (await looksLikeAuthGate(page)) {
    throw new AutomationTechnicalError(
      "PAGE_UNAVAILABLE",
      "Conta criada mas cookies não autenticaram no hub (bonjour pediu login de novo)",
    );
  }

  if (!(await looksLikeUberHub(page))) {
    const stillOnboarding = await genderOrEarn.first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!stillOnboarding) {
      throw new AutomationTechnicalError(
        "PAGE_UNAVAILABLE",
        `Conta criada mas hub não carregou (url=${page.url()})`,
      );
    }
    // Ainda em gênero/cidade — não marca golden (golden vem após cidade).
    await ctx.recordStep("HUB_PENDING_ONBOARDING", { url: page.url() });
    return;
  }

  await ctx.recordStep("HUB_OPENED", { url: page.url(), source: "goto_profile" });
  await ctx.persistSession?.({ markGolden: true });
}
