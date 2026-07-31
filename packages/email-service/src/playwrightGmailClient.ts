import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type {
  GmailMessage,
  GmailSessionData,
  IGmailClient,
  ProxyConnectionOptions,
  SecurityChallengeType,
} from "./types";

/**
 * IMPORTANTE - fronteira honesta desta implementação:
 *
 * Os seletores abaixo refletem a estrutura conhecida do Gmail no momento em
 * que este código foi escrito, mas o Gmail usa classes CSS ofuscadas que a
 * Google muda sem aviso. Além disso, automatizar login real na conta Google
 * de um ambiente headless/sandbox tende a disparar a própria detecção de
 * atividade suspeita da Google - que é EXATAMENTE o cenário em que este
 * worker deve parar (`detectSecurityChallenge` -> pausa), nunca contornar.
 * Por isso este cliente não pôde ser validado contra o Gmail real neste
 * ambiente. Antes de usar em produção: valide os seletores abaixo contra uma
 * conta de teste descartável, de preferência com Gmail API/OAuth2 (ver
 * comentário no fim do arquivo) em vez de scraping de UI, que é
 * inerentemente frágil.
 */
export const GMAIL_SELECTORS = {
  // "#identifierId" e o id do campo de e-mail na tela de login do Google ha
  // anos (bem mais estavel queso `input[type='email']`, que uma screenshot
  // de diagnostico mostrou nao bater a tempo numa execucao real via proxy -
  // combinar os dois cobre tanto a estrutura antiga quanto variacoes atuais).
  emailInput: "#identifierId, input[type='email']",
  emailNextButton: "#identifierNext",
  passwordInput: "input[type='password']",
  passwordNextButton: "#passwordNext",
  messageRow: "tr.zA",
  messageSender: "span.yP, span.zF",
  messageSubject: "span.bog",
  messageSnippet: "span.y2",
};

// Proxies (principalmente residenciais/rotativos) adicionam latencia real -
// ja observado nesta automacao em outra etapa (timeout de 30s so pra
// carregar drivers.uber.com). O timeout padrao do Playwright (30s) pode nao
// sobrar margem nenhuma depois do carregamento inicial da pagina do Google.
const ELEMENT_TIMEOUT_MS = 60000;

const CHALLENGE_URL_PATTERNS: Array<{ pattern: RegExp; type: SecurityChallengeType }> = [
  { pattern: /challenge\/totp/i, type: "TWO_FACTOR" },
  { pattern: /challenge\/ipp/i, type: "PHONE_VERIFICATION" },
  { pattern: /challenge\/az/i, type: "TWO_FACTOR" },
  { pattern: /challenge\/recaptcha/i, type: "CAPTCHA" },
  { pattern: /challenge\/selection/i, type: "TWO_FACTOR" },
  { pattern: /speedbump/i, type: "TWO_FACTOR" },
];

export class PlaywrightGmailClient implements IGmailClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  async login(
    email: string,
    password: string,
    options: { proxy?: ProxyConnectionOptions; session?: GmailSessionData },
  ): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      proxy: options.proxy
        ? {
            server: options.proxy.server,
            username: options.proxy.username,
            password: options.proxy.password,
          }
        : undefined,
    });

    this.context = await this.browser.newContext();

    if (options.session?.cookies?.length) {
      await this.context.addCookies(
        options.session.cookies as Parameters<BrowserContext["addCookies"]>[0],
      );
    }

    this.page = await this.context.newPage();

    if (options.session?.localStorage) {
      await this.page.addInitScript((entries) => {
        for (const [key, value] of Object.entries(entries)) {
          window.localStorage.setItem(key, value as string);
        }
      }, options.session.localStorage);
    }

    await this.page.goto("https://accounts.google.com/signin/v2/identifier?service=mail", {
      waitUntil: "domcontentloaded",
    });

    // Sessao restaurada por cookies pode ja estar autenticada.
    if (this.page.url().includes("mail.google.com")) {
      return;
    }

    // Checa o bloqueio de automacao do Google JA na primeira tela, antes de
    // esperar por um campo que, quando bloqueado, nunca vai aparecer -
    // senao o login so falharia por timeout depois de 60s inteiros, sem
    // classificar corretamente o motivo (ver detectSecurityChallenge).
    if (await this.hasChallengeIndicator()) return;

    await this.page.waitForSelector(GMAIL_SELECTORS.emailInput, {
      state: "visible",
      timeout: ELEMENT_TIMEOUT_MS,
    });
    await this.page.fill(GMAIL_SELECTORS.emailInput, email, { timeout: ELEMENT_TIMEOUT_MS });
    await this.page.click(GMAIL_SELECTORS.emailNextButton, { timeout: ELEMENT_TIMEOUT_MS });

    await this.page.waitForLoadState("domcontentloaded");
    if (await this.hasChallengeIndicator()) return; // deixa detectSecurityChallenge classificar

    await this.page
      .waitForSelector(GMAIL_SELECTORS.passwordInput, { timeout: ELEMENT_TIMEOUT_MS })
      .catch(() => null);
    // A senha e usada uma unica vez aqui e nunca retida em outra variavel.
    await this.page.fill(GMAIL_SELECTORS.passwordInput, password, { timeout: ELEMENT_TIMEOUT_MS });
    await this.page.click(GMAIL_SELECTORS.passwordNextButton, { timeout: ELEMENT_TIMEOUT_MS });
    await this.page.waitForLoadState("domcontentloaded");
  }

  async screenshot(): Promise<Buffer | undefined> {
    return this.page?.screenshot({ fullPage: true }).catch(() => undefined);
  }

  async detectSecurityChallenge(): Promise<SecurityChallengeType | null> {
    if (!this.page) return null;
    const url = this.page.url();

    for (const { pattern, type } of CHALLENGE_URL_PATTERNS) {
      if (pattern.test(url)) return type;
    }

    const hasRecaptchaFrame = await this.page
      .locator("iframe[src*='recaptcha']")
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    if (hasRecaptchaFrame) return "CAPTCHA";

    // "Couldn't sign you in" / "doesn't support JavaScript" e a tela real
    // que o Google mostra quando recusa um navegador automatizado - mesmo
    // com JS de fato habilitado (confirmado com screenshot de uma execucao
    // real, ver commit que introduziu este bloco). Texto, nao URL, porque a
    // pagina nao navega pra uma URL de challenge reconhecivel nesse caso.
    const hasAutomationBlock = await this.page
      .getByText("Couldn't sign you in", { exact: false })
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    if (hasAutomationBlock) return "AUTOMATION_BLOCKED";

    return null;
  }

  private async hasChallengeIndicator(): Promise<boolean> {
    return (await this.detectSecurityChallenge()) !== null;
  }

  async searchMessages(query: { afterDate: Date; maxResults?: number }): Promise<GmailMessage[]> {
    if (!this.page) throw new Error("Gmail client não está autenticado (chame login() primeiro)");

    const afterParam = formatGmailDate(query.afterDate);
    await this.page.goto(`https://mail.google.com/mail/u/0/#search/after%3A${afterParam}`, {
      waitUntil: "domcontentloaded",
    });
    await this.page
      .waitForSelector(GMAIL_SELECTORS.messageRow, { timeout: 15000 })
      .catch(() => null);

    const rows = this.page.locator(GMAIL_SELECTORS.messageRow);
    const count = Math.min(await rows.count(), query.maxResults ?? 20);

    const messages: GmailMessage[] = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const [from, subject, snippet] = await Promise.all([
        row
          .locator(GMAIL_SELECTORS.messageSender)
          .first()
          .getAttribute("email")
          .catch(() => null),
        row
          .locator(GMAIL_SELECTORS.messageSubject)
          .first()
          .innerText()
          .catch(() => ""),
        row
          .locator(GMAIL_SELECTORS.messageSnippet)
          .first()
          .innerText()
          .catch(() => ""),
      ]);

      messages.push({
        id: `row-${i}`,
        from: from ?? "",
        subject,
        snippet,
        receivedAt: new Date(), // Gmail nao expoe timestamp exato na lista sem abrir a mensagem
      });
    }

    return messages;
  }

  async saveSession(): Promise<GmailSessionData> {
    if (!this.context || !this.page) return { cookies: [], localStorage: {} };

    const cookies = await this.context.cookies();
    const localStorage = await this.page
      .evaluate(() => {
        const entries: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) entries[key] = window.localStorage.getItem(key) ?? "";
        }
        return entries;
      })
      .catch(() => ({}) as Record<string, string>);

    return { cookies, localStorage };
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
  }
}

function formatGmailDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/*
 * Suporte futuro (recomendado sobre scraping de UI): Gmail API via OAuth 2.0.
 * Em vez de automatizar a UI do Gmail, o motorista autorizaria o app via
 * OAuth (escopo readonly de Gmail) e o worker usaria a Gmail API
 * (users.messages.list / users.messages.get) para buscar o codigo de forma
 * oficial e suportada, sem risco de acionar deteccao de bot da Google.
 * Isso exigiria: registrar um OAuth client, armazenar o refresh_token no
 * CredentialVault (nunca em texto puro) e trocar PlaywrightGmailClient por
 * um GmailApiClient que implementa a mesma interface IGmailClient.
 *
 * export class GmailApiClient implements IGmailClient { ... }
 */
