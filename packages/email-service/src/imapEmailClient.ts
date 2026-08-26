import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
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
  /** Repassado direto pro `ImapFlow` - default da lib é 90s, longo demais pra um botão de teste interativo. */
  connectionTimeout?: number;
}

const DEFAULT_HOST = "imap.gmail.com";
const DEFAULT_PORT = 993;

/** Endereços de destino visíveis no envelope/cabeçalho (catch-all / forward). */
function collectRecipientAddresses(parsed: ParsedMail): string[] {
  const out = new Set<string>();
  for (const field of [parsed.to, parsed.cc, parsed.bcc]) {
    for (const entry of field?.value ?? []) {
      if (entry.address) out.add(entry.address.toLowerCase());
    }
  }
  const headerKeys = [
    "delivered-to",
    "x-delivered-to",
    "x-original-to",
    "envelope-to",
    "x-envelope-to",
    "x-forwarded-to",
    "x-rcpt-to",
  ];
  for (const key of headerKeys) {
    const raw = parsed.headers.get(key);
    if (!raw) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const text = String(value);
      for (const match of text.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) {
        out.add(match[0]!.toLowerCase());
      }
    }
  }
  return [...out];
}

/**
 * imapflow lança só "Command failed" na mensagem principal - o motivo de
 * verdade (ex: "AUTHENTICATIONFAILED Invalid credentials", ou um aviso de
 * throttling) fica em `responseText`/`responseStatus`, campos extras que
 * não aparecem em `error.message` por padrão. Sem isso, o log de auditoria
 * mostrava só "Command failed" e nada mais - inútil pra diagnosticar.
 */
function enrichImapError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const responseStatus = (error as { responseStatus?: string }).responseStatus;
  const responseText = (error as { responseText?: string }).responseText;
  if (responseStatus || responseText) {
    error.message = [error.message, responseStatus, responseText].filter(Boolean).join(" - ");
  }
  return error;
}

/**
 * Lista UIDs recentes do INBOX sem depender de SEARCH SINCE.
 * Spacemail (mail.spacemail.com) e outros IMAP pequenos frequentemente
 * devolvem lista vazia com `{ since: Date }` mesmo com mensagens no dia -
 * observado em produção (29 polls, 0 mensagens, e-mails Uber visíveis no
 * webmail). Preferimos:
 * 1) intervalo de sequência com base em `mailbox.exists`
 * 2) fallback `search({ all: true })` fatiando o fim
 * 3) último recurso: tentar SINCE (Gmail costuma respeitar)
 */
async function listRecentInboxUids(
  client: ImapFlow,
  limit: number,
  afterDate: Date,
): Promise<number[]> {
  const exists = client.mailbox && "exists" in client.mailbox ? Number(client.mailbox.exists) : 0;
  if (exists > 0) {
    const start = Math.max(1, exists - limit + 1);
    const uids: number[] = [];
    for await (const msg of client.fetch(`${start}:${exists}`, { uid: true })) {
      if (typeof msg.uid === "number") uids.push(msg.uid);
    }
    if (uids.length > 0) return uids.reverse();
  }

  const allUids = await client.search({ all: true }, { uid: true });
  if (allUids && allUids.length > 0) {
    return allUids.slice(-limit).reverse();
  }

  const sinceUids = await client.search({ since: afterDate }, { uid: true });
  return (sinceUids || []).slice(-limit).reverse();
}

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
  private readonly connectionTimeout?: number;
  private client?: ImapFlow;
  /** Último erro de socket emitido pelo ImapFlow (event 'error'). */
  private socketError?: Error;

  constructor(options: ImapEmailClientOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.connectionTimeout = options.connectionTimeout;
  }

  /**
   * Sem listener de 'error', o Node trata ETIMEDOUT/ECONNRESET do TLS como
   * unhandled e MATA o processo do worker (visto em produção Spacemail).
   * Aqui engolimos o event, guardamos o erro e falhamos a próxima operação
   * de forma controlada.
   */
  private bindClient(client: ImapFlow): void {
    this.socketError = undefined;
    this.client = client;
    client.on("error", (err: Error) => {
      this.socketError = enrichImapError(err);
    });
  }

  private throwIfSocketDead(): void {
    if (!this.socketError) return;
    const err = this.socketError;
    this.socketError = undefined;
    this.client = undefined;
    throw err;
  }

  async login(
    email: string,
    password: string,
    _options: { proxy?: ProxyConnectionOptions; session?: GmailSessionData },
  ): Promise<void> {
    await this.close().catch(() => undefined);

    const client = new ImapFlow({
      host: this.host,
      port: this.port,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
      connectionTimeout: this.connectionTimeout ?? 20_000,
      // Idle TLS sem resposta (Spacemail) → erro em vez de hang eterno.
      socketTimeout: 60_000,
      greetingTimeout: this.connectionTimeout ?? 20_000,
    } as ConstructorParameters<typeof ImapFlow>[0]);

    this.bindClient(client);
    try {
      await client.connect();
      this.throwIfSocketDead();
    } catch (error) {
      this.client = undefined;
      throw enrichImapError(this.socketError ?? error);
    }
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
    this.throwIfSocketDead();

    const maxResults = query.maxResults ?? 20;
    // Busca um pouco mais que maxResults: o filtro afterDate é no cliente
    // (Spacemail e alguns IMAP devolvem [] com SEARCH SINCE).
    const fetchWindow = Math.max(maxResults * 3, 40);
    let lock: { release(): void } | undefined;
    try {
      lock = await this.client.getMailboxLock("INBOX");
      this.throwIfSocketDead();
      const recentUids = await listRecentInboxUids(this.client, fetchWindow, query.afterDate);
      this.throwIfSocketDead();
      if (recentUids.length === 0) return [];

      const messages: GmailMessage[] = [];
      for await (const message of this.client.fetch(recentUids, { source: true }, { uid: true })) {
        this.throwIfSocketDead();
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const receivedAt = parsed.date ?? new Date();
        // Folga de 2 min: skew de Date do servidor vs worker.
        if (receivedAt.getTime() < query.afterDate.getTime() - 120_000) {
          continue;
        }
        const toAddresses = collectRecipientAddresses(parsed);
        messages.push({
          id: String(message.uid),
          // address preferencial; se o provedor só mandar display-name
          // ("Uber"), cai no texto completo pra o filtro de domínio ainda
          // conseguir casar com uber.com quando o endereço vier no From.
          from:
            parsed.from?.value[0]?.address ??
            parsed.from?.text ??
            parsed.from?.value[0]?.name ??
            "",
          subject: parsed.subject ?? "",
          snippet: "",
          // Uber OTP: HTML com "Verification code:" longe do <p>8606</p>
          // (centenas de espaços/tags). Sem colapsar whitespace, o regex
          // \D{0,40} do extrator falha mesmo com o código no corpo.
          bodyText: (() => {
            const plain = parsed.text?.trim() ?? "";
            const fromHtml =
              typeof parsed.html === "string"
                ? parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
                : "";
            // Preferir HTML normalizado se o plain text não traz keyword+código.
            if (
              fromHtml &&
              (!plain || !/(?:c[oó]digo|code|otp|pin|verification)\D{0,40}\d{4}/i.test(plain))
            ) {
              return fromHtml;
            }
            return plain || fromHtml;
          })(),
          toAddresses,
          receivedAt,
        });
      }
      messages.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
      return messages.slice(0, maxResults);
    } catch (error) {
      throw enrichImapError(this.socketError ?? error);
    } finally {
      lock?.release();
    }
  }

  async saveSession(): Promise<GmailSessionData> {
    return { cookies: [], localStorage: {} };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.socketError = undefined;
    if (!client) return;
    await client.logout().catch(() => undefined);
    try {
      client.close();
    } catch {
      // conexão já morta após ETIMEDOUT
    }
  }
}
