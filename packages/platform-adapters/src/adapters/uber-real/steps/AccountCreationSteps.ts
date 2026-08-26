import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../../types";
import { SecurityChallengeError, VerificationCodeNotFoundError } from "@uber-automation/email-service";
import { maskCode } from "@uber-automation/security";
import { buildPlaceholderPassword, buildPlaceholderPhone, splitFullName } from "../nameUtils";
import type { RealStepContext } from "../realStepContext";
import type { Page } from "playwright";
import { dismissCookieBannerIfPresent } from "./PreferencesSteps";

/**
 * Botão primário de avanço na Uber real. A UI oscila entre "Continue",
 * "Continuar" e "Next →" (com seta). `$` evita casar "Continue with Google"
 * / "Continue with Apple" / "Continue with Email".
 */
/** CTA de avançar: fluxos antigos + "Let's go" (earn / signup). */
const PRIMARY_NEXT_NAME =
  /^(continuar|continue|next|pr[oó]ximo|join now|let['’]?s go)(\s*→)?$/i;

async function clickPrimaryNext(ctx: RealStepContext, timeout: number): Promise<void> {
  const btn = ctx.page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first();
  await ctx.human.clickSafe(btn, { timeout });
}

/**
 * CAPTCHA / puzzle da Uber ("Protecting your account" / "Start Puzzle").
 * NUNCA resolvemos - regras de segurança do projeto. Detectar cedo evita
 * gastar 90s de polling IMAP e reportar "código não encontrado" quando o
 * e-mail simplesmente não foi enviado por causa do desafio.
 */
async function pauseIfUberSecurityPuzzle(page: Page, timeoutMs = 3_000): Promise<void> {
  const puzzle = page
    .getByRole("heading", { name: /protecting your account/i })
    .or(page.getByRole("button", { name: /^start puzzle$/i }))
    .or(page.getByText(/solve this puzzle so we know you are a real person/i))
    .or(page.getByText(/please solve this puzzle/i))
    .or(page.getByText(/protecting your account/i))
    .or(page.locator('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[id*="arkose" i]'))
    .or(page.locator('[data-testid*="arkose" i], #arkose, #arkose-challenge'));

  if (await puzzle.first().isVisible({ timeout: timeoutMs }).catch(() => false)) {
    throw new AutomationPauseSignal("CAPTCHA", {
      type: "CAPTCHA",
      provider: "ARKOSE",
      confidence: "HIGH",
    });
  }

  // Fallback: texto no DOM (modal pode estar em shadow / sem role acessível).
  const hasPuzzleText = await page
    .evaluate(() => {
      const t = (document.body?.innerText || "").toLowerCase();
      return (
        t.includes("protecting your account") ||
        t.includes("start puzzle") ||
        t.includes("solve this puzzle")
      );
    })
    .catch(() => false);
  if (hasPuzzleText) {
    throw new AutomationPauseSignal("CAPTCHA", {
      type: "CAPTCHA",
      provider: "ARKOSE",
      confidence: "HIGH",
    });
  }
}

/** Fatias curtas de IMAP com checagem de puzzle entre elas (early-stop Arkose). */
const IMAP_POLL_CHUNK_MS = 12_000;

/**
 * Modal "Request failed" / "Unable to process this request" / "Start Over".
 * É erro transitório da Uber (não CAPTCHA) - falha técnica retentável, sem
 * varrer IMAP à toa. Clica Start Over quando visível para limpar o modal
 * antes da rotação de sessão.
 */
async function failIfUberRequestFailed(page: Page, timeoutMs = 1_500): Promise<void> {
  const failed = page
    .getByRole("heading", { name: /request failed/i })
    .or(page.getByText(/unable to process this request at the moment/i))
    .or(page.getByRole("button", { name: /^start over$/i }));

  if (await failed.first().isVisible({ timeout: timeoutMs }).catch(() => false)) {
    const startOver = page.getByRole("button", { name: /^start over$/i });
    if (await startOver.isVisible({ timeout: 800 }).catch(() => false)) {
      await startOver.click({ timeout: 3_000 }).catch(() => undefined);
    }
    throw new AutomationTechnicalError(
      "LOAD_ERROR",
      'Uber exibiu "Request failed" / Unable to process this request - tente novamente',
    );
  }
}

/**
 * Modal "Is this you?" / "We found an existing account linked to the mobile".
 * O telefone é sempre placeholder (555-01XX) - NÃO é a conta do motorista
 * que estamos cadastrando. Clicar "Yes, It's me" entraria na conta de
 * outra pessoa (ex: "Better", "Ryan"). Sempre "No, this is not me".
 *
 * O modal às vezes demora vários segundos após o Next do telefone - por
 * isso o timeout de detecção é generoso e o clique aceita botão OU texto
 * (a UI nem sempre expõe role=button).
 */
async function dismissExistingMobileAccountIfPresent(page: Page, timeout: number): Promise<boolean> {
  const prompt = page
    .getByRole("heading", { name: /is this you/i })
    .or(page.getByText(/existing account linked to the mobile/i))
    .or(page.getByText(/is this you\?/i));

  if (!(await prompt.first().isVisible({ timeout: Math.max(timeout, 8_000) }).catch(() => false))) {
    return false;
  }

  const decline = page
    .getByRole("button", { name: /no,?\s*this is not me/i })
    .or(page.getByText(/no,?\s*this is not me/i));

  await decline.first().click({ timeout }).catch(async () => {
    await page.locator("text=/no,?\\s*this is not me/i").last().click({ timeout, force: true });
  });

  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
  await prompt
    .first()
    .waitFor({ state: "hidden", timeout })
    .catch(() => undefined);
  return true;
}

function smsOtpLocator(page: Page) {
  return page
    .getByRole("heading", { name: /sent via sms|c[oó]digo.*(sms|texto)|code sent via sms/i })
    .or(page.getByText(/sent via sms at/i))
    .or(page.getByRole("button", { name: /resend code via sms|call me with code/i }));
}

async function isSmsOtpScreen(page: Page): Promise<boolean> {
  return smsOtpLocator(page).first().isVisible({ timeout: 800 }).catch(() => false);
}

function phoneEntryInput(page: Page) {
  // NÃO usar aria-label*="phone": casa com "Enter phone number or email"
  // (tela de identifier), e aí o placeholder vira e-mail com dígitos.
  return page
    .locator(
      [
        'input[type="tel"]',
        'input[autocomplete="tel"]',
        'input[autocomplete="tel-national"]',
        'input[placeholder*="+1"]',
        'input[inputmode="tel"]',
      ].join(", "),
    )
    .filter({
      hasNot: page.locator(
        '[autocomplete="one-time-code"], [id*="OTP" i], [maxlength="1"], [id*="EMAIL" i], [name="email"]',
      ),
    })
    .first();
}

/** Tela dedicada de celular (não "phone number or email" do identifier). */
function mobileNumberHeading(page: Page) {
  return page
    .getByRole("heading", {
      name: /enter your mobile number|what'?s your mobile|n[uú]mero.*(celular|telefone)|mobile number/i,
    })
    .filter({ hasNotText: /email|e-?mail/i });
}

async function isPhoneEntryScreen(page: Page): Promise<boolean> {
  if (await isSmsOtpScreen(page)) return false;
  if (await mobileNumberHeading(page).first().isVisible({ timeout: 800 }).catch(() => false)) {
    return true;
  }
  return phoneEntryInput(page).isVisible({ timeout: 800 }).catch(() => false);
}

/**
 * Sai da tela de OTP SMS e volta à etapa de telefone para tentar OUTRO
 * placeholder. NÃO navega para drivers.uber.com no meio do signup: pelo
 * proxy isso costuma dar ERR_TIMED_OUT / tela branca e derruba a sessão.
 *
 * Ordem: link "Changed number" → history.back → botão Back (evitar Next) →
 * reload leve. Se nada restaurar o form de telefone, lança erro para o
 * caller emitir PHONE_SMS_RETRY (reinício completo com outro número).
 */
async function restartPhoneEntryAfterSms(
  page: Page,
  config: { timeouts: { pageLoad: number; elementWait: number }; driversBaseUrl: string },
): Promise<void> {
  const { timeouts } = config;

  const changeNumber = page.getByText(
    /changed your mobile number|alterou.*n[uú]mero|change.*(phone|mobile|number)/i,
  );
  if (await changeNumber.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
    await changeNumber.first().click({ timeout: timeouts.elementWait }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: timeouts.pageLoad }).catch(() => undefined);
    if (await isPhoneEntryScreen(page)) return;
  }

  for (let i = 0; i < 5; i++) {
    if (await isPhoneEntryScreen(page)) return;
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

  for (let i = 0; i < 4; i++) {
    if (await isPhoneEntryScreen(page)) return;
    // Evita clicar no Next: pega botão circular de voltar (sem texto "Next").
    const back = page
      .getByRole("button", { name: /^(back|voltar|previous)$/i })
      .or(page.locator('[aria-label*="back" i], [aria-label*="voltar" i]'))
      .or(
        page
          .locator("button")
          .filter({ has: page.locator("svg") })
          .filter({ hasNotText: /next|continuar|continue|pr[oó]ximo|resend|call me/i }),
      );
    await back.first().click({ timeout: 3_000 }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await page.waitForTimeout(500);
  }

  if (await isPhoneEntryScreen(page)) return;

  // Reload só da URL atual (auth), timeout curto - sem ir ao portal.
  await page
    .reload({ waitUntil: "domcontentloaded", timeout: 15_000 })
    .catch(() => undefined);
  await dismissExistingMobileAccountIfPresent(page, 2_000);
  if (await isPhoneEntryScreen(page)) return;

  if (await isSmsOtpScreen(page)) {
    for (let i = 0; i < 3; i++) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 8_000 }).catch(() => undefined);
      if (await isPhoneEntryScreen(page)) return;
    }
  }

  throw new Error(
    "Não foi possível voltar à tela de telefone após OTP SMS (sem reabrir o portal)",
  );
}

type AfterPhoneOutcome = "password" | "sms" | "unknown";

/**
 * Após Next do telefone: trata "Is this you?", detecta SMS (sem caixa
 * real não dá para ler) ou campo de senha.
 */
async function waitAfterPhoneSubmit(page: Page, timeout: number): Promise<AfterPhoneOutcome> {
  const passwordInput = page.locator('input[type="password"]').first();
  const deadline = Date.now() + Math.max(timeout, 20_000);

  while (Date.now() < deadline) {
    await failIfUberRequestFailed(page, 400);
    await dismissExistingMobileAccountIfPresent(page, 2_500);
    if (await passwordInput.isVisible({ timeout: 400 }).catch(() => false)) {
      return "password";
    }
    if (await isSmsOtpScreen(page)) {
      return "sms";
    }
    await page.waitForTimeout(400);
  }

  await failIfUberRequestFailed(page, 500);
  if (await passwordInput.isVisible({ timeout: 500 }).catch(() => false)) return "password";
  if (await isSmsOtpScreen(page)) return "sms";
  return "unknown";
}

/** Quantas vezes tenta outro placeholder na MESMA sessão (Back / change number). */
/** SMS ruim → troca número; na 2ª recusa → PHONE_SMS_RETRY (Bull retenta; não rotaciona FP). */
const PHONE_PLACEHOLDER_IN_SESSION_ATTEMPTS = 2;

/**
 * Passo 1: abre o cadastro Delivery pelo caminho de marketing.
 *
 * 1) Primário: www.uber.com → cookies → Menu → Earn → Deliver → CTA signup.
 * 2) Se falhar → deep link `/us/en/deliver/` + CTA.
 * 3) Se ainda falhar → fallback `drivers.uber.com`.
 * 4) Se ambos falharem → LOAD_ERROR (worker rotaciona sessão/proxy).
 */
export async function openDriversPortal(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  let earnError: string | undefined;

  try {
    await enterViaEarnDelivery(ctx);
  } catch (error) {
    earnError = error instanceof Error ? error.message.slice(0, 240) : String(error);
    await ctx.recordStep("PORTAL_EARN_NAV_FAILED", {
      error: earnError,
      url: page.url(),
    });
  }

  const onChromeError = /chrome-error:|chromewebdata/i.test(page.url());
  if (!earnError && !onChromeError && (await looksLikeDriverSignupEntry(page))) {
    // enterViaEarnDelivery já registra PORTAL_OPENED via=earn_delivery
    return;
  }

  await ctx.recordStep("PORTAL_WRONG_FLOW", {
    url: page.url(),
    earnError,
    next: "drivers_uber_com_fallback",
  });

  try {
    await page.goto(config.driversBaseUrl, {
      timeout: Math.max(config.timeouts.pageLoad, 45_000),
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    throw new AutomationTechnicalError(
      "LOAD_ERROR",
      `Earn→Delivery e drivers.uber.com falharam (rede/proxy): ${
        error instanceof Error ? error.message.slice(0, 160) : String(error)
      }`,
    );
  }

  if (/chrome-error:|chromewebdata/i.test(page.url()) || !(await looksLikeDriverSignupEntry(page))) {
    throw new AutomationTechnicalError(
      "LOAD_ERROR",
      "Portal de signup não carregou após Earn→Delivery nem drivers.uber.com (chrome-error/proxy)",
    );
  }

  await ctx.recordStep("PORTAL_OPENED", { via: "drivers.uber.com", fallback: true });
}

/** Sinais de que estamos no FORM de cadastro driver/delivery (não marketing). */
async function looksLikeDriverSignupEntry(page: Page): Promise<boolean> {
  const url = page.url();

  // Fluxos tipicamente de passageiro / pedido — não serve.
  if (/riders\.uber\.com|m\.uber\.com|\/ride\/|\/go\b|eats\.uber\.com\/order/i.test(url)) {
    return false;
  }

  // Landing marketing (www.uber.com/…/deliver|drive) NÃO é o form — o texto
  // "Sign up to deliver" na página gerava falso positivo.
  if (/www\.uber\.com/i.test(url) && !/\/a\/signup/i.test(url)) {
    return false;
  }

  const authForm = page
    .getByRole("heading", {
      name: /enter your mobile number|phone number or email|what'?s your phone|what'?s your email|create your account/i,
    })
    .or(page.getByRole("button", { name: /continue with email|continuar com (o )?e-?mail/i }))
    .or(
      page.locator(
        [
          'input[type="email"]',
          'input[type="tel"]',
          'input[autocomplete="tel"]',
          'input[autocomplete="email"]',
          'input[placeholder*="phone number or email" i]',
          'input[placeholder*="email" i]',
          'input[placeholder*="+1" i]',
        ].join(", "),
      ),
    );

  if (await authForm.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    return true;
  }

  // Portal / auth ainda redirecionando — espera curta pelo form.
  if (/auth\.uber\.com|drivers\.uber\.com|bonjour\.uber\.com|\/a\/signup/i.test(url)) {
    await page.waitForTimeout(1_500);
    if (await authForm.first().isVisible({ timeout: 4_000 }).catch(() => false)) {
      return true;
    }
    // Em drivers/auth sem form ainda: trata como entrada válida (load em curso).
    return /auth\.uber\.com|drivers\.uber\.com/i.test(page.url());
  }

  return false;
}

/** Após CTA: espera auth/drivers; se o clique não navegou, faz goto no href. */
async function settleSignupNavigation(
  page: Page,
  href: string,
  timeoutMs: number,
): Promise<boolean> {
  const signupUrl = /auth\.uber\.com|drivers\.uber\.com|bonjour\.uber\.com|\/a\/signup/i;
  try {
    await page.waitForURL(signupUrl, { timeout: Math.min(timeoutMs, 25_000) });
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
    return true;
  } catch {
    // clique não navegou (overlay / SPA)
  }

  const absolute = href.startsWith("http")
    ? href
    : href.startsWith("/")
      ? `https://www.uber.com${href}`
      : "";
  if (absolute && /drivers\.uber\.com|auth\.uber\.com|\/a\/signup/i.test(absolute)) {
    try {
      await page.goto(absolute, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
      await page.waitForURL(signupUrl, { timeout: 15_000 }).catch(() => undefined);
      return signupUrl.test(page.url()) || (await looksLikeDriverSignupEntry(page));
    } catch {
      return false;
    }
  }
  return signupUrl.test(page.url());
}

/**
 * Entrada tela a tela (mobile real, Jul/2026):
 * 1) www.uber.com/us/en/ + dismiss cookies
 * 2) Menu → Earn (Earn NÃO está no header mobile)
 * 3) Deliver (dropdown/link /…/deliver/) — evita ficar em Drive
 * 4) CTA "Sign up to deliver" / "Get started" → drivers.uber.com
 * 5) Se Earn falhar → deep link deliverLandingUrl + mesmo CTA
 */
async function enterViaEarnDelivery(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  const { timeouts } = config;

  // --- Tela 1: uber.com ---
  await page.goto(config.marketingBaseUrl, {
    timeout: timeouts.pageLoad,
    waitUntil: "domcontentloaded",
  });
  await ctx.human.pause(1_000, 2_200);
  await dismissCookieBannerIfPresent(page, timeouts.elementWait);
  await ctx.human.pause(400, 900);
  await ctx.recordStep("PORTAL_SCREEN_UBER_HOME", { url: page.url() });

  // --- Tela 2: Menu → Earn (mobile: Earn só no hamburger) ---
  const entry = await openEarnFromMobileMenu(ctx);
  if (entry === "earn" || entry === "deliver") {
    await page.waitForLoadState("domcontentloaded", { timeout: timeouts.pageLoad }).catch(() => undefined);
    await dismissCookieBannerIfPresent(page, timeouts.elementWait);
    await ctx.recordStep(
      entry === "earn" ? "PORTAL_SCREEN_EARN_OPENED" : "PORTAL_SCREEN_DELIVER_FROM_HOME",
      { url: page.url() },
    );

    if (await looksLikeDriverSignupEntry(page)) {
      await ctx.recordStep("PORTAL_OPENED", {
        via: entry === "earn" ? "earn_direct_signup" : "deliver_direct_signup",
        url: page.url(),
      });
      return;
    }

    // --- Tela 3: Deliver após Earn/Drive (se ainda não em Deliver) ---
    if (entry === "earn" || !/\/deliver\/?/i.test(page.url())) {
      const afterEarn = await decideClickAfterEarn(ctx);
      await ctx.recordStep("PORTAL_AFTER_EARN_DECISION", afterEarn);
      if (afterEarn.clicked) {
        await page.waitForLoadState("domcontentloaded", { timeout: timeouts.pageLoad }).catch(() => undefined);
        await dismissCookieBannerIfPresent(page, timeouts.elementWait);
        await ctx.human.pause(700, 1_600);
      }
    }
  } else {
    await ctx.recordStep("PORTAL_EARN_SKIPPED_TO_DELIVER", {
      reason: "earn_not_visible_after_menu",
      url: page.url(),
    });
  }

  // --- Tela 4: CTA signup Delivery ---
  if (!(await looksLikeDriverSignupEntry(page))) {
    const cta = await clickDeliverSignupCta(ctx);
    if (cta.clicked) {
      await page.waitForLoadState("domcontentloaded", { timeout: timeouts.pageLoad }).catch(() => undefined);
      await ctx.human.pause(800, 2_000);
      await ctx.recordStep("PORTAL_SCREEN_SIGNUP_CTA", { ...cta, url: page.url() });
    }
  }

  // --- Fallback: landing /deliver/ conhecida ---
  if (!(await looksLikeDriverSignupEntry(page))) {
    await page.goto(config.deliverLandingUrl, {
      timeout: timeouts.pageLoad,
      waitUntil: "domcontentloaded",
    });
    await ctx.human.pause(700, 1_500);
    await dismissCookieBannerIfPresent(page, timeouts.elementWait);
    await ctx.recordStep("PORTAL_SCREEN_DELIVER_LANDING", { url: page.url() });

    const cta2 = await clickDeliverSignupCta(ctx);
    if (cta2.clicked) {
      await page.waitForLoadState("domcontentloaded", { timeout: timeouts.pageLoad }).catch(() => undefined);
      await ctx.human.pause(800, 2_000);
      await ctx.recordStep("PORTAL_SCREEN_SIGNUP_CTA", { ...cta2, via: "deliver_landing", url: page.url() });
    }
  }

  await ctx.recordStep("PORTAL_OPENED", {
    via: entry === "earn" ? "menu_earn_deliver" : entry === "deliver" ? "home_deliver" : "deliver_landing",
    url: page.url(),
  });
}

/** Abre hamburger mobile e clica Earn visível (ignora links ocultos no DOM). */
async function openEarnFromMobileMenu(
  ctx: RealStepContext,
): Promise<"earn" | "deliver" | false> {
  const { page, config } = ctx;
  const { timeouts } = config;

  const menuToggle = page
    .getByRole("button", { name: /^(menu|open navigation|abrir menu)$/i })
    .or(page.locator('button[aria-label="Menu"], button[aria-label*="menu" i]'))
    .first();

  // No mobile Earn quase nunca está no header — abrir menu primeiro.
  if (await menuToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await ctx.human.clickSafe(menuToggle, { timeout: timeouts.elementWait });
    await ctx.human.pause(500, 1_200);
    await dismissCookieBannerIfPresent(page, timeouts.elementWait);
  }

  const earnCandidates = page
    .getByRole("link", { name: /^earn$/i })
    .or(page.getByRole("menuitem", { name: /^earn$/i }))
    .or(page.locator('a[aria-label="Earn"], a[aria-label*="Earn" i]'));

  const n = await earnCandidates.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 8); i++) {
    const el = earnCandidates.nth(i);
    if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const href = ((await el.getAttribute("href").catch(() => null)) || "").toLowerCase();
    // Preferir marketing /drive|/deliver; aceitar drivers.uber.com se for o único visível.
    if (/m\.uber\.com|\/ride|eats\.uber\.com\/order/.test(href)) continue;
    await ctx.human.clickSafe(el, { timeout: timeouts.elementWait });
    await ctx.human.pause(800, 1_800);
    return "earn";
  }

  // Sem Earn no menu: tenta Deliver direto na home (footer/nav).
  const deliverHome = page
    .getByRole("link", { name: /^(deliver|delivery)$/i })
    .or(page.locator('a[href*="/deliver"]'))
    .filter({ hasNotText: /drive with|^drive$/i });
  const dn = await deliverHome.count().catch(() => 0);
  for (let i = 0; i < Math.min(dn, 6); i++) {
    const el = deliverHome.nth(i);
    if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const href = ((await el.getAttribute("href").catch(() => null)) || "").trim();
    await ctx.human.clickSafe(el, { timeout: timeouts.elementWait });
    await ctx.human.pause(600, 1_400);
    try {
      await page.waitForURL(/\/deliver\/?/i, { timeout: 12_000 });
    } catch {
      if (href && /\/deliver/i.test(href)) {
        const absolute = href.startsWith("http") ? href : `https://www.uber.com${href}`;
        await page.goto(absolute, { timeout: timeouts.pageLoad, waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
    }
    await dismissCookieBannerIfPresent(page, timeouts.elementWait);
    if (/\/deliver\/?/i.test(page.url())) return "deliver";
  }

  return false;
}

/**
 * CTA da landing Deliver: "Sign up to deliver" > links drivers/auth >
 * "Get started" só em /deliver/.
 */
async function clickDeliverSignupCta(
  ctx: RealStepContext,
): Promise<{ clicked: boolean; mode: string; label?: string; href?: string }> {
  const { page, config } = ctx;
  const { timeouts } = config;

  await dismissCookieBannerIfPresent(page, timeouts.elementWait);

  const onDeliverLanding = /\/deliver\/?/i.test(page.url());

  const priority = [
    page.getByRole("link", { name: /sign up to deliver|apply to deliver|deliver with uber/i }),
    page.getByRole("button", { name: /sign up to deliver|apply to deliver|deliver with uber/i }),
    page.locator('a[href*="drivers.uber.com"], a[href*="auth.uber.com"], a[href*="/a/signup"]')
      .filter({ hasText: /sign up|get started|deliver/i }),
    page.locator(
      'a[aria-label*="Sign up to deliver" i], a[aria-label*="Get started" i][href*="drivers.uber.com"]',
    ),
    // Get started genérico só na landing Deliver (na home é Drive).
    ...(onDeliverLanding
      ? [
          page.getByRole("link", { name: /^(get started)$/i }),
          page.getByRole("button", { name: /^(get started)$/i }),
        ]
      : []),
  ];

  type Candidate = { el: ReturnType<Page["locator"]>; label: string; href: string; aria: string; score: number };
  const scored: Candidate[] = [];

  for (const loc of priority) {
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 8); i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
      const label = ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      const href = ((await el.getAttribute("href").catch(() => null)) || "").trim();
      const aria = ((await el.getAttribute("aria-label").catch(() => null)) || "").trim();
      const blob = `${label} ${href} ${aria}`.toLowerCase();
      if (/business|for business/.test(blob)) continue;
      if (/^drive with|^ride$/i.test(label)) continue;
      if (/get started/i.test(label) && /\/drive\/?$/i.test(href) && !/deliver/i.test(blob)) continue;

      let score = 0;
      if (/sign up to deliver|apply to deliver/i.test(blob)) score += 100;
      if (/drivers\.uber\.com|auth\.uber\.com|\/a\/signup/i.test(href)) score += 80;
      if (/deliver/i.test(blob)) score += 40;
      if (/get started|sign up/i.test(blob)) score += 20;
      if (score <= 0) continue;
      scored.push({ el, label, href, aria, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return { clicked: false, mode: "no_signup_cta" };

  await ctx.human.pause(400, 1_000);
  await ctx.human.clickSafe(best.el, { timeout: timeouts.elementWait });
  let navigated = await settleSignupNavigation(page, best.href, timeouts.pageLoad);

  // /a/signup/drive/deliver/ às vezes cai em /s/c/deliver/ (ainda marketing).
  // Força o portal real em vez de depender só do fallback externo.
  if (!navigated && !(await looksLikeDriverSignupEntry(page))) {
    try {
      await page.goto(config.driversBaseUrl, {
        timeout: timeouts.pageLoad,
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/auth\.uber\.com|drivers\.uber\.com/i, { timeout: 20_000 }).catch(() => undefined);
      navigated = await looksLikeDriverSignupEntry(page);
    } catch {
      navigated = false;
    }
  }

  await dismissCookieBannerIfPresent(page, timeouts.elementWait);

  return {
    clicked: true,
    mode: navigated ? "deliver_signup_cta" : "deliver_signup_cta_no_nav",
    label: (best.label || best.aria).slice(0, 100),
    href: best.href.slice(0, 160),
  };
}

/**
 * Depois de Earn: prioriza Deliver (/deliver/); se já houver CTA de signup
 * Delivery, clica nele. Evita ficar em Drive / rides.
 */
async function decideClickAfterEarn(
  ctx: RealStepContext,
): Promise<{ clicked: boolean; mode: string; label?: string; href?: string }> {
  const { page, config } = ctx;
  const { timeouts } = config;

  await dismissCookieBannerIfPresent(page, timeouts.elementWait);

  // Signup CTA só faz sentido em /deliver/ (ou /drive/ com link deliver).
  // Na home, "Get started" é Drive — não clicar aqui.
  if (/\/deliver\/?/i.test(page.url()) || /\/drive\/?/i.test(page.url())) {
    const signupNow = await clickDeliverSignupCta(ctx);
    if (signupNow.clicked) return signupNow;
  }

  // Nav/dropdown Deliver (ex.: chevron "Drive" → Deliver, ou link /deliver/).
  const classicDeliver = page
    .getByRole("link", { name: /^(deliver|delivery|deliver with uber)$/i })
    .or(page.getByRole("menuitem", { name: /^(deliver|delivery)$/i }))
    .or(page.getByRole("button", { name: /^(deliver|delivery)$/i }))
    .or(page.locator('a[href*="/deliver"]'))
    .filter({ hasNotText: /drive with|^drive$|ride|sign in|sign up/i });

  const dn = await classicDeliver.count().catch(() => 0);
  for (let i = 0; i < Math.min(dn, 8); i++) {
    const el = classicDeliver.nth(i);
    if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const href = ((await el.getAttribute("href").catch(() => null)) || "").toLowerCase();
    const label = ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (/eats\.uber\.com\/order|\/ride/.test(href)) continue;
    await ctx.human.clickSafe(el, { timeout: timeouts.elementWait });
    return { clicked: true, mode: "classic_delivery", label: label.slice(0, 80) || "Deliver", href };
  }

  // Já em /deliver/? não precisa navegar de novo.
  if (/\/deliver\/?/i.test(page.url())) {
    return { clicked: false, mode: "already_on_deliver" };
  }

  // Deep link Deliver (mesmo locale da URL atual se possível).
  const localeMatch = page.url().match(/uber\.com\/([a-z]{2})\/([a-z]{2}(?:-[a-z]+)?)\//i);
  const deliverUrl = localeMatch
    ? `https://www.uber.com/${localeMatch[1]}/${localeMatch[2]}/deliver/`
    : config.deliverLandingUrl;
  await page.goto(deliverUrl, {
    timeout: timeouts.pageLoad,
    waitUntil: "domcontentloaded",
  });
  await ctx.human.pause(600, 1_400);
  await dismissCookieBannerIfPresent(page, timeouts.elementWait);
  return { clicked: true, mode: "goto_deliver_url", href: deliverUrl };
}


/**
 * Passo 2 (PDF): tela "Qual é o seu número de telefone ou e-mail?" /
 * "What's your phone number or email?" - a tela inicial pode aparecer em
 * PT-BR ou EN dependendo do IP/proxy, por isso o botão é localizado por
 * texto EXATO ("Continuar"/"Continue"/"Next →"), não por substring solta -
 * senão bateria também em "Continuar com o Google"/"Continuar com a Apple".
 *
 * Nunca preencher via `input[type="tel"]` primeiro: em campos tel o
 * Playwright/browser descartam não-dígitos, e um e-mail como
 * `galldelivery@mail2too.com` vira só `2` → Uber mostra "+1 2" /
 * "This phone number is invalid" e nunca envia o código OTP.
 */
export async function fillIdentifierStep(ctx: RealStepContext): Promise<void> {
  const { page, context } = ctx;
  try {
    await fillIdentifierFields(ctx);
  } catch (firstError) {
    // Request failed / CAPTCHA / LOAD_ERROR etc. NÃO são "fluxo errado" —
    // propagar para o worker rotacionar sessão. Retry Earn só quando o form
    // de identifier realmente não apareceu.
    if (
      firstError instanceof AutomationPauseSignal ||
      firstError instanceof AutomationTechnicalError ||
      context.uberAccountCreated
    ) {
      throw firstError;
    }

    await ctx.recordStep("IDENTIFIER_WRONG_FLOW_RETRY_EARN_DELIVERY", {
      url: page.url(),
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });
    try {
      await enterViaEarnDelivery(ctx);
      await fillIdentifierFields(ctx);
    } catch (retryError) {
      if (
        retryError instanceof AutomationPauseSignal ||
        retryError instanceof AutomationTechnicalError
      ) {
        throw retryError;
      }
      throw toTechnicalError(
        firstError,
        "ELEMENT_NOT_FOUND",
        "Falha ao preencher e-mail/telefone inicial (Earn→Delivery também falhou)",
      );
    }
  }
  await ctx.recordStep("IDENTIFIER_SUBMITTED");
}

async function fillIdentifierFields(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  // Variante phone-first: existe botão explícito para modo e-mail.
  const emailModeButton = page.getByRole("button", {
    name: /continue with email|continuar com (o )?e-?mail/i,
  });
  if (await emailModeButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await ctx.human.clickSafe(emailModeButton, { timeout: config.timeouts.elementWait });
    await ctx.human.pause(400, 1_200);
  }

  const emailInput = page
    .locator(
      [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[inputmode="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="e-mail" i]',
        'input[placeholder*="phone number or email" i]',
        'input[placeholder*="telefone ou" i]',
        'input[type="text"]:not([inputmode="tel"]):not([inputmode="numeric"])',
      ].join(", "),
    )
    .first();
  await emailInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
  // Digitação humanizada preserva '@' mesmo se o campo oscilar para modo tel.
  await ctx.human.type(emailInput, context.applicantData.email, {
    timeout: config.timeouts.elementWait,
    delayMs: { min: 35, max: 120 },
  });

  const typed = await emailInput.inputValue();
  if (!typed.includes("@")) {
    await emailInput.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      proto?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, context.applicantData.email);
  }

  const confirmed = await emailInput.inputValue();
  if (!confirmed.includes("@")) {
    throw new Error(
      `Campo de identifier não aceitou o e-mail (valor atual: "${confirmed}"). Evite type=tel.`,
    );
  }

  // Janela IMAP: poucos segundos de skew, sem puxar OTP da tentativa anterior
  // (rotação PHONE_SMS_RETRY deixa códigos antigos na caixa catch-all).
  ctx.emailCodeRequestedAt = new Date(Date.now() - 5_000);

  await ctx.human.pause(700, 1_800);
  await clickPrimaryNext(ctx, config.timeouts.elementWait);
  await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  await ctx.human.pause(800, 2_200);
  await failIfUberRequestFailed(page);
  // Puzzle pode aparecer logo após o Continue do e-mail (timeout generoso).
  await pauseIfUberSecurityPuzzle(page, 4_000);
}

/**
 * Passo 3 (PDF): "Enter the 4-digit code sent to you at: [email]" - 4 caixas
 * de 1 dígito cada, com auto-avanço de foco (padrão comum de OTP). Em vez
 * de tentar mirar cada caixa individualmente (seletor desconhecido), clica
 * na primeira e digita a sequência inteira via teclado - o auto-avanço da
 * própria página cuida do resto.
 */
export async function fillEmailCodeStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config, emailWorker } = ctx;

  // Conta existente / login: Uber manda SMS no telefone do cadastro (ex: *03),
  // NÃO e-mail. Esperar IMAP aqui gasta 90s e falha com 0 mensagens.
  if (await isSmsOtpScreen(page)) {
    if (context.uberAccountCreated) {
      throw new AutomationPauseSignal("SECURITY_BLOCK", {
        type: "SECURITY_BLOCK",
        provider: "UBER_SMS_OTP",
        confidence: "HIGH",
      });
    }
    throw new AutomationTechnicalError(
      "PHONE_SMS_RETRY",
      "Uber pediu OTP por SMS (não e-mail) após o identifier — reiniciando com outro número/sessão",
    );
  }

  // "Request failed" / CAPTCHA às vezes demoram alguns segundos após o
  // Continue do identifier - se varrermos IMAP de imediato, gastamos 90s
  // e reportamos EMAIL_CODE_NOT_FOUND com a página já em erro.
  const otpUi = page
    .getByRole("heading", {
      name: /enter the .+ code|digite o c[oó]digo|4-digit code|verification code/i,
    })
    .or(
      page.locator(
        'input[autocomplete="one-time-code"], input[id*="OTP" i], input[maxlength="1"]',
      ),
    );

  const waitUntil = Date.now() + 12_000;
  while (Date.now() < waitUntil) {
    await failIfUberRequestFailed(page, 200);
    await pauseIfUberSecurityPuzzle(page, 500);
    if (await isSmsOtpScreen(page)) {
      if (context.uberAccountCreated) {
        throw new AutomationPauseSignal("SECURITY_BLOCK", {
          type: "SECURITY_BLOCK",
          provider: "UBER_SMS_OTP",
          confidence: "HIGH",
        });
      }
      throw new AutomationTechnicalError(
        "PHONE_SMS_RETRY",
        "Uber pediu OTP por SMS (não e-mail) após o identifier — reiniciando com outro número/sessão",
      );
    }
    if (await otpUi.first().isVisible({ timeout: 400 }).catch(() => false)) {
      break;
    }
    await page.waitForTimeout(700);
  }
  await failIfUberRequestFailed(page, 800);
  await pauseIfUberSecurityPuzzle(page, 2_500);

  if (await isSmsOtpScreen(page)) {
    throw new AutomationTechnicalError(
      "PHONE_SMS_RETRY",
      "Tela de SMS OTP detectada antes do IMAP — não é código de e-mail",
    );
  }

  // Sem UI de OTP e-mail → NÃO varrer IMAP (Uber não enviou / Arkose no caminho).
  const otpVisible = await otpUi.first().isVisible({ timeout: 2_000 }).catch(() => false);
  if (!otpVisible) {
    await pauseIfUberSecurityPuzzle(page, 2_000);
    throw new AutomationTechnicalError(
      "EMAIL_CODE_RETRY",
      "Tela de código de e-mail não apareceu após identifier — rotacionando sessão (possível anti-bot)",
    );
  }

  // IMAP pode zerar com a tela OTP ainda aberta (Uber não enviou / catch-all
  // atrasou). Clica Resend e repoll; se ainda falhar → EMAIL_CODE_RETRY
  // (worker rotaciona sessão/fingerprint). Puzzle Arkose no meio → pausa
  // imediata (não gasta o timeout IMAP inteiro).
  const maxImapRounds = 3; // 1 poll inicial + até 2 após Resend
  let code: string | undefined;
  let lastImapMiss: string | undefined;

  for (let imapRound = 0; imapRound < maxImapRounds; imapRound++) {
    if (imapRound > 0) {
      await failIfUberRequestFailed(page, 800);
      await pauseIfUberSecurityPuzzle(page, 800);
      const stillOnOtp = await otpUi.first().isVisible({ timeout: 1_500 }).catch(() => false);
      if (!stillOnOtp) {
        break;
      }
      const resend = page.getByRole("button", { name: /^resend$/i });
      if (!(await resend.isVisible({ timeout: 3_000 }).catch(() => false))) {
        throw new AutomationTechnicalError(
          "EMAIL_CODE_RETRY",
          "IMAP sem código e botão Resend indisponível — rotacionando sessão",
        );
      }
      await ctx.human.clickSafe(resend, { timeout: config.timeouts.elementWait });
      ctx.emailCodeRequestedAt = new Date();
      await ctx.recordStep("EMAIL_CODE_RESEND", { round: imapRound });
      await ctx.human.pause(1_800, 3_400);
      await failIfUberRequestFailed(page, 1_500);
      await pauseIfUberSecurityPuzzle(page, 1_000);
    }

    try {
      const requestedAt = ctx.emailCodeRequestedAt ?? new Date(Date.now() - 5_000);
      const pollBudget = config.timeouts.emailCodePollTimeoutMs;
      const pollInterval = config.timeouts.emailCodePollIntervalMs;
      const deadline = Date.now() + pollBudget;
      let found: { code: string; confidence: string } | undefined;

      // Fatias ~12s: entre cada uma revalida Arkose (early-stop).
      while (Date.now() < deadline) {
        await pauseIfUberSecurityPuzzle(page, 400);
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const slice = Math.min(IMAP_POLL_CHUNK_MS, remaining);
        try {
          found = await emailWorker.findVerificationCode({
            applicantId: context.applicantId,
            emailAccountId: context.emailAccountId,
            proxyId: context.proxyId,
            requestedAt,
            expectedSender: "noreply@uber.com",
            pollTimeoutMs: slice,
            pollIntervalMs: pollInterval,
            usedCodes: ctx.usedEmailCodes ? [...ctx.usedEmailCodes] : undefined,
          });
          // Cinto: extrator já descarta LOW; se ainda vier, não digita.
          if (found && String(found.confidence).toUpperCase() === "LOW") {
            await ctx.recordStep("EMAIL_CODE_LOW_CONFIDENCE_SKIPPED", {
              maskedValue: maskCode(found.code),
              confidence: found.confidence,
            });
            found = undefined;
            lastImapMiss = "Código IMAP com confiança LOW ignorado (catch-all)";
            await pauseIfUberSecurityPuzzle(page, 400);
            continue;
          }
          break;
        } catch (chunkError) {
          if (chunkError instanceof VerificationCodeNotFoundError) {
            lastImapMiss = chunkError.message;
            await pauseIfUberSecurityPuzzle(page, 400);
            continue;
          }
          throw chunkError;
        }
      }

      if (found) {
        code = found.code;
        break;
      }

      lastImapMiss =
        lastImapMiss ??
        `Nenhum código de verificação elegível foi encontrado após varredura IMAP (${pollBudget}ms)`;
    } catch (error) {
      if (error instanceof SecurityChallengeError) {
        // PHONE_VERIFICATION e AUTOMATION_BLOCKED (Google recusando o login
        // por detectar navegador automatizado) não têm um valor equivalente
        // em NonRetryableReason - caem no bucket genérico SECURITY_BLOCK, já
        // existente e exibido como "Bloqueio de segurança" no painel.
        const reason =
          error.challenge === "PHONE_VERIFICATION" || error.challenge === "AUTOMATION_BLOCKED"
            ? "SECURITY_BLOCK"
            : error.challenge;
        throw new AutomationPauseSignal(reason);
      }
      if (error instanceof VerificationCodeNotFoundError) {
        lastImapMiss = error.message;
        continue;
      }
      if (error instanceof AutomationPauseSignal) throw error;
      throw toTechnicalError(error, "EMAIL_CODE_RETRIEVAL_FAILED", "Falha ao buscar código de e-mail");
    }
  }

  if (!code) {
    throw new AutomationTechnicalError(
      "EMAIL_CODE_RETRY",
      lastImapMiss ??
        "IMAP sem código de e-mail após Resend na tela OTP — rotacionando sessão",
    );
  }

  await ctx.recordStep("CODE_RETRIEVED", { maskedValue: maskCode(code) });

  try {
    const used = ctx.usedEmailCodes ?? new Set<string>();
    ctx.usedEmailCodes = used;

    const maxOtpAttempts = 3;
    for (let otpAttempt = 0; otpAttempt < maxOtpAttempts; otpAttempt++) {
      if (otpAttempt > 0) {
        // Código rejeitado → Resend e busca OTP novo (exclui os já tentados).
        const resend = page.getByRole("button", { name: /^resend$/i });
        if (await resend.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await ctx.human.clickSafe(resend, { timeout: config.timeouts.elementWait });
          ctx.emailCodeRequestedAt = new Date();
          await ctx.human.pause(1_500, 2_800);
        } else {
          throw new Error('Uber rejeitou o passcode e o botão "Resend" não apareceu');
        }

        const next = await emailWorker.findVerificationCode({
          applicantId: context.applicantId,
          emailAccountId: context.emailAccountId,
          proxyId: context.proxyId,
          requestedAt: ctx.emailCodeRequestedAt ?? new Date(),
          expectedSender: "noreply@uber.com",
          pollTimeoutMs: config.timeouts.emailCodePollTimeoutMs,
          pollIntervalMs: config.timeouts.emailCodePollIntervalMs,
          usedCodes: [...used],
        });
        if (String(next.confidence).toUpperCase() === "LOW") {
          await ctx.recordStep("EMAIL_CODE_LOW_CONFIDENCE_SKIPPED", {
            maskedValue: maskCode(next.code),
            confidence: next.confidence,
            resendAttempt: otpAttempt,
          });
          throw new VerificationCodeNotFoundError(
            "Código IMAP com confiança LOW ignorado após Resend (catch-all)",
          );
        }
        code = next.code;
        await ctx.recordStep("CODE_RETRIEVED", {
          maskedValue: maskCode(code),
          resendAttempt: otpAttempt,
        });
      }

      used.add(code);

      const otpBoxes = page.locator(
        'input[autocomplete="one-time-code"], input[id*="OTP" i], input[maxlength="1"], input[inputmode="numeric"]',
      );
      const firstBox = otpBoxes.first();
      await firstBox.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
      // Limpa caixas (estado de erro deixa vermelho/vazio às vezes com resto).
      const boxCount = await otpBoxes.count().catch(() => 0);
      for (let i = 0; i < Math.min(boxCount, 8); i++) {
        await otpBoxes.nth(i).fill("").catch(() => undefined);
      }
      await ctx.human.clickSafe(firstBox, { timeout: config.timeouts.elementWait });
      await ctx.human.typeOtp(code);

      const nextButton = page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first();
      if (await nextButton.isEnabled().catch(() => false)) {
        await ctx.human.clickSafe(nextButton, { timeout: config.timeouts.elementWait });
      }

    // Espera sair da tela OTP antes do passo de telefone - sem isso o
    // fillPhoneStep acabava preenchendo EMAIL_OTP_CODE-* (disabled).
      const phoneUi = page
        .getByRole("heading", {
          name: /enter your mobile number|what'?s your mobile|n[uú]mero.*(celular|telefone)|mobile number/i,
        })
        .filter({ hasNotText: /email|e-?mail/i })
        .or(page.locator('input[type="tel"], input[autocomplete="tel"], input[placeholder*="+1"]'));

      const leftOtp = await phoneUi
        .first()
        .waitFor({ state: "visible", timeout: config.timeouts.pageLoad })
        .then(() => true)
        .catch(() => false);

      if (leftOtp) {
        await ctx.recordStep("EMAIL_VERIFIED");
        return;
      }

      const incorrect = page.getByText(/passcode.*(incorrect|inv[aá]lid)|c[oó]digo.*(incorreto|inv[aá]lido)|incorrect/i);
      if (await incorrect.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
        await ctx.recordStep("EMAIL_CODE_REJECTED", {
          attempt: otpAttempt + 1,
          maskedValue: maskCode(code),
        });
        continue;
      }

      // Ainda na tela OTP sem mensagem clara — trata como rejeição e tenta Resend.
      if (await otpUi.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
        await ctx.recordStep("EMAIL_CODE_STILL_ON_OTP", {
          attempt: otpAttempt + 1,
          url: page.url(),
        });
        continue;
      }

      // Saiu do OTP para outra tela (senha etc.) — ok.
      await ctx.recordStep("EMAIL_VERIFIED", { url: page.url() });
      return;
    }

    throw new Error(
      "Uber rejeitou o passcode de e-mail após várias tentativas (código IMAP incorreto/reusado)",
    );
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher código de verificação");
  }
}

/**
 * Passo 4 (PDF): "Enter your mobile number" - o país já vem em "US". O
 * número digitado é SEMPRE um placeholder (nunca o telefone real do
 * motorista) - o atendente corrige na finalização do cadastro.
 *
 * Alocação: próximo livre (hub **ou** SMS rejeitado na blacklist). SMS →
 * marca e tenta outro na sessão; 2 recusas → PHONE_SMS_RETRY (Bull retenta
 * o job com novos números — só pausa humana em Veriff/Socure).
 */
export async function fillPhoneStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  const offset = context.phoneAttemptOffset ?? 0;

  const refusePhoneProblem = (detail: string): never => {
    throw new AutomationTechnicalError("PHONE_SMS_RETRY", detail);
  };

  try {
    for (let attempt = 0; attempt < PHONE_PLACEHOLDER_IN_SESSION_ATTEMPTS; attempt++) {
      const phone = ctx.allocatePlaceholderPhone
        ? await ctx.allocatePlaceholderPhone()
        : buildPlaceholderPhone(context.applicantId, offset + attempt);

      // Modal "Request failed" / Start Over — não tentar clicar por baixo.
      await failIfUberRequestFailed(page, 1_500);

      await mobileNumberHeading(page)
        .or(page.locator('input[type="tel"], input[autocomplete="tel"], input[placeholder*="+1"]'))
        .first()
        .waitFor({ state: "visible", timeout: config.timeouts.elementWait });

      await failIfUberRequestFailed(page, 800);

      const phoneInput = phoneEntryInput(page);
      await phoneInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
      await ctx.human.type(phoneInput, phone.replace(/\D/g, "").slice(-10), {
        timeout: config.timeouts.elementWait,
        delayMs: { min: 40, max: 130 },
      });

      await clickPrimaryNext(ctx, config.timeouts.elementWait);
      await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });

      await failIfUberRequestFailed(page, 2_000);

      const outcome = await waitAfterPhoneSubmit(page, config.timeouts.elementWait);

      if (outcome === "password") {
        ctx.assignedPlaceholderPhone = phone;
        context.assignedPlaceholderPhone = phone;
        await ctx.recordStep("PHONE_SUBMITTED", {
          placeholder: true,
          attempt: offset + attempt,
          phoneLast4: phone.replace(/\D/g, "").slice(-4),
        });
        return;
      }

      if (outcome === "sms" || (await isSmsOtpScreen(page))) {
        // Número que pediu SMS não reutiliza em nenhum cadastro.
        await ctx.markPlaceholderPhoneUsed?.(phone, "sms_rejected").catch(() => undefined);
        const smsAttempt = attempt + 1;
        await ctx.recordStep("PHONE_SMS_REJECTED_RETRY", {
          attempt: offset + attempt,
          nextAttempt: offset + attempt + 1,
          inSession: smsAttempt < PHONE_PLACEHOLDER_IN_SESSION_ATTEMPTS,
          phoneLast4: phone.replace(/\D/g, "").slice(-4),
        });

        if (smsAttempt >= PHONE_PLACEHOLDER_IN_SESSION_ATTEMPTS) {
          await ctx.recordStep("PHONE_SMS_RETRY", {
            smsRejects: smsAttempt,
            phoneLast4: phone.replace(/\D/g, "").slice(-4),
          });
          refusePhoneProblem(
            `Problema celular: Uber pediu OTP SMS em ${smsAttempt} números — retentando job com outros números`,
          );
        }

        try {
          await restartPhoneEntryAfterSms(page, config);
        } catch {
          await ctx.recordStep("PHONE_SMS_RETRY", {
            smsRejects: smsAttempt,
            reason: "restart_phone_entry_failed",
            phoneLast4: phone.replace(/\D/g, "").slice(-4),
          });
          refusePhoneProblem(
            `Problema celular: não foi possível trocar o telefone após SMS (tentativa ${smsAttempt}) — retentando job`,
          );
        }
        continue;
      }

      if (!(await isPhoneEntryScreen(page))) {
        try {
          await restartPhoneEntryAfterSms(page, config);
        } catch {
          refusePhoneProblem(
            "Problema celular: tela de telefone sumiu após submit — recusado para tentar depois com outros números",
          );
        }
      }
    }

    refusePhoneProblem(
      "Problema celular: esgotou placeholders nesta sessão — recusado para tentar depois com outros números",
    );
  } catch (error) {
    if (error instanceof AutomationTechnicalError) throw error;
    if (error instanceof AutomationPauseSignal) throw error;
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher telefone placeholder");
  }
}

/**
 * Passo 5 (PDF): "Create your account password" - Sobrenome + sufixo fixo
 * (ex: "Silva@2026"), decisão explícita do operador. A senha nunca é
 * registrada em auditoria/logs.
 */
export async function fillPasswordStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  const password = buildPlaceholderPassword(context.applicantData.fullName, config.passwordSuffix);

  try {
    // fillPhoneStep já deve ter deixado a tela de senha; ainda trata modal
    // atrasado / SMS residual.
    const outcome = await waitAfterPhoneSubmit(page, config.timeouts.elementWait);
    if (outcome === "sms") {
      throw new AutomationTechnicalError(
        "PHONE_SMS_RETRY",
        "Problema celular: Uber pediu OTP SMS antes da senha — retentando com outros números",
      );
    }
    if (outcome !== "password") {
      throw new Error("Campo de senha não apareceu após o telefone");
    }

    const passwordInput = page.locator('input[type="password"]').first();
    await ctx.human.type(passwordInput, password, {
      timeout: config.timeouts.elementWait,
      delayMs: { min: 50, max: 150 },
    });
    // Validação client-side da Uber (length/digit) habilita o Next.
    const nextButton = page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first();
    await nextButton.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await page
      .waitForFunction(
        (sel) => {
          const btn = document.querySelector(sel);
          return btn instanceof HTMLButtonElement && !btn.disabled;
        },
        '[data-testid="forward-button"], #forward-button, button[type="submit"]',
        { timeout: config.timeouts.elementWait },
      )
      .catch(() => undefined);
    await ctx.human.clickSafe(nextButton, { timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    if (error instanceof AutomationTechnicalError) throw error;
    if (error instanceof AutomationPauseSignal) throw error;
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher senha");
  }
  await ctx.recordStep("PASSWORD_SUBMITTED");
}

/**
 * Passo 6 (PDF): formulário de nome/sobrenome ("What's your name?").
 * Uber exige first + last name - last vazio mostra "This field is required"
 * e o Next não avança (aí o passo de termos falhava procurando "I agree").
 */
export async function fillNameStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  const { firstName, lastName } = splitFullName(context.applicantData.fullName);

  try {
    const firstNameInput = await firstAvailable(page, [
      page.getByLabel(/^first name$/i),
      page.getByPlaceholder(/enter first name|first name/i),
    ]);
    const lastNameInput = await firstAvailable(page, [
      page.getByLabel(/^last name$/i),
      page.getByPlaceholder(/enter last name|last name/i),
    ]);

    if (firstNameInput && lastNameInput) {
      await ctx.human.type(firstNameInput, firstName, { timeout: config.timeouts.elementWait });
      await ctx.human.pause(200, 700);
      await ctx.human.type(lastNameInput, lastName, { timeout: config.timeouts.elementWait });
    } else {
      // Fallback estrutural: primeiros dois inputs de texto visiveis da tela.
      const textInputs = page.locator('input[type="text"]:visible');
      await ctx.human.type(textInputs.nth(0), firstName, { timeout: config.timeouts.elementWait });
      await ctx.human.pause(200, 700);
      await ctx.human.type(textInputs.nth(1), lastName, { timeout: config.timeouts.elementWait });
    }

    const lastValue = lastNameInput
      ? await lastNameInput.inputValue()
      : await page.locator('input[type="text"]:visible').nth(1).inputValue();
    if (!lastValue.trim()) {
      throw new Error(`Sobrenome ficou vazio após o fill (fullName="${context.applicantData.fullName}")`);
    }

    await clickPrimaryNext(ctx, config.timeouts.elementWait);
    // Confirma que saiu da tela de nome (senão o Next foi ignorado por validação).
    await page
      .getByRole("heading", { name: /what'?s your name/i })
      .waitFor({ state: "hidden", timeout: config.timeouts.elementWait });
    await failIfUberRequestFailed(page);
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher nome/sobrenome");
  }
  await ctx.recordStep("NAME_SUBMITTED", {
    usedPlaceholderLastName: context.applicantData.fullName.trim().split(/\s+/).length < 2,
  });
}

/**
 * Passo 7 (PDF): "Accept Uber's Terms & Review Privacy Notice" - marca "I
 * agree" (checkbox/linha cinza) e clica "Next". Após o nome a Uber às vezes
 * demora (spinner em tela branca) ou pula direto para All set / gênero.
 */
export async function acceptTermsStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await failIfUberRequestFailed(page);

    const termsHeading = page.getByRole("heading", {
      name: /accept uber'?s terms|terms & review privacy|termos/i,
    });
    const allSetHeading = page.getByRole("heading", { name: /all set/i });
    const genderHeading = page.getByRole("heading", {
      name: /gender|g[eê]nero|what'?s your gender/i,
    });
    const agreeText = page.getByText(/^i agree$/i);
    const requestFailed = page
      .getByRole("heading", { name: /request failed/i })
      .or(page.getByText(/unable to process this request/i));

    // Após o nome a Uber pode ficar em spinner branco vários segundos.
    const nextSignal = termsHeading
      .or(agreeText)
      .or(allSetHeading)
      .or(genderHeading)
      .or(requestFailed)
      .first();

    try {
      await nextSignal.waitFor({
        state: "visible",
        timeout: Math.max(config.timeouts.pageLoad * 2, 60_000),
      });
    } catch {
      throw new AutomationTechnicalError(
        "TIMEOUT",
        "Após o nome a Uber ficou em loading e não mostrou termos / All set / gênero",
      );
    }

    await failIfUberRequestFailed(page);

    const onTerms =
      (await termsHeading.isVisible().catch(() => false)) ||
      (await agreeText.first().isVisible().catch(() => false));

    if (!onTerms) {
      // Já passou dos termos (All set / gender).
      await ctx.recordStep("TERMS_ACCEPTED", { skipped: true });
      return;
    }

    // A UI real é uma linha/card "I agree" + checkbox à direita - clicar no
    // texto ou no checkbox. Evitar links "Terms of Use" / "Privacy Notice".
    const agreeRow = page
      .locator("label, [role='checkbox'], button, div")
      .filter({ hasText: /^i agree$/i })
      .first();
    const agreeCheckbox = page.getByRole("checkbox", { name: /i agree/i }).first();

    if (await agreeCheckbox.isVisible().catch(() => false)) {
      const checked = await agreeCheckbox.isChecked().catch(() => false);
      if (!checked) await ctx.human.clickSafe(agreeCheckbox, { timeout: config.timeouts.elementWait });
    } else {
      await ctx.human.clickSafe(agreeRow, { timeout: config.timeouts.elementWait });
    }

    await clickPrimaryNext(ctx, config.timeouts.elementWait);
    await termsHeading.waitFor({ state: "hidden", timeout: config.timeouts.pageLoad }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", 'Falha ao aceitar termos ("I agree")');
  }
  await ctx.recordStep("TERMS_ACCEPTED");
}

/**
 * Passo 8 (PDF): tela "All set!" - às vezes avança sozinha. Só clica
 * Continue/Next se a heading "All set" estiver visível - senão o Next da
 * tela de termos seria clicado de novo por engano.
 */
export async function confirmAllSetStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    const allSet = page.getByRole("heading", { name: /all set/i }).or(page.getByText(/^all set!?$/i));
    const visible = await allSet.first().isVisible({ timeout: 8_000 }).catch(() => false);
    if (visible) {
      const continueButton = page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first();
      if (await continueButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await ctx.human.clickSafe(continueButton, { timeout: config.timeouts.elementWait });
      }
    }
  } catch {
    // Tela pode ja ter avancado sozinha - nao e uma falha.
  }
  await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad }).catch(() => undefined);
  await ctx.recordStep("ACCOUNT_CREATED");
  // Não marca golden aqui — sessão de hub só depois de ensureHubAfterAccountCreated.
}

async function firstAvailable(
  page: RealStepContext["page"],
  locators: ReturnType<RealStepContext["page"]["getByLabel"]>[],
) {
  for (const locator of locators) {
    if ((await locator.count().catch(() => 0)) > 0) return locator.first();
  }
  return null;
}
