import { toTechnicalError } from "../../errorMapping";
import type { StepContext } from "../../types";
import type { UberAdapterConfig } from "../config";
import type { UberSelectors } from "../selectors";

/**
 * Login administrativo na plataforma: apenas e-mail e senha, nada relativo
 * a verificação de identidade. A senha vem de `context.platformCredential`
 * (já criptografada) e é descriptografada em memória, usada uma única vez
 * e nunca logada.
 */
export async function runLoginStep(
  ctx: StepContext<UberAdapterConfig, UberSelectors>,
): Promise<void> {
  const { page, config, selectors, context, vault } = ctx;

  let password: string;
  try {
    password = await vault.decrypt(context.platformCredential, {
      applicantId: context.applicantId,
    });
  } catch (error) {
    throw toTechnicalError(
      error,
      "MISSING_CREDENTIAL",
      "Falha ao descriptografar a credencial de login da plataforma",
    );
  }

  try {
    await page.goto(`${config.baseUrl}${config.endpoints.login}`, {
      timeout: config.timeouts.pageLoad,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    throw toTechnicalError(error, "PAGE_LOAD_TIMEOUT", "Falha ao carregar a página de login");
  }

  try {
    await page.fill(selectors.login.emailInput, context.applicantData.email, {
      timeout: config.timeouts.elementWait,
    });
    // A senha é usada uma única vez aqui e nunca retida em outra variável.
    await page.fill(selectors.login.passwordInput, password, {
      timeout: config.timeouts.elementWait,
    });
    await page.click(selectors.login.submitButton, { timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(
      error,
      "ELEMENT_NOT_FOUND",
      "Falha ao preencher/enviar o formulário de login",
    );
  }

  await ctx.recordStep("LOGIN_COMPLETE");
}
