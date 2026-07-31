export type SecurityChallengeType = "TWO_FACTOR" | "CAPTCHA" | "PHONE_VERIFICATION";

export type CodeConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface FindVerificationCodeContext {
  applicantId: string;
  emailAccountId: string;
  proxyId: string;
  requestedAt: Date;
  expectedSender?: string;
}

export interface VerificationCodeResult {
  code: string;
  confidence: CodeConfidence;
}

export interface SecurityChallengeResult {
  status: "PAUSED";
  reason: string;
}

/**
 * Lançada quando o Gmail exige 2FA, CAPTCHA ou confirmação de telefone.
 * O worker NUNCA tenta resolver isso - ele para e devolve o controle para
 * intervenção humana. Consumidores (ex: a fila BullMQ) devem tratar esse
 * erro como não-retentável.
 */
export class SecurityChallengeError extends Error {
  readonly challenge: SecurityChallengeType;
  readonly reason: string;

  constructor(challenge: SecurityChallengeType, reason: string) {
    super(`Desafio de segurança detectado no Gmail: ${challenge} - ${reason}`);
    this.name = "SecurityChallengeError";
    this.challenge = challenge;
    this.reason = reason;
  }
}

/**
 * Lançada quando nenhum código elegível foi encontrado dentro da janela de
 * busca. Diferente de SecurityChallengeError - normalmente é transitório
 * (o e-mail ainda não chegou) e pode ser tentado novamente.
 */
export class VerificationCodeNotFoundError extends Error {
  constructor(message = "Nenhum código de verificação elegível foi encontrado") {
    super(message);
    this.name = "VerificationCodeNotFoundError";
  }
}

export interface IEmailVerificationWorker {
  findVerificationCode(context: FindVerificationCodeContext): Promise<VerificationCodeResult>;
  handleSecurityChallenge(challenge: SecurityChallengeType): Promise<SecurityChallengeResult>;
}

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  bodyText?: string;
  receivedAt: Date;
}

export interface ProxyConnectionOptions {
  server: string; // ex: "http://host:port"
  username?: string;
  password?: string;
}

export interface GmailSessionData {
  cookies: unknown[];
  localStorage: Record<string, string>;
}

/**
 * Abstrai a interação com o navegador/Gmail para que a lógica de
 * orquestração (EmailVerificationWorker) seja testável com um mock, sem
 * depender de um navegador real ou de uma conta Gmail real.
 */
export interface IGmailClient {
  login(
    email: string,
    password: string,
    options: { proxy?: ProxyConnectionOptions; session?: GmailSessionData },
  ): Promise<void>;
  detectSecurityChallenge(): Promise<SecurityChallengeType | null>;
  searchMessages(query: { afterDate: Date; maxResults?: number }): Promise<GmailMessage[]>;
  saveSession(): Promise<GmailSessionData>;
  close(): Promise<void>;
  /**
   * Screenshot da página atual, best-effort - opcional porque o mock usado
   * nos testes não tem página nenhuma. Sem isso, uma falha aqui (ex: Gmail
   * bloqueando o login automatizado) não deixava nenhum rastro visual,
   * diferente das falhas na automação principal (ver captureDebugScreenshot
   * em uberAutomationRunner.ts).
   */
  screenshot?(): Promise<Buffer | undefined>;
}
