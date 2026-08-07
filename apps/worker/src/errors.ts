/**
 * Motivos que NUNCA devem gerar nova tentativa automatica. Encontrar
 * qualquer um destes exige intervencao humana - o job e marcado como pausado
 * (nao como "falho"), sem consumir as tentativas restantes do BullMQ.
 */
export type NonRetryableReason =
  | "CAPTCHA"
  | "SECURITY_BLOCK"
  | "TWO_FACTOR"
  | "ACCOUNT_ALREADY_EXISTS"
  | "IDENTITY_VERIFICATION_REQUIRED"
  | "DOCUMENT_UPLOAD_REQUIRED"
  | "REFUSED"
  | "PHONE_PROBLEM"
  | "DATA_INCONSISTENCY"
  | "NON_SOCURE_PROVIDER"
  | "SUSPICIOUS_ACTIVITY";

export class NonRetryableAutomationError extends Error {
  readonly reason: NonRetryableReason;
  readonly providers?: {
    profilePhotoProvider?: string;
    profilePhotoConfidence?: string;
    driverLicenseProvider?: string;
    driverLicenseConfidence?: string;
  };

  constructor(
    reason: NonRetryableReason,
    message?: string,
    providers?: NonRetryableAutomationError["providers"],
  ) {
    super(message ?? reason);
    this.name = "NonRetryableAutomationError";
    this.reason = reason;
    this.providers = providers;
  }
}

/**
 * Motivos tecnicos/transitorios - elegveis para retentativa com backoff
 * progressivo (ate 3 tentativas).
 */
export type TechnicalReason =
  | "TIMEOUT"
  | "CONNECTION_FAILURE"
  | "PAGE_UNAVAILABLE"
  | "LOAD_ERROR"
  | "PROXY_UNAVAILABLE"
  | "PHONE_SMS_RETRY"
  | "EMAIL_CODE_RETRY";

export class TechnicalAutomationError extends Error {
  readonly reason: TechnicalReason;

  constructor(reason: TechnicalReason, message?: string) {
    super(message ?? reason);
    this.name = "TechnicalAutomationError";
    this.reason = reason;
  }
}

/** Operador clicou Parar / Parar todos — não retentar. */
export class AutomationStoppedError extends Error {
  constructor(message = "Automação interrompida pelo operador") {
    super(message);
    this.name = "AutomationStoppedError";
  }
}
