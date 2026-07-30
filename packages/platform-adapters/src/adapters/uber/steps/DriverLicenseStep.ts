import { AutomationPauseSignal } from "../../../types";
import type { StepContext } from "../../types";
import { capturePageSnapshot } from "../pageIntrospection";
import type { UberAdapterConfig } from "../config";
import type { UberSelectors } from "../selectors";
import { pauseReasonForProvider } from "./verificationPause";

/**
 * Etapa sensível: NUNCA envia ou anexa a CNH, nunca preenche um
 * `<input type="file">`. Apenas confirma (via VerificationFlowDetector,
 * Fase 4) qual provedor está processando esta etapa - de forma puramente
 * informativa - e sempre pausa a automação para o motorista concluir
 * pessoalmente. Ver regras de segurança obrigatórias no README do pacote.
 */
export async function runDriverLicenseStep(
  ctx: StepContext<UberAdapterConfig, UberSelectors>,
): Promise<never> {
  const { page, detector } = ctx;
  const snapshot = await capturePageSnapshot(page);

  const result = await detector.detectDriverLicenseProvider({ page, ...snapshot });

  await ctx.recordStep("VERIFICATION_DETECTED", {
    verificationType: "DRIVER_LICENSE",
    provider: result.provider,
    confidence: result.confidence,
  });

  throw new AutomationPauseSignal(pauseReasonForProvider(result.provider), {
    type: "DRIVER_LICENSE",
    provider: result.provider,
    confidence: result.confidence,
  });
}
