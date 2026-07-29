/**
 * Deteccao de qual provedor de verificacao de identidade (ex: Socure) a
 * plataforma apresentou para um candidato.
 *
 * Este pacote SOMENTE observa e classifica o que a plataforma exibe. Ele
 * nunca interage com, contorna ou altera a etapa de verificacao - a
 * automacao deve parar assim que uma etapa sensivel for detectada.
 */
export * from "./types";
export { VerificationFlowDetector } from "./verificationFlowDetector";
export { collectSignals, type Signal } from "./signals";
export { classifySignals, type ClassificationResult } from "./classifier";
export {
  classifyPageType,
  isCaptchaPage,
  isDriverLicensePage,
  isProfilePhotoPage,
  isSecurityBlockPage,
  isTwoFactorPage,
  isVerificationPage,
} from "./pageType";
export {
  SOCURE,
  UBER,
  KNOWN_OTHER_PROVIDERS,
  matchProviderByDomain,
  matchProviderByName,
  type ProviderDefinition,
} from "./providerRegistry";
export { extractDomain, extractTitle, extractScriptSrcs } from "./textUtils";
