import { AutomationPauseSignal } from "../../../types";
import type { StepContext } from "../../types";
import { capturePageSnapshot } from "../pageIntrospection";
import type { UberAdapterConfig } from "../config";
import type { UberSelectors } from "../selectors";
import { pauseReasonForProvider } from "./verificationPause";

/**
 * Etapa sensível: NUNCA tira, envia ou anexa uma foto/selfie, nunca acessa
 * a câmera, nunca conclui a prova de vida. Apenas confirma (via
 * VerificationFlowDetector, Fase 4) qual provedor está processando esta
 * etapa - de forma puramente informativa - e sempre pausa a automação para
 * o motorista concluir pessoalmente. Ver regras de segurança obrigatórias
 * no README do pacote.
 */
export async function runProfilePhotoStep(
  ctx: StepContext<UberAdapterConfig, UberSelectors>,
): Promise<never> {
  const { page, detector } = ctx;
  const snapshot = await capturePageSnapshot(page);

  const result = await detector.detectProfilePhotoProvider({ page, ...snapshot });

  await ctx.recordStep("VERIFICATION_DETECTED", {
    verificationType: "PROFILE_PHOTO",
    provider: result.provider,
    confidence: result.confidence,
  });

  throw new AutomationPauseSignal(pauseReasonForProvider(result.provider), {
    type: "PROFILE_PHOTO",
    provider: result.provider,
    confidence: result.confidence,
  });
}
