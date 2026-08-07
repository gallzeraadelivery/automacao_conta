import type { EncryptedCredential } from "@uber-automation/credential-vault";

export type AutomationStatus = "IDLE" | "RUNNING" | "PAUSED" | "CANCELLED" | "COMPLETED" | "ERROR";

export interface ApplicantAutomationData {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  vehicleType: string;
}

export interface AutomationContext {
  applicantId: string;
  browserProfileId: string;
  emailAccountId: string;
  proxyId: string;
  /**
   * Opcional: usado apenas para auditoria (AuditLogger exige `companyId`).
   * A automação em si nunca decide comportamento com base nele.
   */
  companyId?: string;
  applicantData: ApplicantAutomationData;
  /**
   * Credencial de login da própria plataforma (Uber), já criptografada via
   * `@uber-automation/credential-vault` - o briefing da Fase 5 não define de
   * onde vem a senha de login (o exemplo usa um placeholder `'temp-password'`
   * hardcoded). Seguindo o mesmo modelo já usado para contas de e-mail
   * (Fase 2), a senha nunca trafega em texto puro pelo contexto/fila - é
   * descriptografada em memória apenas dentro de `LoginStep`, e nunca é
   * logada ou persistida.
   */
  platformCredential: EncryptedCredential;
  /**
   * Deslocamento legado do placeholder (fallback se o pool não estiver
   * injetado). A alocação real usa o pool de números livres do worker.
   */
  phoneAttemptOffset?: number;
  /**
   * Placeholder que passou da etapa de telefone (senha) nesta execução.
   * Gravado no pool permanente ao chegar no hub/cidade.
   */
  assignedPlaceholderPhone?: string;
  /** Cidade do rodízio Earn escolhida nesta execução. */
  assignedEarnCity?: string;
  /**
   * Já houve `ACCOUNT_CREATED` para este motorista (audit). Não refazer
   * signup nem limpar cookies — só retomar hub bonjour.
   */
  uberAccountCreated?: boolean;
  /**
   * Já passou por `SERVICE_TYPE_SUBMITTED` (Delivery). Sem isso, hub
   * sozinho NÃO conta como conta Earn completa.
   */
  uberEarnSetupComplete?: boolean;
}

/**
 * Motivos de pausa não-retentável. Os valores desta lista foram escolhidos
 * para bater 1:1 com o subconjunto relevante de `NonRetryableReason` já
 * definido em `apps/worker/src/errors.ts` (Fase 2) - quando o worker passar a
 * chamar este adaptador (fase futura), o `pauseReason` devolvido aqui pode
 * ser usado diretamente para construir um `NonRetryableAutomationError`, sem
 * necessidade de tradução.
 */
export type AutomationPauseReason =
  | "IDENTITY_VERIFICATION_REQUIRED"
  | "NON_SOCURE_PROVIDER"
  | "CAPTCHA"
  | "TWO_FACTOR"
  | "SECURITY_BLOCK"
  /** Uber Internal Server Error / fluxo Delivery quebrado — descartar e-mail, sem retry. */
  | "REFUSED"
  /**
   * SMS rejeitado em 2 placeholders — para o job (FAILED) para tentar depois
   * com outros números; os rejeitados ficam na blacklist do pool.
   */
  | "PHONE_PROBLEM";

export type VerificationDetectedType =
  "PROFILE_PHOTO" | "DRIVER_LICENSE" | "CAPTCHA" | "TWO_FACTOR" | "SECURITY_BLOCK";

export interface VerificationDetectedInfo {
  type: VerificationDetectedType;
  /** Vem diretamente de `ProviderClassification` do verification-detector, ou 'UNKNOWN' para desafios sem provedor (CAPTCHA/2FA/bloqueio). */
  provider: string;
  confidence: string;
  /** Probe real: provedor da CNH (SOCURE / VERIFF / …). */
  driverLicenseProvider?: string;
  driverLicenseConfidence?: string;
  /** Probe real: provedor da foto de perfil. */
  profilePhotoProvider?: string;
  profilePhotoConfidence?: string;
}

export interface AutomationErrorInfo {
  code: string;
  message: string;
}

export interface AutomationResult {
  status: "SUCCESS" | "PAUSED" | "ERROR" | "VERIFICATION_DETECTED";
  currentStep: string;
  verificationDetected?: VerificationDetectedInfo;
  /** Preenchido quando status é 'PAUSED' ou 'VERIFICATION_DETECTED' - ver `AutomationPauseReason`. */
  pauseReason?: AutomationPauseReason;
  error?: AutomationErrorInfo;
}

export interface IPlatformAdapter {
  start(context: AutomationContext): Promise<AutomationResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  getCurrentStep(): string;
  getStatus(): AutomationStatus;
}

/**
 * Lançada internamente pelos steps de um adaptador para sinalizar uma pausa
 * não-retentável (etapa sensível detectada, ou desafio de segurança). Nunca
 * representa uma falha técnica - `PlatformAdapter.start()` a intercepta e
 * converte em um `AutomationResult` com status `PAUSED`/`VERIFICATION_DETECTED`.
 */
export class AutomationPauseSignal extends Error {
  readonly pauseReason: AutomationPauseReason;
  readonly verificationDetected?: VerificationDetectedInfo;

  constructor(
    pauseReason: AutomationPauseReason,
    verificationDetected?: VerificationDetectedInfo,
    detail?: string,
  ) {
    super(detail ?? `Automação pausada: ${pauseReason}`);
    this.name = "AutomationPauseSignal";
    this.pauseReason = pauseReason;
    this.verificationDetected = verificationDetected;
  }
}

/**
 * Lançada internamente por steps para falhas técnicas/transitórias
 * (timeout, elemento não encontrado, navegação falhou). `start()` a
 * converte em um `AutomationResult` com status `ERROR`.
 */
export class AutomationTechnicalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AutomationTechnicalError";
    this.code = code;
  }
}
