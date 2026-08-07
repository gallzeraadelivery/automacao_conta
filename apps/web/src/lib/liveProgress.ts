/**
 * Rótulos PT-BR para `applicants.current_step` (progresso fino do job).
 * Mantido no web para não acoplar UI ao pacote database.
 */
export const LIVE_STEP_LABELS: Record<string, string> = {
  QUEUED: "Na fila (aguardando slot)",
  STARTING: "Iniciando tentativa",
  BROWSER: "Abrindo navegador",
  PORTAL: "Portal Uber aberto",
  IDENTIFIER: "E-mail enviado à Uber",
  EMAIL_IMAP: "Conectando na caixa de e-mail",
  EMAIL_CODE_WAIT: "Aguardando código no e-mail",
  EMAIL_CODE_FOUND: "Código de e-mail encontrado",
  EMAIL_VERIFIED: "E-mail verificado na Uber",
  PHONE: "Telefone placeholder enviado",
  PHONE_SMS_RETRY: "SMS no telefone — trocando número",
  PHONE_PROBLEM: "Problema celular — tentar depois",
  SESSION_ROTATE: "Reiniciando sessão (novo fingerprint/número)",
  PASSWORD: "Senha enviada",
  NAME: "Nome enviado",
  TERMS: "Termos aceitos",
  ACCOUNT_CREATED: "Conta criada",
  HUB: "Hub Uber (bonjour) — sessão ativa",
  GENDER: "Gênero / preferências",
  LOCATION: "Localização de ganhos",
  SERVICE: "Tipo de serviço",
  PROFILE: "Indo ao perfil",
  DRIVER_REQUIREMENTS: "Driver requirements (pausa)",
  COMPLETED: "Concluído",
  FAILED_ATTEMPT: "Tentativa falhou (pode retentar)",
  FAILED: "Falhou",
  RUN_ADMINISTRATIVE_FLOW: "Fluxo administrativo",
};

export function liveStepLabel(step: string | null | undefined): string {
  if (!step) return "-";
  return LIVE_STEP_LABELS[step] ?? step;
}

/** Status em que o painel deve auto-atualizar progresso. */
export function isLiveProgressStatus(status: string): boolean {
  return status === "IN_PROGRESS" || status === "QUEUED";
}
