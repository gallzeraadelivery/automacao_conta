/**
 * Nomes das filas BullMQ. Os processors reais (preenchimento administrativo,
 * leitura de codigo no Gmail, deteccao de provedor de verificacao) sao
 * implementados a partir da Fase 3, usando @uber-automation/automation e
 * @uber-automation/email-service. Nenhum job aqui deve resolver CAPTCHA,
 * simular prova de vida ou avancar etapas de verificacao de identidade.
 */
export const QUEUE_NAMES = {
  APPLICANT_REGISTRATION: "applicant-registration",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
