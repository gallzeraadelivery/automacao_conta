/**
 * Deteccao de qual provedor de verificacao de identidade (ex: Socure) a
 * plataforma apresentou para um candidato - implementado na Fase 4.
 *
 * Este pacote SOMENTE observa e classifica o que a plataforma exibe
 * (ex: profile_photo_provider, driver_license_provider em `applicants`).
 * Ele nunca interage com, contorna ou altera a etapa de verificacao -
 * a automacao deve parar assim que uma etapa sensivel for detectada.
 */
export const VERIFICATION_PROVIDERS = [
  "SOCURE",
  "NOT_SOCURE",
  "OTHER_PROVIDER",
  "UNKNOWN",
] as const;
export type VerificationProvider = (typeof VERIFICATION_PROVIDERS)[number];
