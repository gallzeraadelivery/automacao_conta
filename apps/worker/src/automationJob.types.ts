export type PlatformAdapter = "uber";

/**
 * Blob de credencial ja criptografada por @uber-automation/credential-vault
 * (mesmo formato usado por email_accounts/proxy_configs) - o payload do job
 * so carrega o ciphertext, nunca a senha em texto puro. So e descriptografado
 * em memoria dentro de LoginStep (packages/platform-adapters), na mesma
 * empresa/applicantId usados para criptografar.
 */
export interface EncryptedCredentialPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
}

export interface ApplicantAutomationDataPayload {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  vehicleType: string;
}

/**
 * Payload de um job na fila `automation-jobs`. `createdAt` trafega como
 * string ISO porque o BullMQ serializa `job.data` como JSON via Redis
 * (um `Date` nao sobrevive ao round-trip).
 */
export interface AutomationJob {
  companyId: string;
  applicantId: string;
  /**
   * Resolvido pelo proprio worker via BrowserProfileManager no inicio da
   * execucao (Fase 7) - nao e conhecido no momento em que a API enfileira o
   * job, por isso e opcional aqui.
   */
  browserProfileId?: string;
  emailAccountId: string;
  proxyId: string;
  platformAdapter: PlatformAdapter;
  currentStep: string;
  retryCount: number;
  createdAt: string;
  /** Presentes apenas quando currentStep === RUN_ADMINISTRATIVE_FLOW. */
  applicantData?: ApplicantAutomationDataPayload;
  platformCredential?: EncryptedCredentialPayload;
}

export const AUTOMATION_STEPS = {
  AWAIT_EMAIL_CODE: "AWAIT_EMAIL_CODE",
  /**
   * Roda a sessao completa de navegador (login -> formulario -> verificacao
   * de e-mail -> avanca ate uma etapa sensivel ou concluir) via
   * UberDriverApplicationAdapter (Fase 5) numa unica tentativa de job - o
   * proprio adaptador decide internamente quando pausar, nunca precisa ser
   * retomado no meio por steps externos.
   */
  RUN_ADMINISTRATIVE_FLOW: "RUN_ADMINISTRATIVE_FLOW",
  /**
   * Abre Chromium headed com proxy + cookies do perfil para o operador
   * continuar manualmente (SMS etc.). Não conclui o cadastro sozinho.
   */
  OPEN_MANUAL_BROWSER: "OPEN_MANUAL_BROWSER",
} as const;
