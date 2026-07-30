import type { ProviderClassification } from "@uber-automation/verification-detector";
import type { AutomationPauseReason } from "../../../types";

/**
 * SOCURE/OTHER_PROVIDER/UBER_INTERNAL/UNKNOWN pausam pelo mesmo motivo
 * genérico - é uma etapa de verificação de identidade, e a automação nunca
 * a conclui, seja qual for o provedor. NOT_SOCURE tem um motivo próprio: um
 * provedor diferente do esperado foi identificado com clareza, o que é
 * operacionalmente relevante (ex: sinalizar quando a Uber trocou de
 * fornecedor de verificação para uma fila de revisão específica).
 */
export function pauseReasonForProvider(provider: ProviderClassification): AutomationPauseReason {
  return provider === "NOT_SOCURE" ? "NON_SOCURE_PROVIDER" : "IDENTITY_VERIFICATION_REQUIRED";
}
