import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal } from "../../../types";
import type { RealStepContext } from "../realStepContext";

/**
 * Passo 9 (PDF): "What's your gender?" - opção fixa (`config.genderOptionLabel`,
 * hoje "Man"), é um placeholder administrativo: o próprio motorista escolhe
 * o gênero real na finalização do cadastro (confirmado pelo usuário) - nunca
 * um dado definitivo inventado por este sistema.
 */
export async function selectGenderStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await page
      .getByText(new RegExp(`^${config.genderOptionLabel}$`, "i"))
      .click({ timeout: config.timeouts.elementWait });
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao selecionar gênero");
  }
  await ctx.recordStep("GENDER_SUBMITTED", { placeholder: true, value: config.genderOptionLabel });
}

/**
 * Passo 10 (PDF): "Where would you like to earn?" - o campo já vem
 * PRÉ-PREENCHIDO pela própria Uber (geolocalização por IP), então nada é
 * digitado aqui de propósito: como a sessão sempre passa pelo proxy do
 * motorista, o valor que a Uber detecta sozinha já reflete a região do
 * proxy usado - decisão explícita do usuário, evita fixar uma cidade
 * hardcoded para todo mundo. Campo "Referral code" fica em branco.
 */
export async function confirmEarningLocationStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao confirmar localização de ganhos");
  }
  await ctx.recordStep("EARNING_LOCATION_CONFIRMED");
}

/**
 * Passo 11 (PDF): "Choose how you want to earn with Uber" - sempre
 * "Delivery with car" (fixo, ver Notas Importantes do fluxo), independente
 * do `vehicleType` importado do motorista.
 */
export async function selectServiceTypeStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await page
      .getByText(new RegExp(`^${config.serviceTypeLabel}$`, "i"))
      .click({ timeout: config.timeouts.elementWait });
    await page
      .getByRole("button", { name: /^continue$/i })
      .click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao selecionar tipo de serviço");
  }
  await ctx.recordStep("SERVICE_TYPE_SUBMITTED", { value: config.serviceTypeLabel });
}

/**
 * Passo 12 (PDF): "Background check - Review the following disclosure" -
 * NUNCA clica em "Agree" (é um consentimento legal que cabe ao motorista
 * dar, não a este sistema) - em vez disso navega direto para o perfil,
 * exatamente como o PDF documenta.
 */
export async function skipBackgroundCheckStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await page.goto(config.profileUrl, {
      timeout: config.timeouts.pageLoad,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    throw toTechnicalError(error, "PAGE_LOAD_TIMEOUT", "Falha ao navegar para bonjour.uber.com/profile");
  }
  await ctx.recordStep("BACKGROUND_CHECK_SKIPPED");
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
