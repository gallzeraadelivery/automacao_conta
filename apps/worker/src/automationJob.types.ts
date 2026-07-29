export type PlatformAdapter = "uber";

/**
 * Payload de um job na fila `automation-jobs`. `createdAt` trafega como
 * string ISO porque o BullMQ serializa `job.data` como JSON via Redis
 * (um `Date` nao sobrevive ao round-trip).
 */
export interface AutomationJob {
  companyId: string;
  applicantId: string;
  browserProfileId: string;
  emailAccountId: string;
  proxyId: string;
  platformAdapter: PlatformAdapter;
  currentStep: string;
  retryCount: number;
  createdAt: string;
}

export const AUTOMATION_STEPS = {
  AWAIT_EMAIL_CODE: "AWAIT_EMAIL_CODE",
} as const;
