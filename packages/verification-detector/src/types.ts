import type { Page } from "playwright";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * SOCURE / NOT_SOCURE: um provedor especifico foi identificado com clareza
 * (nome ou dominio bate). NOT_SOCURE cobre qualquer provedor nomeado que nao
 * seja a Socure (ex: IDology, Jumio, "Verificador XYZ").
 * OTHER_PROVIDER: ha evidencia de que NAO e a Uber nem a Socure processando
 * a etapa, mas o nome/dominio exato nao pode ser confirmado com confianca
 * alta (sinal fraco/generico).
 * UBER_INTERNAL: a propria Uber parece estar processando a etapa
 * diretamente (dominio uber.com, sem sinal de terceiro).
 * UNKNOWN: nao ha evidencia suficiente, ou os sinais sao conflitantes.
 */
export type ProviderClassification =
  "SOCURE" | "NOT_SOCURE" | "UBER_INTERNAL" | "OTHER_PROVIDER" | "UNKNOWN";

export type DetectionMethod =
  | "URL_DOMAIN"
  | "HTML_ATTRIBUTE"
  | "HTML_TITLE"
  | "HTML_TEXT"
  | "SCRIPT_NAME"
  | "RESOURCE_DOMAIN"
  | "NONE";

export interface VerificationDetectionContext {
  /**
   * Objeto Page do Playwright, se disponivel. O algoritmo de deteccao em si
   * nao chama nenhum metodo nele - opera inteiramente sobre url/html/
   * scripts/resources ja extraidos pelo chamador. Mantido no contexto para
   * compatibilidade com a interface e para uso futuro (ex: screenshot).
   */
  page?: Page | unknown;
  url: string;
  html: string;
  scripts: string[];
  resources: string[];
}

interface BaseVerificationResult {
  provider: ProviderClassification;
  confidence: Confidence;
  detectedDomain?: string;
  detectionMethod: DetectionMethod;
  signals: string[];
}

export interface ProfilePhotoVerificationResult extends BaseVerificationResult {
  type: "PROFILE_PHOTO_VERIFICATION";
}

export interface DriverLicenseVerificationResult extends BaseVerificationResult {
  type: "DRIVER_LICENSE_VERIFICATION";
}

export type VerificationResult = ProfilePhotoVerificationResult | DriverLicenseVerificationResult;

export type ChallengePageType = "CAPTCHA" | "TWO_FACTOR" | "SECURITY_BLOCK";

export type PageType = "PROFILE_PHOTO" | "DRIVER_LICENSE" | ChallengePageType | "UNKNOWN";

export interface IVerificationFlowDetector {
  detectProfilePhotoProvider(
    context: VerificationDetectionContext,
  ): Promise<ProfilePhotoVerificationResult>;

  detectDriverLicenseProvider(
    context: VerificationDetectionContext,
  ): Promise<DriverLicenseVerificationResult>;

  isVerificationPage(html: string): boolean;
  isProfilePhotoPage(html: string): boolean;
  isDriverLicensePage(html: string): boolean;
}
