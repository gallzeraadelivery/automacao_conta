/**
 * Acesso ao Gmail do motorista para recuperar codigos de confirmacao
 * enviados durante o cadastro administrativo.
 *
 * Usa apenas as credenciais fornecidas e criptografadas via
 * @uber-automation/credential-vault. Nunca envia mensagens, nunca altera
 * configuracoes da conta, nunca resolve CAPTCHA/2FA - para imediatamente e
 * devolve o controle para intervencao humana. O codigo encontrado nunca e
 * persistido no banco, apenas retornado em memoria ao chamador.
 */
export * from "./types";
export {
  extractVerificationCode,
  type CodeFilterCriteria,
  type CodeCandidate,
} from "./codeExtractor";
export {
  EmailVerificationWorker,
  type EmailVerificationWorkerOptions,
  type BrowserProfileHooks,
} from "./emailVerificationWorker";
export { PlaywrightGmailClient, GMAIL_SELECTORS } from "./playwrightGmailClient";
export type {
  EmailAccountRepository,
  EmailAccountCredentialRecord,
} from "./emailAccountRepository";
export { DrizzleEmailAccountRepository } from "./emailAccountRepository.drizzle";
