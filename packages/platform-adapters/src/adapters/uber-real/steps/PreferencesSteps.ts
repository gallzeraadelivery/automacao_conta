import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../../types";
import type { RealStepContext } from "../realStepContext";
import type { Page } from "playwright";
import { earnCityUi, looksLikeAuthGate, looksLikeBonjourChrome, looksLikeUberHub, softGoto } from "./HubSessionSteps";

/** Mesmo padrão de AccountCreationSteps + CTA "Join now" da tela Earn. */
const PRIMARY_NEXT_NAME = /^(continuar|continue|next|pr[oó]ximo|join now)(\s*→)?$/i;

/**
 * Banner "We use cookies" (Accept / Reject / Cookie settings) - bloqueia
 * cliques no menu/Earn/Deliver e no Next se não for dispensado.
 */
export async function dismissCookieBannerIfPresent(page: Page, timeout: number): Promise<boolean> {
  const banner = page
    .getByText(/we use cookies/i)
    .or(page.getByText(/this website uses third party cookies/i));
  if (!(await banner.first().isVisible({ timeout: 2_000 }).catch(() => false))) {
    return false;
  }
  const accept = page
    .getByRole("button", { name: /^(accept|got it)$/i })
    .or(page.getByRole("button", { name: /^got it$/i }))
    .last();
  await accept.click({ timeout }).catch(() => undefined);
  await banner.first().waitFor({ state: "hidden", timeout }).catch(() => undefined);
  return true;
}

/**
 * Tela de SSN / Social Security / background disclosure — fronteira humana.
 * Nunca preenche; neste ponto vamos ao hub.
 */
export async function looksLikeBackgroundOrSocialScreen(page: Page): Promise<boolean> {
  const ui = page
    .getByRole("heading", {
      name: /social security|ssn|background check|background screening|review the following disclosure|itin/i,
    })
    .or(page.getByText(/social security number|enter your ssn|background check|consent to.*(background|screening)/i))
    .or(page.getByRole("button", { name: /^(agree|i agree)$/i }))
    .or(page.locator('input[name*="ssn" i], input[id*="ssn" i], input[autocomplete="off"][maxlength="9"]'));
  return ui.first().isVisible({ timeout: 2_500 }).catch(() => false);
}

async function looksLikeGenderScreen(page: Page): Promise<boolean> {
  return page
    .getByRole("heading", { name: /gender|g[eê]nero|what'?s your gender/i })
    .or(page.getByText(/what'?s your gender|sharing your gender identity/i))
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

async function looksLikeServiceTypeScreen(page: Page, serviceTypeLabel: string): Promise<boolean> {
  return page
    .getByText(new RegExp(`^${serviceTypeLabel}$`, "i"))
    .or(page.getByRole("heading", { name: /choose how you want to earn|how do you want to earn/i }))
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
}

/** Opções de gênero aceitas (placeholder — nunca dado real). */
const GENDER_OPTION_RE =
  /prefer to choose later|i'?ll choose later|choose later|choose not to answer|prefer not to say|none of the above|decidir depois|prefiro (n[aã]o dizer|escolher depois)|non-?binary|man|male|homem/i;

/**
 * Passo 9: "What's your gender?" — usa "Prefer to choose later" (ou
 * equivalente). Em alguns fluxos a Uber pula a tela.
 */
export async function selectGenderStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);

    const genderUi = page
      .getByRole("heading", { name: /gender|g[eê]nero|what'?s your gender/i })
      .or(page.getByText(GENDER_OPTION_RE));

    const genderVisible = await genderUi.first().isVisible({ timeout: 12_000 }).catch(() => false);

    if (!genderVisible) {
      const skippedToEarnOrHub =
        (await earnCityUi(page).first().isVisible({ timeout: 5_000 }).catch(() => false)) ||
        /bonjour\.uber\.com/i.test(page.url());

      if (skippedToEarnOrHub) {
        const onEarn = await earnCityUi(page)
          .first()
          .isVisible({ timeout: 1_500 })
          .catch(() => false);
        await ctx.recordStep("GENDER_SUBMITTED", {
          skipped: true,
          url: page.url(),
          onEarn,
        });
        return;
      }

      await ctx.recordStep("GENDER_SUBMITTED", {
        skipped: true,
        reason: "not_visible_continue_to_earn",
        url: page.url(),
      });
      return;
    }

    // Preferência: "escolher depois" / "Choose not to answer"; fallback Man.
    const preferLater = page
      .getByText(
        /prefer to choose later|i'?ll choose later|choose later|choose not to answer|prefer not to say|none of the above|decidir depois|prefiro (n[aã]o dizer|escolher depois)/i,
      )
      .first();
    const configured = page
      .getByText(new RegExp(`^${config.genderOptionLabel}$`, "i"))
      .first();
    const fallbackMan = page.getByText(/^(man|male|homem)$/i).first();

    if (await preferLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await ctx.human.clickSafe(preferLater, { timeout: config.timeouts.elementWait });
    } else if (await configured.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await ctx.human.clickSafe(configured, { timeout: config.timeouts.elementWait });
    } else {
      await ctx.human.clickSafe(fallbackMan, { timeout: config.timeouts.elementWait });
    }

    await ctx.human.clickSafe(
      page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first(),
      { timeout: config.timeouts.elementWait },
    );
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
    await ctx.human.pause(400, 1_200);
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao selecionar gênero");
  }
  await ctx.recordStep("GENDER_SUBMITTED", { placeholder: true, value: "prefer_to_choose_later" });
}

/**
 * Páginas nuas de falha fatal da Uber no CTA Delivery/Earn
 * (ex.: "Internal Server Error" ou `{"message":"unauthorized"}`).
 * Conta/e-mail queimados nesse caminho — não retentar.
 */
async function isUberFatalBurnPage(page: Page): Promise<boolean> {
  const visibleIse = await page
    .getByText(/^internal server error$/i)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (visibleIse) return true;

  const visibleUnauthorized = await page
    .getByText(/["']?message["']?\s*:\s*["']unauthorized["']/i)
    .or(page.getByText(/^unauthorized$/i))
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (visibleUnauthorized) return true;

  const body = (await page.locator("body").innerText({ timeout: 1_500 }).catch(() => "")).trim();
  if (/^internal server error$/i.test(body)) return true;
  if (/["']message["']\s*:\s*["']unauthorized["']/i.test(body)) return true;
  if (/^unauthorized$/i.test(body)) return true;

  // JSON cru às vezes só aparece no HTML source.
  const html = (await page.content().catch(() => "")).slice(0, 2_000);
  if (/["']message["']\s*:\s*["']unauthorized["']/i.test(html)) return true;
  if (/^[\s{]*["']?message["']?\s*:\s*["']unauthorized["']/im.test(html)) return true;

  const title = await page.title().catch(() => "");
  return /internal server error/i.test(title);
}

async function discardIfUberFatalBurnPage(page: Page, ctx?: RealStepContext): Promise<void> {
  if (!(await isUberFatalBurnPage(page))) return;
  await ctx?.recordStep("UBER_FATAL_BURN_PAGE_DISCARD", { url: page.url() });
  throw new AutomationPauseSignal(
    "REFUSED",
    undefined,
    "Uber Internal Server Error / unauthorized — e-mail descartado (sem retentar)",
  );
}

/**
 * Página "Sorry, it looks like there was a problem on our end" da Uber —
 * clica Continue / Refresh e segue. Página fatal (ISE/unauthorized) → descarte.
 */
async function dismissUberSorryErrorIfPresent(page: Page, timeout: number): Promise<boolean> {
  await discardIfUberFatalBurnPage(page);
  const sorry = page.getByText(/sorry, it looks like there was a problem on our end|problem on our end/i);
  if (!(await sorry.first().isVisible({ timeout: 1_500 }).catch(() => false))) {
    return false;
  }
  const cont = page
    .getByRole("link", { name: /^(continue|refresh|try again|ok)$/i })
    .or(page.getByRole("button", { name: /^(continue|refresh|try again|ok)$/i }))
    .or(page.getByText(/^continue$/i));
  if (await cont.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await cont.first().click({ timeout, force: true }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await discardIfUberFatalBurnPage(page);
    return true;
  }
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  await discardIfUberFatalBurnPage(page);
  return true;
}

/** Copy das telas educativas pós-"Complete next steps" / start-earning. */
const EARN_EDUCATION_COPY_RE =
  /work that flexes|flexes to fit your schedule|earn in a way that adapts|women riders want women drivers|more control and peace of mind|access safety tools and rider preferences|meet the demand from women riders/i;

/**
 * Interstitial "Work that flexes…" / "More control and peace of mind…" —
 * bloqueia o fluxo até clicar "Got it". O botão costuma ficar no rodapé
 * sticky; Playwright às vezes marca como not-visible → scroll + click JS.
 */
async function dismissEarnEducationInterstitialIfPresent(
  page: Page,
  timeout: number,
): Promise<boolean> {
  const gotItLocator = page
    .getByRole("button", { name: /^got it$/i })
    .or(page.locator("button, [role='button'], a, [data-baseweb='button']").filter({ hasText: /^got it$/i }));

  let clicked = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const onEducation =
      /start-earning|\/deliver/i.test(page.url()) ||
      (await page
        .getByText(EARN_EDUCATION_COPY_RE)
        .first()
        .isVisible({ timeout: 1_200 })
        .catch(() => false));

    const count = await gotItLocator.count().catch(() => 0);
    if (count === 0 && !onEducation) {
      break;
    }

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => undefined);
    await page.waitForTimeout(400);

    const clickedJs = await page
      .evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll("button, a, [role='button'], [data-baseweb='button']"),
        );
        const el = nodes.find((n) => /^got it$/i.test((n.textContent || "").replace(/\s+/g, " ").trim()));
        if (!el || !(el instanceof HTMLElement)) return false;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        el.click();
        return true;
      })
      .catch(() => false);

    if (clickedJs) {
      clicked = true;
      await page.waitForTimeout(1_200);
    } else if (count > 0) {
      await gotItLocator
        .first()
        .click({ timeout, force: true })
        .catch(() => undefined);
      clicked = true;
      await page.waitForTimeout(1_200);
    } else {
      await page.waitForTimeout(700);
      continue;
    }

    const stillThere = await page
      .evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll("button, a, [role='button'], [data-baseweb='button']"),
        );
        return nodes.some((n) => /^got it$/i.test((n.textContent || "").replace(/\s+/g, " ").trim()));
      })
      .catch(() => false);
    if (!stillThere) break;
  }
  return clicked;
}

/** Tela "Welcome back, {Name}!" com CTA Complete next steps. */
async function looksLikeWelcomeBackScreen(page: Page): Promise<boolean> {
  const heading = page
    .getByRole("heading", { name: /welcome back/i })
    .or(page.getByText(/welcome back,.+!/i));
  const cta = page
    .getByRole("button", { name: /complete next steps/i })
    .or(page.getByRole("link", { name: /complete next steps/i }));
  return (
    (await heading.first().isVisible({ timeout: 2_000 }).catch(() => false)) ||
    (await cta.first().isVisible({ timeout: 1_500 }).catch(() => false))
  );
}

/**
 * Pós-conta: Welcome back → Complete next steps → (Got It educativo).
 * Observado quando Documents está vazio e a Uber manda para start-earning.
 */
async function advanceWelcomeBackInterstitialsIfPresent(
  page: Page,
  timeout: number,
): Promise<{ clickedWelcomeCta: boolean; dismissedEducation: boolean }> {
  let clickedWelcomeCta = false;

  if (await looksLikeWelcomeBackScreen(page)) {
    await page
      .evaluate(() => {
        window.scrollTo(0, Math.min(400, document.body.scrollHeight));
      })
      .catch(() => undefined);

    const clickedJs = await page
      .evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll("button, a, [role='button'], [data-baseweb='button']"),
        );
        const el = nodes.find((n) =>
          /complete next steps/i.test((n.textContent || "").replace(/\s+/g, " ").trim()),
        );
        if (!el || !(el instanceof HTMLElement)) return false;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        el.click();
        return true;
      })
      .catch(() => false);

    if (clickedJs) {
      clickedWelcomeCta = true;
    } else {
      const cta = page
        .getByRole("button", { name: /complete next steps/i })
        .or(page.getByRole("link", { name: /complete next steps/i }))
        .or(
          page
            .locator("button, a, [role='button'], [data-baseweb='button']")
            .filter({ hasText: /complete next steps/i }),
        )
        .first();
      if (await cta.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cta.click({ timeout, force: true }).catch(() => undefined);
        clickedWelcomeCta = true;
      }
    }

    if (clickedWelcomeCta) {
      await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    }
  }

  const dismissedEducation = await dismissEarnEducationInterstitialIfPresent(page, timeout);
  return { clickedWelcomeCta, dismissedEducation };
}

/**
 * Fluxo validado (pós-conta / Documents vazio):
 * start-riding (ou uber.com) → Menu → Earn → Deliver → "Earn with Uber" / cidade.
 *
 * NÃO clica /a/signup nem CTAs de login frio.
 */
async function openEarnCityViaMarketingNav(ctx: RealStepContext): Promise<boolean> {
  const { page, config } = ctx;
  const navTimeout = Math.max(config.timeouts.pageLoad, 45_000);
  const earnHeading = earnCityUi(page);

  async function cityVisible(timeoutMs: number): Promise<boolean> {
    return earnHeading.first().isVisible({ timeout: timeoutMs }).catch(() => false);
  }

  async function serviceVisible(): Promise<boolean> {
    return looksLikeServiceTypeScreen(page, config.serviceTypeLabel);
  }

  async function onboardingPastCity(): Promise<boolean> {
    // Só serviço/cidade — gênero é tratado no caller (inline) antes da cidade.
    if (await serviceVisible()) return true;
    return false;
  }

  async function openMobileNavIfNeeded(): Promise<boolean> {
    const menuToggle = page
      .getByRole("button", { name: /^(menu|open navigation|abrir menu)$/i })
      .or(page.locator('button[aria-label="Menu"], button[aria-label*="menu" i]'))
      .first();
    if (!(await menuToggle.isVisible({ timeout: 2_500 }).catch(() => false))) {
      return false;
    }
    await ctx.human.clickSafe(menuToggle, { timeout: config.timeouts.elementWait });
    await ctx.human.pause(500, 1_200);
    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
    await ctx.recordStep("EARNING_LOCATION_MOBILE_MENU_OPENED", { url: page.url() });
    return true;
  }

  /** Earn → Deliver (submenu). Clica Earn mesmo com href ruim; prioriza Deliver em seguida. */
  async function clickEarnThenDeliver(): Promise<boolean> {
    await openMobileNavIfNeeded();

    const earnCandidates = page
      .locator("header, [role='banner'], nav, [role='dialog'], [data-baseweb='drawer'], [data-baseweb='modal']")
      .getByRole("button", { name: /^earn$/i })
      .or(
        page
          .locator("header, [role='banner'], nav, [role='dialog'], [data-baseweb='drawer']")
          .getByRole("link", { name: /^earn$/i }),
      )
      .or(page.getByRole("menuitem", { name: /^earn$/i }))
      .or(page.getByRole("button", { name: /^earn$/i }))
      .or(page.getByRole("link", { name: /^earn$/i }));

    let earnClicked = false;
    const n = await earnCandidates.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 10); i++) {
      const el = earnCandidates.nth(i);
      if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
      const href = ((await el.getAttribute("href").catch(() => null)) || "").trim();
      await ctx.human.clickSafe(el, {
        timeout: config.timeouts.elementWait,
        noWaitAfter: true,
      });
      await ctx.human.pause(500, 1_000);
      await ctx.recordStep("EARNING_LOCATION_EARN_NAV_CLICKED", {
        url: page.url(),
        href: href || null,
      });
      earnClicked = true;
      break;
    }

    if (!earnClicked) {
      const earnText = page
        .locator("header, [role='banner'], nav, [role='dialog'], [data-baseweb='drawer']")
        .getByText(/^earn$/i)
        .first();
      if (await earnText.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await earnText.click({ timeout: config.timeouts.elementWait, noWaitAfter: true }).catch(() => undefined);
        await ctx.human.pause(500, 1_000);
        await ctx.recordStep("EARNING_LOCATION_EARN_NAV_CLICKED", { url: page.url(), via: "text" });
        earnClicked = true;
      }
    }

    if (!earnClicked) {
      await ctx.recordStep("EARNING_LOCATION_EARN_NAV_MISSING", { url: page.url() });
    }

    // Submenu Deliver — caminho clássico após Earn.
    if (await clickDeliverIfPresent()) return true;

    // Se Earn navegou para destino errado, volta e tenta Deliver no menu.
    if (/drivers\.uber\.com|ubereats\.com/i.test(page.url())) {
      await ctx.recordStep("EARNING_LOCATION_EARN_NAV_WRONG_TARGET", { url: page.url() });
      await softGoto(page, config.marketingBaseUrl, navTimeout);
      await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
      await openMobileNavIfNeeded();
      if (await clickDeliverIfPresent()) return true;
    }

    return earnClicked;
  }

  async function clickDeliverIfPresent(): Promise<boolean> {
    const deliver = page
      .getByRole("menuitem", { name: /^deliver(y)?$/i })
      .or(page.getByRole("link", { name: /^deliver(y)?$|deliver with uber/i }))
      .or(page.getByRole("button", { name: /^deliver(y)?$|deliver with uber/i }))
      .or(
        page
          .locator('a[href*="/deliver"]')
          .filter({ hasNotText: /drive with uber|^drive$/i }),
      );

    const n = await deliver.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 8); i++) {
      const el = deliver.nth(i);
      if (!(await el.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const href = (await el.getAttribute("href").catch(() => null)) ?? "";
      if (/\/a\/signup|auth\.uber\.com|ubereats\.com/i.test(href)) continue;

      // Preferir navegação explícita ao /deliver/ (click SPA às vezes não sai do start-riding).
      const absolute =
        href.startsWith("http")
          ? href
          : href.startsWith("/")
            ? `https://www.uber.com${href}`
            : "";
      if (absolute && /\/deliver/i.test(absolute)) {
        await softGoto(page, absolute.split("?")[0]!, navTimeout);
      } else {
        await ctx.human.clickSafe(el, {
          timeout: config.timeouts.elementWait,
          noWaitAfter: true,
        });
        await page
          .waitForLoadState("domcontentloaded", { timeout: Math.min(config.timeouts.pageLoad, 30_000) })
          .catch(() => undefined);
        await ctx.human.pause(700, 1_600);
      }

      await ctx.recordStep("EARNING_LOCATION_DELIVERY_CLICKED", { url: page.url(), href });
      await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
      await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
      return true;
    }
    return false;
  }

  const alreadyOnUberMarketing =
    /uber\.com/i.test(page.url()) &&
    !/drivers\.uber\.com|bonjour\.uber\.com|auth\.uber\.com|ubereats\.com/i.test(page.url());

  if (!alreadyOnUberMarketing) {
    await softGoto(page, config.marketingBaseUrl, navTimeout);
  }
  await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
  await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
  await discardIfUberFatalBurnPage(page, ctx);
  await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);

  if (await looksLikeAuthGate(page)) {
    await ctx.recordStep("EARNING_LOCATION_MARKETING_AUTH_GATE", { url: page.url() });
    return false;
  }
  if (await cityVisible(3_000)) return true;
  if (await onboardingPastCity()) return true;

  // Fluxo clássico: Earn → Deliver → cidade (ou gênero/step no bonjour).
  await clickEarnThenDeliver();
  await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
  // Após Earn→drivers a Uber pode montar gênero depois cidade.
  const afterEarnDeadline = Date.now() + 35_000;
  while (Date.now() < afterEarnDeadline) {
    if (await cityVisible(800)) return true;
    if (await looksLikeGenderScreen(page)) {
      await ctx.recordStep("EARNING_LOCATION_GENDER_INLINE", { url: page.url(), via: "earn_then_deliver" });
      await selectGenderStep(ctx);
      continue;
    }
    if (await onboardingPastCity()) {
      await ctx.recordStep("EARNING_LOCATION_ONBOARDING_REACHED", {
        url: page.url(),
        via: "earn_then_deliver",
      });
      return true;
    }
    await page.waitForTimeout(700);
  }

  // Fallback: start-earning (Welcome back / Complete next steps).
  try {
    await softGoto(page, config.startEarningUrl, navTimeout);
  } catch (error) {
    await ctx.recordStep("EARNING_LOCATION_START_EARNING_GOTO_FAILED", {
      url: page.url(),
      error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    });
    return (await cityVisible(3_000)) || (await onboardingPastCity());
  }
  await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
  await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
  const welcome = await advanceWelcomeBackInterstitialsIfPresent(
    page,
    config.timeouts.elementWait,
  );
  if (welcome.clickedWelcomeCta || welcome.dismissedEducation) {
    await ctx.recordStep("WELCOME_BACK_ADVANCED", {
      url: page.url(),
      via: "marketing_nav_start_earning",
      ...welcome,
    });
  }
  if (await cityVisible(20_000)) {
    await ctx.recordStep("EARNING_LOCATION_DEEP_LINK", {
      url: page.url(),
      via: config.startEarningUrl,
    });
    return true;
  }
  if (await onboardingPastCity()) return true;

  return cityVisible(3_000);
}

/**
 * Passo 10: "Earn with Uber" / "Where would you like to earn?".
 * Escolhe a próxima cidade do rodízio (não fica na pré-preenchida do IP).
 * Dispensa cookies e clica Next.
 *
 * Se a UI de cidade não aparecer: drivers → start-earning → Earn no marketing
 * (Ride/start-riding). Só então pausa + cookies (sem /a/signup).
 */
export async function confirmEarningLocationStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  const navTimeout = Math.max(config.timeouts.pageLoad, 45_000);

  // Só heading/copy da tela Earn/cidade — NÃO usar input/city genérico (bate em
  // My Profile → Language / Address e deixa Next forever disabled).
  async function waitForCityUi(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await earnCityUi(page).first().isVisible({ timeout: 600 }).catch(() => false)) {
        return true;
      }
      await page.waitForTimeout(700);
    }
    return false;
  }

  async function selectEarnCity(city: string): Promise<void> {
    // Escopo na tela Earn/cidade (nunca Language/Address do My Profile).
    const earnScope = page
      .locator("section, form, main, [role='main'], div")
      .filter({
        has: page.getByText(
          /where would you like to earn|choose your city|select city|referral code \(optional\)/i,
        ),
      })
      .first();

    const cityInput = earnScope
      .locator(
        'input[placeholder*="city" i], input[aria-label*="city" i], input[name*="city" i], input[autocomplete="address-level2"]',
      )
      .or(earnScope.getByRole("combobox"))
      .or(
        earnScope.locator(
          "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([name*='referral' i])",
        ),
      )
      .first();

    await cityInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });

    // Uber autocomplete: digitar "Orlando, FL" inteiro → "No Results".
    // Digitar só o núcleo ("Orlando") → lista; clicar "Orlando, FL, USA".
    // NÃO usar recorte ("Orlan"): spinner + "No Results" falso.
    const cityCore = city.split(",")[0]!.trim();
    const statePart = (city.split(",")[1] ?? "").trim(); // "FL"
    const coreEsc = cityCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stateEsc = statePart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const preferredOptionRe = stateEsc
      ? new RegExp(`^${coreEsc},\\s*${stateEsc},\\s*USA$`, "i")
      : new RegExp(`^${coreEsc},\\s*[A-Z]{2},\\s*USA$`, "i");
    const selectedValueRe = stateEsc
      ? new RegExp(`^${coreEsc},\\s*${stateEsc}\\b`, "i")
      : new RegExp(`^${coreEsc},\\s*[A-Z]{2}\\b`, "i");

    function optionLocators(queryCore: string) {
      const qEsc = queryCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const preferred = page
        .getByRole("option", { name: preferredOptionRe })
        .or(
          page
            .locator('[role="listbox"] [role="option"], [data-baseweb="menu"] li, [data-baseweb="popover"] li')
            .filter({ hasText: preferredOptionRe }),
        );
      const anyCityUsa = page
        .getByRole("option", { name: new RegExp(`^${qEsc},\\s*[A-Z]{2},\\s*USA$`, "i") })
        .or(
          page
            .locator('[role="listbox"] [role="option"]')
            .filter({ hasText: new RegExp(`^${qEsc},\\s*[A-Z]{2},\\s*USA$`, "i") }),
        );
      const anyWithCore = page
        .locator('[role="listbox"] [role="option"], [data-baseweb="menu"] li')
        .filter({ hasText: new RegExp(qEsc, "i") })
        .filter({ hasNotText: /airport|outlet|premium|boulevard|international/i });
      return { preferred, anyCityUsa, anyWithCore };
    }

    async function inputLooksSelected(): Promise<boolean> {
      const value = (await cityInput.inputValue().catch(() => "")).trim();
      return preferredOptionRe.test(value) || selectedValueRe.test(value);
    }

    // Já veio "Orlando, FL, USA" (IP/pré-fill) → não redigitar (quebra autocomplete).
    if (await inputLooksSelected()) {
      return;
    }

    async function peekOptions(queryCore: string): Promise<boolean> {
      const locs = optionLocators(queryCore);
      for (const loc of [locs.preferred, locs.anyCityUsa, locs.anyWithCore]) {
        if (await loc.first().isVisible({ timeout: 250 }).catch(() => false)) return true;
      }
      return false;
    }

    async function clickVisibleOption(queryCore: string): Promise<boolean> {
      const locs = optionLocators(queryCore);
      for (const loc of [locs.preferred, locs.anyCityUsa, locs.anyWithCore]) {
        const el = loc.first();
        if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
          await ctx.human.clickSafe(el, { timeout: config.timeouts.elementWait });
          return true;
        }
      }
      return false;
    }

    async function waitForAutocompleteReady(
      queryCore: string,
      timeoutMs: number,
    ): Promise<"options" | "empty" | "idle"> {
      const spinner = earnScope.locator(
        '[data-baseweb="spinner"], [aria-busy="true"], [class*="spinner" i], [class*="Spinner"], svg[role="status"], svg[aria-label*="load" i]',
      );
      const noResults = earnScope.getByText(/^no results$/i).or(page.getByText(/^no results$/i));
      const deadline = Date.now() + timeoutMs;
      let sawSpinner = false;

      while (Date.now() < deadline) {
        if (await peekOptions(queryCore)) return "options";
        const spinning = await spinner.first().isVisible({ timeout: 200 }).catch(() => false);
        if (spinning) {
          sawSpinner = true;
          await page.waitForTimeout(300);
          continue;
        }
        if (sawSpinner) {
          await page.waitForTimeout(400);
          if (await peekOptions(queryCore)) return "options";
          if (await noResults.first().isVisible({ timeout: 400 }).catch(() => false)) return "empty";
          return "idle";
        }
        await page.waitForTimeout(300);
      }
      if (await peekOptions(queryCore)) return "options";
      if (await noResults.first().isVisible({ timeout: 300 }).catch(() => false)) return "empty";
      return "idle";
    }

    async function tryKeyboardSelect(): Promise<boolean> {
      const listbox = page.locator('[role="listbox"]').first();
      if (!(await listbox.isVisible({ timeout: 800 }).catch(() => false))) return false;
      await cityInput.press("ArrowDown").catch(() => undefined);
      await ctx.human.pause(180, 350);
      await cityInput.press("Enter").catch(() => undefined);
      await ctx.human.pause(400, 800);
      return inputLooksSelected();
    }

    async function clearAndType(query: string): Promise<void> {
      await cityInput.click({ timeout: config.timeouts.elementWait });
      await cityInput.fill("");
      await ctx.human.pause(200, 450);
      await ctx.human.type(cityInput, query, {
        timeout: config.timeouts.elementWait,
        delayMs: { min: 70, max: 160 },
      });
      await ctx.human.pause(350, 700);
    }

    if (await inputLooksSelected()) {
      return;
    }

    let selected = false;
    for (let attempt = 0; attempt < 3 && !selected; attempt += 1) {
      await clearAndType(cityCore);
      const ready = await waitForAutocompleteReady(cityCore, 12_000);
      if (ready === "options") {
        selected = await clickVisibleOption(cityCore);
      }
      if (!selected) {
        selected = await tryKeyboardSelect();
      }
      if (!selected) {
        await ctx.human.pause(600, 1_100);
        selected = await inputLooksSelected();
      }
    }

    if (!selected) {
      throw new AutomationTechnicalError(
        "ELEMENT_NOT_FOUND",
        `Autocomplete de cidade não listou opção para "${city}" (tente digitando o nome e clicando na sugestão USA)`,
      );
    }

    await ctx.human.pause(400, 1_000);
    await page
      .locator('[role="listbox"]')
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => undefined);
  }

  try {
    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
    await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
    const welcomePass1 = await advanceWelcomeBackInterstitialsIfPresent(
      page,
      config.timeouts.elementWait,
    );
    if (welcomePass1.clickedWelcomeCta || welcomePass1.dismissedEducation) {
      await ctx.recordStep("WELCOME_BACK_ADVANCED", {
        url: page.url(),
        ...welcomePass1,
      });
      // Após Got It a Uber demora a montar cidade ou cards de serviço.
      const afterWelcomeDeadline = Date.now() + 20_000;
      while (Date.now() < afterWelcomeDeadline) {
        if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) break;
        if (await earnCityUi(page).first().isVisible({ timeout: 500 }).catch(() => false)) break;
        await page.waitForTimeout(700);
      }
    }

    // Já na escolha de serviço (cidade já feita antes) → não exige Earn city.
    if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
      await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
        skipped: true,
        reason: "already_on_service_type_after_welcome",
        city: ctx.assignedEarnCity ?? ctx.context.assignedEarnCity,
      });
      await ctx.persistSession?.({ markGolden: true, forceGolden: true });
      return;
    }

    // Já caiu de volta no login frio (phone/email) → não “recuperar” com CTA signup.
    if (await looksLikeAuthGate(page)) {
      await ctx.recordStep("POST_ACCOUNT_MANUAL_CONTINUE", {
        url: page.url(),
        reason: "auth_gate_after_account",
      });
      await ctx.persistSession?.({ markGolden: true, forceGolden: true });
      throw new AutomationPauseSignal(
        "SECURITY_BLOCK",
        {
          type: "SECURITY_BLOCK",
          provider: "POST_ACCOUNT_STUCK",
          confidence: "HIGH",
        },
        "Conta criada mas voltou ao login — cookies salvos; continue manualmente (sem retentar signup)",
      );
    }

    // Pós-gênero / pós-hub: espera curta; depois fluxo clássico Earn→Deliver.
    let onEarn = await waitForCityUi(12_000);

    // Ride / start-riding → Earn → Deliver → cidade (fluxo que sempre deu certo).
    if (!onEarn) {
      await ctx.recordStep("EARNING_LOCATION_MISSING", { url: page.url() });
      await ctx.recordStep("EARNING_LOCATION_MARKETING_NAV_ATTEMPT", {
        url: page.url(),
      });
      try {
        const viaMarketing = await openEarnCityViaMarketingNav(ctx);
        if (await looksLikeGenderScreen(page)) {
          await ctx.recordStep("EARNING_LOCATION_GENDER_INLINE", { url: page.url() });
          await selectGenderStep(ctx);
          onEarn = await waitForCityUi(25_000);
          if (!onEarn && (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel))) {
            await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
              skipped: true,
              reason: "service_type_after_inline_gender",
              city: ctx.assignedEarnCity ?? ctx.context.assignedEarnCity,
            });
            await ctx.persistSession?.({ markGolden: true, forceGolden: true });
            return;
          }
        } else if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
          await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
            skipped: true,
            reason: "service_type_after_marketing_earn",
            city: ctx.assignedEarnCity ?? ctx.context.assignedEarnCity,
          });
          await ctx.persistSession?.({ markGolden: true, forceGolden: true });
          return;
        } else {
          onEarn = viaMarketing || (await waitForCityUi(8_000));
        }
      } catch (error) {
        if (error instanceof AutomationPauseSignal) throw error;
        await ctx.recordStep("EARNING_LOCATION_MARKETING_NAV_FAILED", {
          url: page.url(),
          error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
        });
      }
    }

    // start-earning: Welcome back → Got It → cidade (rede pode falhar — não aborta).
    if (!onEarn) {
      try {
        await softGoto(page, config.startEarningUrl, navTimeout);
        await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
        await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
        const welcomePass3 = await advanceWelcomeBackInterstitialsIfPresent(
          page,
          config.timeouts.elementWait,
        );
        if (welcomePass3.clickedWelcomeCta || welcomePass3.dismissedEducation) {
          await ctx.recordStep("WELCOME_BACK_ADVANCED", {
            url: page.url(),
            via: "start_earning",
            ...welcomePass3,
          });
          const afterWelcomeDeadline = Date.now() + 15_000;
          while (Date.now() < afterWelcomeDeadline) {
            if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) break;
            if (await earnCityUi(page).first().isVisible({ timeout: 500 }).catch(() => false)) break;
            await page.waitForTimeout(700);
          }
        }
        if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
          await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
            skipped: true,
            reason: "service_type_after_start_earning_welcome",
            city: ctx.assignedEarnCity ?? ctx.context.assignedEarnCity,
          });
          await ctx.persistSession?.({ markGolden: true, forceGolden: true });
          return;
        }
        onEarn = await waitForCityUi(15_000);
      } catch (error) {
        if (error instanceof AutomationPauseSignal) throw error;
        await ctx.recordStep("EARNING_LOCATION_START_EARNING_GOTO_FAILED", {
          url: page.url(),
          error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
        });
      }
    }

    // Fallback drivers (opcional).
    if (!onEarn) {
      try {
        await softGoto(page, config.driversBaseUrl, navTimeout);
        await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
        await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
        const welcomePass2 = await advanceWelcomeBackInterstitialsIfPresent(
          page,
          config.timeouts.elementWait,
        );
        if (welcomePass2.clickedWelcomeCta || welcomePass2.dismissedEducation) {
          await ctx.recordStep("WELCOME_BACK_ADVANCED", {
            url: page.url(),
            via: "drivers",
            ...welcomePass2,
          });
        }
        if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
          await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
            skipped: true,
            reason: "service_type_after_drivers_welcome",
            city: ctx.assignedEarnCity ?? ctx.context.assignedEarnCity,
          });
          await ctx.persistSession?.({ markGolden: true, forceGolden: true });
          return;
        }
        onEarn = await waitForCityUi(12_000);
      } catch (error) {
        if (error instanceof AutomationPauseSignal) throw error;
        await ctx.recordStep("EARNING_LOCATION_DRIVERS_GOTO_FAILED", {
          url: page.url(),
          error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
        });
      }
    }

    // Ainda sem cidade: se ainda há gênero, resolve e espera cidade; senão pausa.
    if (!onEarn) {
      if (await looksLikeGenderScreen(page)) {
        await selectGenderStep(ctx);
        onEarn = await waitForCityUi(25_000);
      }
    }
    if (!onEarn) {
      if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
        await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
          skipped: true,
          reason: "service_type_without_city_heading",
          url: page.url(),
        });
        await ctx.persistSession?.({ markGolden: true, forceGolden: true });
        return;
      }
      await discardIfUberFatalBurnPage(page, ctx);
      await ctx.recordStep("POST_ACCOUNT_MANUAL_CONTINUE", {
        url: page.url(),
        reason: "city_or_hub_not_reached_after_account",
      });
      await ctx.persistSession?.({ markGolden: true, forceGolden: true });
      throw new AutomationPauseSignal(
        "SECURITY_BLOCK",
        {
          type: "SECURITY_BLOCK",
          provider: "POST_ACCOUNT_STUCK",
          confidence: "HIGH",
        },
        "Conta criada mas cidade/hub não abriu — cookies salvos; continue manualmente (sem retentar signup)",
      );
    }

    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);

    const city =
      (ctx.allocateEarnCity ? await ctx.allocateEarnCity() : undefined) ??
      ctx.assignedEarnCity ??
      "Orlando, FL";
    ctx.assignedEarnCity = city;
    ctx.context.assignedEarnCity = city;

    await selectEarnCity(city);

    const nextButton = page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first();
    await nextButton.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await nextButton.scrollIntoViewIfNeeded().catch(() => undefined);

    // Next / Join now só habilita depois de selecionar opção do autocomplete.
    const enabledDeadline = Date.now() + Math.max(config.timeouts.elementWait, 20_000);
    while (Date.now() < enabledDeadline) {
      if (await nextButton.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(400);
    }
    if (!(await nextButton.isEnabled().catch(() => false))) {
      throw new AutomationTechnicalError(
        "ELEMENT_TIMEOUT",
        `Next/Join now da cidade ainda disabled após selecionar "${city}" — retentar`,
      );
    }

    await ctx.human.clickSafe(nextButton, { timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    if (error instanceof AutomationPauseSignal) throw error;
    if (error instanceof AutomationTechnicalError) throw error;
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao confirmar localização de ganhos");
  }
  await ctx.recordStep("EARNING_LOCATION_CONFIRMED", {
    city: ctx.assignedEarnCity,
    rotated: Boolean(ctx.allocateEarnCity),
  });
  await ctx.persistSession?.({ markGolden: true, forceGolden: true });
}

/**
 * Após a cidade: se já pediu SSN/background → hub.
 * Se pediu tipo de serviço → Delivery with car; em seguida, ao ver
 * SSN/background (ou sem tela), vai ao hub. Nunca preenche social.
 */
export async function finishEarnThenGoToHubOnBackground(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
  const welcome = await advanceWelcomeBackInterstitialsIfPresent(
    page,
    config.timeouts.elementWait,
  );
  if (welcome.clickedWelcomeCta || welcome.dismissedEducation) {
    await ctx.recordStep("WELCOME_BACK_ADVANCED", {
      url: page.url(),
      via: "before_service_type",
      ...welcome,
    });
  }

  if (await looksLikeBackgroundOrSocialScreen(page)) {
    await ctx.recordStep("SERVICE_TYPE_SUBMITTED", {
      skipped: true,
      reason: "background_or_ssn_after_city",
    });
    await skipBackgroundCheckStep(ctx);
    return;
  }

  if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
    await selectServiceTypeStep(ctx);
  } else {
    // Após cidade a Uber demora a mostrar os cards.
    await page.waitForTimeout(3_000);
    const serviceDeadline = Date.now() + 35_000;
    while (Date.now() < serviceDeadline) {
      if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) break;
      if (await looksLikeBackgroundOrSocialScreen(page)) break;
      await page.waitForTimeout(800);
    }
    if (await looksLikeServiceTypeScreen(page, config.serviceTypeLabel)) {
      await selectServiceTypeStep(ctx);
    } else if (await looksLikeBackgroundOrSocialScreen(page)) {
      await ctx.recordStep("SERVICE_TYPE_SUBMITTED", {
        skipped: true,
        reason: "background_or_ssn_before_service_type",
      });
    } else {
      await ctx.recordStep("SERVICE_TYPE_SUBMITTED", {
        skipped: true,
        reason: "service_type_not_shown",
        url: page.url(),
      });
    }
  }

  await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
  // Fronteira: social/background (ou já passou) → hub, sem Agree/SSN.
  await skipBackgroundCheckStep(ctx);
}

/**
 * Passo 11 (PDF): "Choose how you want to earn with Uber" - sempre
 * "Delivery with car" (fixo). Clica no card; Next se aparecer.
 */
export async function selectServiceTypeStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    if (await looksLikeBackgroundOrSocialScreen(page)) {
      await ctx.recordStep("SERVICE_TYPE_SUBMITTED", {
        skipped: true,
        reason: "already_on_background_or_ssn",
      });
      return;
    }

    const chooseHeading = page.getByRole("heading", {
      name: /choose how you want to earn|how do you want to earn/i,
    });
    await chooseHeading
      .or(page.getByText(new RegExp(`^${config.serviceTypeLabel}$`, "i")))
      .first()
      .waitFor({ state: "visible", timeout: Math.max(config.timeouts.elementWait, 25_000) })
      .catch(() => undefined);

    // Card "Delivery with car" (não "Rides and delivery").
    const deliveryCard = page
      .getByText(new RegExp(`^${config.serviceTypeLabel}$`, "i"))
      .first();
    await deliveryCard.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await ctx.human.clickSafe(deliveryCard, { timeout: config.timeouts.elementWait });
    await ctx.human.pause(500, 1_200);

    const nextButton = page.getByRole("button", { name: PRIMARY_NEXT_NAME }).first();
    if (await nextButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await ctx.human.clickSafe(nextButton, { timeout: config.timeouts.elementWait });
    }
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad }).catch(() => undefined);
    await page.waitForTimeout(1_200);
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao selecionar tipo de serviço");
  }
  await ctx.recordStep("SERVICE_TYPE_SUBMITTED", { value: config.serviceTypeLabel });
}

/**
 * Itens reais da lista Documents (CNH / foto). Só o título "Driver requirements"
 * NÃO conta — lista vazia = conta ainda não criada como motorista Delivery.
 */
export async function hasDriverDocumentEntries(page: Page, timeoutMs = 2_500): Promise<boolean> {
  const entries = page
    .getByRole("button", {
      name: /driver'?s? license|profile (photo|picture)|foto de perfil|profile picture/i,
    })
    .or(
      page.getByRole("link", {
        name: /driver'?s? license|profile (photo|picture)|foto de perfil|profile picture/i,
      }),
    )
    .or(page.getByText(/driver'?s? license|profile (photo|picture)|foto de perfil/i));
  return entries.first().isVisible({ timeout: timeoutMs }).catch(() => false);
}

async function openDocumentsTab(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  const chromeAlready = (await looksLikeBonjourChrome(page)) || (await looksLikeUberHub(page));
  if (!chromeAlready) {
    await softGoto(page, config.profileUrl, Math.max(config.timeouts.pageLoad, 45_000));
  }

  const documentsTab = page.getByRole("tab", { name: /^documents$/i }).or(page.getByText(/^documents$/i));
  const chromeDeadline = Date.now() + 15_000;
  while (Date.now() < chromeDeadline) {
    if ((await documentsTab.count().catch(() => 0)) > 0) break;
    await page.waitForTimeout(400);
  }
  if ((await documentsTab.count().catch(() => 0)) > 0) {
    await documentsTab.first().click({ timeout: config.timeouts.elementWait }).catch(() => undefined);
    await ctx.human.pause(500, 1_000);
  }
  await page
    .getByText(/driver requirements/i)
    .or(page.getByRole("heading", { name: /welcome/i }))
    .first()
    .waitFor({ state: "visible", timeout: Math.max(config.timeouts.pageLoad, 25_000) })
    .catch(() => undefined);
}

/**
 * Se Documents não listar CNH/foto: start-earning (Welcome back) → Got It →
 * cidade (se pedir) → Delivery → background → profile.
 * Só retorna true quando a lista tiver itens.
 */
export async function ensureDriverDocsViaEarnIfNeeded(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  await openDocumentsTab(ctx);

  const deadlineQuick = Date.now() + 12_000;
  while (Date.now() < deadlineQuick) {
    if (await hasDriverDocumentEntries(page, 600)) return;
    await page.waitForTimeout(700);
  }

  await ctx.recordStep("DRIVER_DOCS_EMPTY_RERUN_EARN", { url: page.url() });

  // Entrada observada: Welcome back em start-earning (não drivers/profile).
  const navTimeout = Math.max(config.timeouts.pageLoad, 45_000);
  await softGoto(page, config.startEarningUrl, navTimeout);
  await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
  const welcome = await advanceWelcomeBackInterstitialsIfPresent(
    page,
    config.timeouts.elementWait,
  );
  if (welcome.clickedWelcomeCta || welcome.dismissedEducation) {
    await ctx.recordStep("WELCOME_BACK_ADVANCED", {
      url: page.url(),
      via: "docs_empty_rerun",
      ...welcome,
    });
  }

  // Conta já existe: Earn→cidade (se precisar)→Delivery→hub (gênero já foi).
  await confirmEarningLocationStep(ctx);
  await finishEarnThenGoToHubOnBackground(ctx);
  await openDocumentsTab(ctx);

  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    if (await hasDriverDocumentEntries(page, 600)) return;
    await page.waitForTimeout(700);
  }

  throw new AutomationTechnicalError(
    "ELEMENT_TIMEOUT",
    "Documents ainda sem Driver's License / Profile Picture após refazer Earn — conta não ficou como motorista",
  );
}

/**
 * Passo 12: tela Background check / disclosure.
 * NUNCA Agree/SSN — vai direto para bonjour.uber.com/profile (Documents).
 */
export async function skipBackgroundCheckStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  const onBackground = await looksLikeBackgroundOrSocialScreen(page);
  const timeout = Math.max(config.timeouts.pageLoad, 45_000);

  await softGoto(page, config.profileUrl, timeout);
  await openDocumentsTab(ctx);

  const hubUi = page
    .getByText(/driver requirements/i)
    .or(page.getByRole("tab", { name: /^documents$/i }))
    .or(page.getByRole("heading", { name: /welcome/i }))
    .or(page.getByText(/add my vehicle/i));
  await hubUi.first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => undefined);

  await ctx.recordStep("BACKGROUND_CHECK_SKIPPED", {
    detectedBackgroundOrSsn: onBackground,
    url: page.url(),
    documentsTab: (await page.getByRole("tab", { name: /^documents$/i }).count().catch(() => 0)) > 0,
  });
  await ctx.persistSession?.({ markGolden: true, forceGolden: true });
}

/**
 * Passos 13-14 (PDF): chega em "Driver requirements" (aba Documents) e para
 * IMEDIATAMENTE - nunca clica em "Driver's License" nem "Profile Picture".
 * Diferente do PDF (que manda clicar "Take Photo" e só parar depois de
 * detectar o verificador), esta automação pausa um passo ANTES: o botão
 * "Take Photo" da própria Uber ativa a câmera/captura de documento na
 * página da Uber (texto real da tela: "This session is video enabled and
 * may be recorded" / "may use facial recognition technology... biometric
 * data") - isso é exatamente o que as regras de segurança obrigatórias
 * deste projeto proíbem (nunca acessar câmera, nunca enviar documento/selfie,
 * nunca concluir verificação de identidade). Ver README do pacote.
 */
export async function reachDriverRequirementsStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    const documentsTab = page.getByRole("tab", { name: /^documents$/i }).or(page.getByText(/^documents$/i));
    if ((await documentsTab.count().catch(() => 0)) > 0) {
      await documentsTab.first().click({ timeout: config.timeouts.elementWait }).catch(() => undefined);
    }
    await page
      .getByText(/driver requirements/i)
      .waitFor({ state: "visible", timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(
      error,
      "PAGE_UNAVAILABLE",
      'Falha ao chegar em "Driver requirements" (bonjour.uber.com/profile)',
    );
  }

  await ctx.recordStep("DRIVER_REQUIREMENTS_REACHED", { url: page.url() });

  throw new AutomationPauseSignal("IDENTITY_VERIFICATION_REQUIRED");
}
