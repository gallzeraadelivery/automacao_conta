import { CredentialVault } from "@uber-automation/credential-vault";
import { AuditLogger, maskCode, maskEmail } from "@uber-automation/security";
import { extractVerificationCode } from "./codeExtractor";
import { DrizzleEmailAccountRepository } from "./emailAccountRepository.drizzle";
import { PlaywrightGmailClient } from "./playwrightGmailClient";
import type { EmailAccountRepository } from "./emailAccountRepository";
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

export interface EmailVerificationWorkerOptions {
  gmailClientFactory?: () => IGmailClient;
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
}

const SEARCH_WINDOW_MAX_RESULTS = 20;

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
  private readonly gmailClientFactory: () => IGmailClient;
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

  constructor(options: EmailVerificationWorkerOptions = {}) {
    this.gmailClientFactory = options.gmailClientFactory ?? (() => new PlaywrightGmailClient());
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
    const account = await this.emailAccountRepository.getById(context.emailAccountId);
    if (!account) {
      throw new Error("Conta de e-mail não encontrada");
    }

    let password: string | undefined = await this.vault.decrypt(
      {
        ciphertext: account.encryptedPassword,
        iv: account.encryptionIv,
        authTag: account.encryptionAuthTag,
        algorithm: "AES-256-GCM",
      },
      { applicantId: context.applicantId },
      context.emailAccountId,
    );

    const proxy = this.resolveProxyConnection
      ? await this.resolveProxyConnection(context.proxyId)
      : undefined;
    const session = this.browserProfileHooks
      ? await this.browserProfileHooks.loadGmailSession(context.applicantId)
      : undefined;

    const client = this.gmailClientFactory();

    try {
      await client.login(account.emailAddress, password, { proxy, session });
      // Melhor esforco: nao mantemos a senha em memoria alem do necessario.
      password = undefined;

      const challenge = await client.detectSecurityChallenge();
      if (challenge) {
        await this.emailAccountRepository.markRequiresHumanAction(
          context.emailAccountId,
          "REQUIRES_2FA",
        );
        if (this.browserProfileHooks) {
          await this.browserProfileHooks.lockOnSecurityChallenge(context.applicantId, challenge);
        }
        const result = await this.handleSecurityChallenge(challenge);
        throw new SecurityChallengeError(challenge, result.reason);
      }

      await this.emailAccountRepository.recordLoginResult(context.emailAccountId, "VALID");
      await this.auditLogger.log({
        companyId: this.companyId ?? "unknown",
        applicantId: context.applicantId,
        action: "email_login_succeeded",
        metadata: {
          emailAccountId: context.emailAccountId,
          email: maskEmail(account.emailAddress),
        },
      });

      const messages = await client.searchMessages({
        afterDate: context.requestedAt,
        maxResults: SEARCH_WINDOW_MAX_RESULTS,
      });

      await this.auditLogger.log({
        companyId: this.companyId ?? "unknown",
        applicantId: context.applicantId,
        action: "email_verification_code_requested",
        metadata: { emailAccountId: context.emailAccountId, messagesScanned: messages.length },
      });

      const candidate = extractVerificationCode(messages, {
        requestedAt: context.requestedAt,
        expectedSender: context.expectedSender,
      });

      if (!candidate) {
        throw new VerificationCodeNotFoundError();
      }

      await this.auditLogger.log({
        companyId: this.companyId ?? "unknown",
        applicantId: context.applicantId,
        action: "email_verification_code_located",
        metadata: {
          emailAccountId: context.emailAccountId,
          maskedCode: maskCode(candidate.code),
          confidence: candidate.confidence,
        },
      });

      if (this.browserProfileHooks) {
        const savedSession = await client.saveSession();
        await this.browserProfileHooks.saveGmailSession(context.applicantId, savedSession);
      }

      return { code: candidate.code, confidence: candidate.confidence };
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
}

function describeChallenge(challenge: SecurityChallengeType): string {
  switch (challenge) {
    case "TWO_FACTOR":
      return "Gmail solicitou verificação em duas etapas - requer conclusão manual pelo motorista";
    case "CAPTCHA":
      return "Gmail apresentou um CAPTCHA - requer conclusão manual pelo motorista";
    case "PHONE_VERIFICATION":
      return "Gmail solicitou confirmação por telefone - requer conclusão manual pelo motorista";
    default:
      return "Desafio de segurança desconhecido - requer conclusão manual pelo motorista";
  }
}
