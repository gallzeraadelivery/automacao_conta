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
  | "DATA_INCONSISTENCY"
  | "NON_SOCURE_PROVIDER"
  | "SUSPICIOUS_ACTIVITY";

export class NonRetryableAutomationError extends Error {
  readonly reason: NonRetryableReason;

  constructor(reason: NonRetryableReason, message?: string) {
    super(message ?? reason);
    this.name = "NonRetryableAutomationError";
    this.reason = reason;
  }
}

/**
 * Motivos tecnicos/transitorios - elegveis para retentativa com backoff
 * progressivo (ate 3 tentativas).
 */
export type TechnicalReason =
  "TIMEOUT" | "CONNECTION_FAILURE" | "PAGE_UNAVAILABLE" | "LOAD_ERROR" | "PROXY_UNAVAILABLE";

export class TechnicalAutomationError extends Error {
  readonly reason: TechnicalReason;

  constructor(reason: TechnicalReason, message?: string) {
    super(message ?? reason);
    this.name = "TechnicalAutomationError";
    this.reason = reason;
  }
}
