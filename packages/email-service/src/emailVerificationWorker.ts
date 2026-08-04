import { CredentialVault } from "@uber-automation/credential-vault";
import { AuditLogger, maskCode, maskEmail } from "@uber-automation/security";
import { extractVerificationCode } from "./codeExtractor";
import { DrizzleEmailAccountRepository } from "./emailAccountRepository.drizzle";
import { ImapEmailClient } from "./imapEmailClient";
import { resolveCatchallInboxEmail } from "./imapCatchallConfig";
import { resolveImapOptions } from "./imapProviderConfig";
import type {
  EmailAccountCredentialRecord,
  EmailAccountRepository,
} from "./emailAccountRepository";
import type {
  FindVerificationCodeContext,
  GmailSessionData,
  IEmailVerificationWorker,
  IGmailClient,
  ProxyConnectionOptions,
  SecurityChallengeResult,
  SecurityChallengeType,
  VerificationCodeResult,
} from "./types";
import { SecurityChallengeError, VerificationCodeNotFoundError } from "./types";

export interface BrowserProfileHooks {
  loadGmailSession(applicantId: string): Promise<GmailSessionData | undefined>;
  saveGmailSession(applicantId: string, session: GmailSessionData): Promise<void>;
  lockOnSecurityChallenge(applicantId: string, reason: string): Promise<void>;
}

export interface EmailClientFactoryContext {
  provider: string;
  emailAddress: string;
}

export interface EmailVerificationWorkerOptions {
  /** Recebe o provider da conta para escolher host IMAP (gmail, spacemail, etc). */
  gmailClientFactory?: (context: EmailClientFactoryContext) => IGmailClient;
  emailAccountRepository?: EmailAccountRepository;
  vault?: CredentialVault;
  auditLogger?: AuditLogger;
  companyId?: string;
  browserProfileHooks?: BrowserProfileHooks;
  resolveProxyConnection?: (proxyId: string) => Promise<ProxyConnectionOptions | undefined>;
  /**
   * Salva em disco a screenshot best-effort tirada quando o login/busca
   * falha (ex: Gmail bloqueando o login automatizado) - injetado porque
   * este pacote não conhece o filesystem/caminho de screenshots do worker
   * (ver captureDebugScreenshot em apps/worker/src/uberAutomationRunner.ts).
   */
  captureDebugScreenshot?: (applicantId: string, buffer: Buffer) => Promise<string | undefined>;
  /**
   * Quanto tempo total esperar o e-mail da Uber chegar no IMAP antes de
   * desistir (polling). O e-mail costuma atrasar alguns segundos; sem
   * isso a 1ª busca falha e as retentativas da fila ainda descartam o
   * código se regenerarem `requestedAt`.
   */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

const SEARCH_WINDOW_MAX_RESULTS = 20;
const DEFAULT_POLL_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Erros de socket IMAP que valem reconnect em vez de falha definitiva. */
function isTransientImapError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return /ETIMEDOUT|ECONNRESET|EPIPE|ENETUNREACH|EHOSTUNREACH|socket|not available|Connection closed|Unexpected socket/i.test(
    `${code} ${message}`,
  );
}

/**
 * Acessa o Gmail do motorista para recuperar o codigo de confirmacao
 * enviado durante o cadastro administrativo. Autentica com as credenciais
 * reais do motorista (nunca simula ou contorna autenticacao), para
 * imediatamente diante de 2FA/CAPTCHA/confirmacao de telefone, e nunca
 * persiste o codigo completo em nenhum lugar - ele so existe em memoria
 * durante a chamada e e retornado ao chamador (worker de automacao), que e
 * responsavel por usa-lo imediatamente e nao grava-lo no banco.
 */
export class EmailVerificationWorker implements IEmailVerificationWorker {
  private readonly gmailClientFactory: (context: EmailClientFactoryContext) => IGmailClient;
  private readonly emailAccountRepository: EmailAccountRepository;
  private readonly vault: CredentialVault;
  private readonly auditLogger: AuditLogger;
  private readonly companyId?: string;
  private readonly browserProfileHooks?: BrowserProfileHooks;
  private readonly resolveProxyConnection?: (
    proxyId: string,
  ) => Promise<ProxyConnectionOptions | undefined>;
  private readonly captureDebugScreenshot?: (
    applicantId: string,
    buffer: Buffer,
  ) => Promise<string | undefined>;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(options: EmailVerificationWorkerOptions = {}) {
    // IMAP (não a antiga automação via navegador/PlaywrightGmailClient) é o
    // padrão. Host/porta vêm do `provider` da conta (gmail, spacemail, etc) -
    // ver imapProviderConfig.ts. PlaywrightGmailClient continua exportado,
    // só não é mais o default.
    this.gmailClientFactory =
      options.gmailClientFactory ??
      (({ provider }) => new ImapEmailClient(resolveImapOptions(provider)));
    this.emailAccountRepository =
      options.emailAccountRepository ?? new DrizzleEmailAccountRepository();
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.vault =
      options.vault ??
      new CredentialVault({ auditLogger: this.auditLogger, companyId: options.companyId });
    this.companyId = options.companyId;
    this.browserProfileHooks = options.browserProfileHooks;
    this.resolveProxyConnection = options.resolveProxyConnection;
    this.captureDebugScreenshot = options.captureDebugScreenshot;
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async handleSecurityChallenge(
    challenge: SecurityChallengeType,
  ): Promise<SecurityChallengeResult> {
    const reason = describeChallenge(challenge);
    await this.auditLogger.log({
      companyId: this.companyId ?? "unknown",
      action: "email_security_challenge_detected",
      metadata: { challenge, reason },
    });
    return { status: "PAUSED", reason };
  }

  async findVerificationCode(
    context: FindVerificationCodeContext,
  ): Promise<VerificationCodeResult> {
    const logicalAccount = await this.emailAccountRepository.getById(context.emailAccountId);
    if (!logicalAccount) {
      throw new Error("Conta de e-mail não encontrada");
    }

    // Domínios catch-all (ex: @mail2too.com): OTP chega na caixa compartilhada
    // (galldelivery), não na conta do alias usado no signup da Uber.
    const imapAccount = await this.resolveImapAccount(logicalAccount);

    let password: string | undefined = await this.vault.decrypt(
      {
        ciphertext: imapAccount.encryptedPassword,
        iv: imapAccount.encryptionIv,
        authTag: imapAccount.encryptionAuthTag,
        algorithm: "AES-256-GCM",
      },
      { applicantId: imapAccount.applicantId },
      imapAccount.id,
    );

    const proxy = this.resolveProxyConnection
      ? await this.resolveProxyConnection(context.proxyId)
      : undefined;
    const session = this.browserProfileHooks
      ? await this.browserProfileHooks.loadGmailSession(context.applicantId)
      : undefined;

    const client = this.gmailClientFactory({
      provider: imapAccount.provider,
      emailAddress: imapAccount.emailAddress,
    });

    try {
      await client.login(imapAccount.emailAddress, password, { proxy, session });

      const challenge = await client.detectSecurityChallenge();
      if (challenge) {
        await this.emailAccountRepository.markRequiresHumanAction(
          imapAccount.id,
          "REQUIRES_2FA",
        );
        if (this.browserProfileHooks) {
          await this.browserProfileHooks.lockOnSecurityChallenge(context.applicantId, challenge);
        }
        const result = await this.handleSecurityChallenge(challenge);
        throw new SecurityChallengeError(challenge, result.reason);
      }

      await this.emailAccountRepository.recordLoginResult(imapAccount.id, "VALID");
      await this.auditLogger.log({
        companyId: this.companyId ?? logicalAccount.companyId,
        applicantId: context.applicantId,
        action: "email_login_succeeded",
        metadata: {
          emailAccountId: context.emailAccountId,
          imapEmailAccountId: imapAccount.id,
          email: maskEmail(logicalAccount.emailAddress),
          imapEmail: maskEmail(imapAccount.emailAddress),
          catchall: imapAccount.id !== logicalAccount.id,
          provider: imapAccount.provider,
        },
      });

      const pollTimeoutMs = context.pollTimeoutMs ?? this.pollTimeoutMs;
      const pollIntervalMs = context.pollIntervalMs ?? this.pollIntervalMs;
      const deadline = Date.now() + Math.max(0, pollTimeoutMs);
      let attempt = 0;
      let lastMessagesScanned = 0;

      while (true) {
        attempt += 1;
        let messages;
        try {
          messages = await client.searchMessages({
            afterDate: context.requestedAt,
            maxResults: SEARCH_WINDOW_MAX_RESULTS,
          });
        } catch (error) {
          // Spacemail às vezes derruba o TLS no meio do poll (ETIMEDOUT).
          // Reconecta e segue até o deadline em vez de matar o worker.
          if (!isTransientImapError(error) || Date.now() >= deadline || !password) {
            throw error;
          }
          await this.auditLogger.log({
            companyId: this.companyId ?? logicalAccount.companyId,
            applicantId: context.applicantId,
            action: "email_imap_reconnect",
            metadata: {
              emailAccountId: context.emailAccountId,
              attempt,
              error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
            },
          });
          await client.close().catch(() => undefined);
          await client.login(imapAccount.emailAddress, password, { proxy, session });
          const remainingAfterReconnect = deadline - Date.now();
          if (remainingAfterReconnect <= 0) break;
          await sleep(Math.min(pollIntervalMs, remainingAfterReconnect));
          continue;
        }
        lastMessagesScanned = messages.length;

        await this.auditLogger.log({
          companyId: this.companyId ?? logicalAccount.companyId,
          applicantId: context.applicantId,
          action: "email_verification_code_requested",
          metadata: {
            emailAccountId: context.emailAccountId,
            imapEmailAccountId: imapAccount.id,
            messagesScanned: messages.length,
            attempt,
          },
        });

        const candidate = extractVerificationCode(messages, {
          requestedAt: context.requestedAt,
          expectedSender: context.expectedSender,
          expectedRecipient: logicalAccount.emailAddress,
          usedCodes: context.usedCodes ? new Set(context.usedCodes) : undefined,
        });

        if (candidate) {
          await this.auditLogger.log({
            companyId: this.companyId ?? logicalAccount.companyId,
            applicantId: context.applicantId,
            action: "email_verification_code_located",
            metadata: {
              emailAccountId: context.emailAccountId,
              imapEmailAccountId: imapAccount.id,
              maskedCode: maskCode(candidate.code),
              confidence: candidate.confidence,
              attempt,
            },
          });

          if (this.browserProfileHooks) {
            const savedSession = await client.saveSession();
            await this.browserProfileHooks.saveGmailSession(context.applicantId, savedSession);
          }

          return { code: candidate.code, confidence: candidate.confidence };
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(pollIntervalMs, remaining));
      }

      throw new VerificationCodeNotFoundError(
        `Nenhum código de verificação elegível foi encontrado após ${attempt} tentativa(s) IMAP (${lastMessagesScanned} mensagem(ns) na última varredura)`,
      );
    } catch (error) {
      if (this.captureDebugScreenshot && client.screenshot) {
        const buffer = await client.screenshot().catch(() => undefined);
        const screenshotPath = buffer
          ? await this.captureDebugScreenshot(context.applicantId, buffer).catch(() => undefined)
          : undefined;
        if (screenshotPath && error instanceof Error) {
          error.message += ` [screenshot: ${screenshotPath}]`;
        }
      }
      throw error;
    } finally {
      password = undefined;
      await client.close();
    }
  }

  /**
   * Conta cujas credenciais IMAP devem ser usadas. Em catch-all, aponta
   * para a caixa compartilhada; senão a própria conta do motorista.
   */
  private async resolveImapAccount(
    logicalAccount: EmailAccountCredentialRecord,
  ): Promise<EmailAccountCredentialRecord> {
    const catchallEmail = resolveCatchallInboxEmail(logicalAccount.emailAddress);
    if (!catchallEmail) return logicalAccount;

    const inbox = await this.emailAccountRepository.getByCompanyAndEmail(
      logicalAccount.companyId,
      catchallEmail,
    );
    if (!inbox) {
      throw new Error(
        `Caixa catch-all IMAP "${catchallEmail}" não cadastrada nesta empresa (necessária para ler OTP de ${logicalAccount.emailAddress})`,
      );
    }
    return inbox;
  }
}

function describeChallenge(challenge: SecurityChallengeType): string {
  switch (challenge) {
    case "TWO_FACTOR":
      return "Gmail solicitou verificação em duas etapas - requer conclusão manual pelo motorista";
    case "CAPTCHA":
      return "Gmail apresentou um CAPTCHA - requer conclusão manual pelo motorista";
    case "PHONE_VERIFICATION":
      return "Gmail solicitou confirmação por telefone - requer conclusão manual pelo motorista";
    case "AUTOMATION_BLOCKED":
      return "Google recusou o login por detectar navegador automatizado (\"Couldn't sign you in\") - não deve ser contornado; peça ao motorista/atendente para pegar o código de verificação manualmente";
    default:
      return "Desafio de segurança desconhecido - requer conclusão manual pelo motorista";
  }
}
