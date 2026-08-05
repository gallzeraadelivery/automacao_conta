import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../../types";
import type { RealStepContext } from "../realStepContext";
import type { Page } from "playwright";
import { softGoto } from "./HubSessionSteps";

/** Mesmo padrão de AccountCreationSteps - "Next →" / Continue / Continuar. */
const PRIMARY_NEXT_NAME = /^(continuar|continue|next|pr[oó]ximo)(\s*→)?$/i;

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
  /prefer to choose later|i'?ll choose later|choose later|prefer not to say|decidir depois|prefiro (n[aã]o dizer|escolher depois)|non-?binary|man|male|homem/i;

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
        (await page
          .getByRole("heading", { name: /earn with uber/i })
          .or(page.getByText(/where would you like to earn/i))
          .first()
          .isVisible({ timeout: 5_000 })
          .catch(() => false)) ||
        /bonjour\.uber\.com/i.test(page.url());

      if (skippedToEarnOrHub) {
        const onEarn = await page
          .getByRole("heading", { name: /earn with uber/i })
          .or(page.getByText(/where would you like to earn/i))
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

    // Preferência: "escolher depois"; fallback no label da config / Man.
    const preferLater = page
      .getByText(/prefer to choose later|i'?ll choose later|choose later|prefer not to say|decidir depois|prefiro (n[aã]o dizer|escolher depois)/i)
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

/**
 * Interstitial "Work that flexes…" / similar em start-earning — bloqueia
 * o fluxo até clicar "Got it". O botão costuma ficar no rodapé sticky;
 * Playwright às vezes marca como not-visible → forçamos scroll + click JS.
 */
async function dismissEarnEducationInterstitialIfPresent(
  page: Page,
  timeout: number,
): Promise<boolean> {
  const gotItLocator = page
    .getByRole("button", { name: /got it/i })
    .or(page.locator("button, [role='button'], a, [data-baseweb='button']").filter({ hasText: /got it/i }));

  let clicked = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const onEducation =
      /start-earning|\/deliver/i.test(page.url()) ||
      (await page
        .getByText(/work that flexes|flexes to fit your schedule|earn in a way that adapts|women riders want women drivers/i)
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

/**
 * Conta já no hub sem tela de cidade: www.uber.com → Earn (nav topo) →
 * (opcional) Delivery → espera "Earn with Uber" / cidade.
 *
 * Conta logada às vezes cai em /start-earning/?city=… sem menu Earn — aí
 * dispensa interstitial "Got it" e segue CTAs / deep link de delivery.
 */
async function openEarnCityViaMarketingNav(ctx: RealStepContext): Promise<boolean> {
  const { page, config } = ctx;
  const navTimeout = Math.max(config.timeouts.pageLoad, 45_000);
  const earnHeading = page
    .getByRole("heading", { name: /earn with uber/i })
    .or(page.getByText(/where would you like to earn/i));

  async function cityVisible(timeoutMs: number): Promise<boolean> {
    return earnHeading.first().isVisible({ timeout: timeoutMs }).catch(() => false);
  }

  async function clickAndSettle(target: ReturnType<Page["locator"]>): Promise<void> {
    // noWaitAfter: proxy lento em drivers.uber.com / deliver trava o click() padrão.
    await ctx.human.clickSafe(target, {
      timeout: config.timeouts.elementWait,
      noWaitAfter: true,
    });
    await page
      .waitForLoadState("domcontentloaded", { timeout: Math.min(config.timeouts.pageLoad, 30_000) })
      .catch(() => undefined);
    await ctx.human.pause(700, 1_600);
  }

  async function trySignupCtas(): Promise<boolean> {
    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
    await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
    await discardIfUberFatalBurnPage(page, ctx);
    await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);

    if (await cityVisible(3_000)) return true;

    // 1) Só Delivery (nunca Drive/rides genérico).
    const deliverLink = page
      .getByRole("link", { name: /sign up to deliver|deliver with uber|^deliver$|^delivery$/i })
      .or(page.getByRole("menuitem", { name: /deliver/i }))
      .or(page.getByRole("button", { name: /sign up to deliver|deliver with uber|^deliver$/i }))
      .or(page.locator('a[href*="/deliver"]'))
      .filter({ hasNotText: /drive with uber|^drive$/i });

    if (await deliverLink.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await clickAndSettle(deliverLink.first());
      await ctx.recordStep("EARNING_LOCATION_DELIVERY_CLICKED", { url: page.url() });
      await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
      await discardIfUberFatalBurnPage(page, ctx);
      await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
      if (await cityVisible(12_000)) return true;
    }

    // 2) CTAs de signup — EXCLUI "Get started" → drivers.uber.com/ (portal genérico).
    const deliverSignup = page
      .getByRole("link", { name: /sign up to deliver|start earning|apply to deliver|deliver with uber/i })
      .or(page.getByRole("button", { name: /sign up to deliver|start earning|apply to deliver|deliver with uber/i }))
      .or(
        page
          .locator('a[data-testid="button"], a[data-baseweb="button"], a.css-eNDRBa')
          .filter({ hasText: /sign up to deliver|start earning|get started/i })
          .filter({ has: page.locator('[href*="deliver"], [href*="earn"], [href*="drive-pref"]') }),
      );

    const candidates = deliverSignup;
    const n = await candidates.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 6); i++) {
      const el = candidates.nth(i);
      if (!(await el.isVisible({ timeout: 800 }).catch(() => false))) continue;
      const href = (await el.getAttribute("href").catch(() => null)) ?? "";
      // Portal genérico drivers.uber.com/ não abre a tela de cidade.
      if (/^https?:\/\/drivers\.uber\.com\/?$/i.test(href.trim())) {
        continue;
      }
      await clickAndSettle(el);
      await ctx.recordStep("EARNING_LOCATION_SIGNUP_CTA_CLICKED", { url: page.url(), href });
      await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
      await discardIfUberFatalBurnPage(page, ctx);
      await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
      if (await cityVisible(15_000)) return true;
    }

    return false;
  }

  await softGoto(page, config.marketingBaseUrl, navTimeout);
  await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
  await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
  await discardIfUberFatalBurnPage(page, ctx);
  await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);

  if (await cityVisible(5_000)) return true;

  // Earn no topo da página (header/nav) — não ir direto em /deliver.
  const header = page.locator("header, [role='banner'], nav").first();
  const earnNav = header
    .getByRole("link", { name: /^earn$/i })
    .or(header.getByRole("button", { name: /^earn$/i }))
    .or(header.getByText(/^earn$/i))
    .or(page.getByRole("link", { name: /^earn$/i }))
    .or(page.getByRole("button", { name: /^earn$/i }));

  const earnVisible = await earnNav.first().isVisible({ timeout: 10_000 }).catch(() => false);
  if (earnVisible) {
    await ctx.human.clickSafe(earnNav.first(), {
      timeout: config.timeouts.elementWait,
      noWaitAfter: true,
    });
    await ctx.human.pause(900, 2_000);
    await ctx.recordStep("EARNING_LOCATION_EARN_NAV_CLICKED", { url: page.url() });
    await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
    if (await cityVisible(20_000)) return true;
    if (await trySignupCtas()) return true;
  } else {
    // Conta logada: marketing redireciona p/ start-earning sem menu Earn.
    await ctx.recordStep("EARNING_LOCATION_EARN_NAV_MISSING", { url: page.url() });
    if (await trySignupCtas()) return true;
  }

  // Deep links conhecidos (delivery / start earning).
  const fallbackUrls = [
    "https://www.uber.com/us/en/drive/delivery/",
    "https://www.uber.com/us/en/deliver/",
    "https://www.uber.com/go/drive-pref",
  ];
  for (const url of fallbackUrls) {
    await softGoto(page, url, navTimeout);
    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
    await discardIfUberFatalBurnPage(page, ctx);
    await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
    if (await cityVisible(10_000)) {
      await ctx.recordStep("EARNING_LOCATION_DEEP_LINK", { url: page.url(), via: url });
      return true;
    }
    if (await trySignupCtas()) {
      await ctx.recordStep("EARNING_LOCATION_DEEP_LINK", { url: page.url(), via: url });
      return true;
    }
  }

  return cityVisible(5_000);
}

/**
 * Passo 10: "Earn with Uber" / "Where would you like to earn?".
 * Escolhe a próxima cidade do rodízio (não fica na pré-preenchida do IP).
 * Dispensa cookies e clica Next.
 *
 * Espera a UI de cidade (spinner pós-gênero). Se não aparecer:
 * uber.com → Earn (topo) → Delivery.
 */
export async function confirmEarningLocationStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  const navTimeout = Math.max(config.timeouts.pageLoad, 45_000);

  // Só heading/copy da tela Earn — NÃO usar input/city genérico (bate em
  // My Profile → Language / Address e deixa Next forever disabled).
  const earnCityUi = () =>
    page
      .getByRole("heading", { name: /earn with uber/i })
      .or(page.getByText(/where would you like to earn/i));

  async function waitForCityUi(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await earnCityUi().first().isVisible({ timeout: 600 }).catch(() => false)) {
        return true;
      }
      await page.waitForTimeout(700);
    }
    return false;
  }

  async function selectEarnCity(city: string): Promise<void> {
    // Escopo na tela Earn (nunca Language/Address do My Profile).
    const earnScope = page
      .locator("section, form, main, [role='main'], div")
      .filter({ has: page.getByText(/where would you like to earn/i) })
      .first();

    const cityInput = earnScope
      .locator("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])")
      .first();

    await cityInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await ctx.human.type(cityInput, city, {
      timeout: config.timeouts.elementWait,
      delayMs: { min: 40, max: 130 },
    });
    await ctx.human.pause(700, 1_400);

    const cityCore = city.split(",")[0]!.trim();
    const cityEsc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const coreEsc = cityCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Autocomplete Uber: "Rochester, NY, USA" — precisa CLICAR a opção;
    // só digitar deixa o Next disabled.
    const option = page
      .getByRole("option", { name: new RegExp(`${coreEsc}.*USA|${cityEsc}`, "i") })
      .or(page.locator('[role="listbox"] [role="option"]').filter({ hasText: new RegExp(coreEsc, "i") }))
      .or(page.locator('[data-baseweb="menu"] li, [data-baseweb="popover"] li').filter({ hasText: new RegExp(coreEsc, "i") }))
      .or(page.getByText(new RegExp(`^${cityEsc},?\\s*USA$`, "i")))
      .or(page.getByText(new RegExp(`^${cityEsc}$`, "i")));

    const optionVisible = await option.first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (!optionVisible) {
      throw new AutomationTechnicalError(
        "ELEMENT_NOT_FOUND",
        `Autocomplete de cidade não listou opção para "${city}"`,
      );
    }
    await ctx.human.clickSafe(option.first(), { timeout: config.timeouts.elementWait });
    await ctx.human.pause(400, 1_000);

    // Confirma que a sugestão fechou / valor ficou selecionado.
    await page
      .locator('[role="listbox"]')
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => undefined);
  }

  try {
    await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
    await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
    await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);

    // Pós-gênero a Uber costuma demorar no spinner antes da cidade.
    let onEarn = await waitForCityUi(45_000);

    if (!onEarn) {
      await ctx.recordStep("EARNING_LOCATION_MISSING", { url: page.url() });
      onEarn = await openEarnCityViaMarketingNav(ctx);
    }

    if (!onEarn) {
      await softGoto(page, config.driversBaseUrl, navTimeout);
      await dismissCookieBannerIfPresent(page, config.timeouts.elementWait);
      await dismissUberSorryErrorIfPresent(page, config.timeouts.elementWait);
      await dismissEarnEducationInterstitialIfPresent(page, config.timeouts.elementWait);
      onEarn = await waitForCityUi(30_000);
    }

    if (!onEarn) {
      await discardIfUberFatalBurnPage(page, ctx);
      throw new AutomationTechnicalError(
        "ELEMENT_TIMEOUT",
        "Tela de cidade (Earn with Uber) não apareceu — retentar",
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

    // Next só habilita depois de selecionar opção do autocomplete.
    const enabledDeadline = Date.now() + Math.max(config.timeouts.elementWait, 20_000);
    while (Date.now() < enabledDeadline) {
      if (await nextButton.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(400);
    }
    if (!(await nextButton.isEnabled().catch(() => false))) {
      throw new AutomationTechnicalError(
        "ELEMENT_TIMEOUT",
        `Next da cidade ainda disabled após selecionar "${city}" — retentar`,
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
  await softGoto(page, config.profileUrl, Math.max(config.timeouts.pageLoad, 45_000));
  const documentsTab = page.getByRole("tab", { name: /^documents$/i }).or(page.getByText(/^documents$/i));
  if ((await documentsTab.count().catch(() => 0)) > 0) {
    await documentsTab.first().click({ timeout: config.timeouts.elementWait }).catch(() => undefined);
  }
  await page
    .getByText(/driver requirements|documents|welcome/i)
    .first()
    .waitFor({ state: "visible", timeout: config.timeouts.pageLoad })
    .catch(() => undefined);
}

/**
 * Se Documents não listar CNH/foto: uber.com → Earn → cidade → Delivery →
 * background → profile. Só retorna true quando a lista tiver itens.
 */
export async function ensureDriverDocsViaEarnIfNeeded(ctx: RealStepContext): Promise<void> {
  const { page } = ctx;
  await openDocumentsTab(ctx);

  const deadlineQuick = Date.now() + 12_000;
  while (Date.now() < deadlineQuick) {
    if (await hasDriverDocumentEntries(page, 600)) return;
    await page.waitForTimeout(700);
  }

  await ctx.recordStep("DRIVER_DOCS_EMPTY_RERUN_EARN", { url: page.url() });
  // Conta já existe: só Earn→cidade→Delivery→hub (gênero já foi).
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

  // Espera hub Documents / Welcome / Driver requirements.
  const hubUi = page
    .getByText(/driver requirements/i)
    .or(page.getByRole("tab", { name: /^documents$/i }))
    .or(page.getByRole("heading", { name: /welcome/i }))
    .or(page.getByText(/add my vehicle/i));
  await hubUi.first().waitFor({ state: "visible", timeout: 45_000 }).catch(() => undefined);

  await ctx.recordStep("BACKGROUND_CHECK_SKIPPED", {
    detectedBackgroundOrSsn: onBackground,
    url: page.url(),
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
