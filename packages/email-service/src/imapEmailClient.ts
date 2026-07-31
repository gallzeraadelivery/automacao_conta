import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type {
  GmailMessage,
  GmailSessionData,
  IGmailClient,
  ProxyConnectionOptions,
  SecurityChallengeType,
} from "./types";

export interface ImapEmailClientOptions {
  host?: string;
  port?: number;
}

const DEFAULT_HOST = "imap.gmail.com";
const DEFAULT_PORT = 993;

/**
 * Lê o código de verificação via IMAP (protocolo oficial de e-mail) em vez
 * de simular a tela de login do Gmail num navegador - evita por completo a
 * detecção de automação do Google ("Couldn't sign you in", ver
 * playwrightGmailClient.ts), que bloqueava o login headless mesmo com
 * seletor/timeout corretos. Confirmado manualmente (Mail.app do macOS,
 * conta @colsced.us real): essas contas aceitam login IMAP com a senha
 * normal, sem exigir senha de app específica.
 *
 * Sem `session`/`proxy`: IMAP não tem cookies/localStorage de navegador
 * pra restaurar, e a leitura do e-mail não precisa do mesmo proxy usado na
 * automação da Uber (são sistemas completamente diferentes - Google não
 * tem como saber, nem importa, de qual IP o e-mail foi lido).
 */
export class ImapEmailClient implements IGmailClient {
  private readonly host: string;
  private readonly port: number;
  private client?: ImapFlow;

  constructor(options: ImapEmailClientOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
  }

  async login(
    email: string,
    password: string,
    _options: { proxy?: ProxyConnectionOptions; session?: GmailSessionData },
  ): Promise<void> {
    this.client = new ImapFlow({
      host: this.host,
      port: this.port,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
    });
    await this.client.connect();
  }

  async detectSecurityChallenge(): Promise<SecurityChallengeType | null> {
    // IMAP não tem tela pra classificar - uma senha errada ou exigência de
    // senha de app já falha direto em login(), como um erro técnico comum.
    return null;
  }

  async searchMessages(query: { afterDate: Date; maxResults?: number }): Promise<GmailMessage[]> {
    if (!this.client) {
      throw new Error("Cliente IMAP não está autenticado (chame login() primeiro)");
    }

    const maxResults = query.maxResults ?? 20;
    const lock = await this.client.getMailboxLock("INBOX");
    try {
      const uids = await this.client.search({ since: query.afterDate }, { uid: true });
      const recentUids = (uids || []).slice(-maxResults).reverse();
      if (recentUids.length === 0) return [];

      const messages: GmailMessage[] = [];
      for await (const message of this.client.fetch(recentUids, { source: true }, { uid: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        messages.push({
          id: String(message.uid),
          from: parsed.from?.value[0]?.address ?? "",
          subject: parsed.subject ?? "",
          snippet: "",
          bodyText: parsed.text ?? "",
          receivedAt: parsed.date ?? new Date(),
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async saveSession(): Promise<GmailSessionData> {
    return { cookies: [], localStorage: {} };
  }

  async close(): Promise<void> {
    await this.client?.logout().catch(() => undefined);
    this.client = undefined;
  }
}
