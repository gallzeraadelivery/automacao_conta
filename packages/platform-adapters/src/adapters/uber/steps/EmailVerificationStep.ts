import {
  SecurityChallengeError,
  VerificationCodeNotFoundError,
} from "@uber-automation/email-service";
import { maskCode } from "@uber-automation/security";
import { toTechnicalError } from "../../errorMapping";
import type { StepContext } from "../../types";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../../types";
import type { UberAdapterConfig } from "../config";
import type { UberSelectors } from "../selectors";

/**
 * Solicita (quando aplicável), recupera via IEmailVerificationWorker (Fase
 * 2) e envia o código de confirmação de e-mail. O código nunca é gravado em
 * disco/fila/banco - existe só nesta função, em memória, e é mascarado
 * (`****XX`) antes de qualquer registro de auditoria.
 */
export async function runEmailVerificationStep(
  ctx: StepContext<UberAdapterConfig, UberSelectors>,
): Promise<void> {
  const { page, config, selectors, context, emailWorker } = ctx;

  if (selectors.emailVerification.requestCodeButton) {
    const requestButton = await page
      .$(selectors.emailVerification.requestCodeButton)
      .catch(() => null);
    if (requestButton) {
      try {
        await requestButton.click();
        await page.waitForTimeout(config.timeouts.actionDelay);
      } catch (error) {
        throw toTechnicalError(
          error,
          "ELEMENT_NOT_FOUND",
          "Falha ao solicitar o envio do código por e-mail",
        );
      }
    }
  }

  await ctx.recordStep("CODE_REQUESTED");

  let code: string;
  try {
    const result = await emailWorker.findVerificationCode({
      applicantId: context.applicantId,
      emailAccountId: context.emailAccountId,
      proxyId: context.proxyId,
      requestedAt: new Date(),
      expectedSender: config.expectedEmailSender,
    });
    code = result.code;
  } catch (error) {
    if (error instanceof SecurityChallengeError) {
      // Desafio de segurança no próprio Gmail (não na Uber) - nunca resolvido
      // aqui, só pausa. PHONE_VERIFICATION e AUTOMATION_BLOCKED não têm uma
      // categoria própria em AutomationPauseReason (que espelha o
      // NonRetryableReason do worker), então caem no bloqueio genérico.
      const reason =
        error.challenge === "PHONE_VERIFICATION" || error.challenge === "AUTOMATION_BLOCKED"
          ? "SECURITY_BLOCK"
          : error.challenge;
      throw new AutomationPauseSignal(reason);
    }
    if (error instanceof VerificationCodeNotFoundError) {
      // Transitório (o e-mail pode ainda não ter chegado) - o chamador
      // (worker, em fase futura) decide se tenta novamente.
      throw new AutomationTechnicalError("EMAIL_CODE_NOT_FOUND", error.message);
    }
    throw toTechnicalError(
      error,
      "EMAIL_CODE_RETRIEVAL_FAILED",
      "Falha ao buscar o código de verificação no e-mail",
    );
  }

  await ctx.recordStep("CODE_RETRIEVED", { maskedValue: maskCode(code) });

  try {
    await page.fill(selectors.emailVerification.codeInput, code, {
      timeout: config.timeouts.elementWait,
    });
    await page.click(selectors.emailVerification.submitButton, {
      timeout: config.timeouts.elementWait,
    });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(
      error,
      "ELEMENT_NOT_FOUND",
      "Falha ao preencher/enviar o código de verificação",
    );
  }

  await ctx.recordStep("EMAIL_VERIFIED");
}
