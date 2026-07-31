import { chromium } from "playwright";

export interface ProxyCredentials {
  host: string;
  port: number;
  protocol: "http" | "https" | "socks5";
  username?: string;
  password?: string;
}

export interface ProxyTestResult {
  success: boolean;
  latencyMs: number | null;
  externalIp?: string;
  error?: string;
}

function buildProxyServer({ host, port, protocol }: ProxyCredentials): string {
  const scheme = protocol === "socks5" ? "socks5" : protocol;
  return `${scheme}://${host}:${port}`;
}

/**
 * Testa a conectividade de um proxy abrindo um Chromium real (Playwright) e
 * navegando através dele - deliberadamente o MESMO motor usado pela
 * automação de verdade (apps/worker), não uma biblioteca HTTP genérica
 * como na versão anterior (axios + *-proxy-agent).
 *
 * Isso importa porque "o proxy funciona" depende de QUEM está conectando:
 * um proxy SOCKS5 com usuário/senha pode funcionar perfeitamente num
 * navegador comum ou numa lib HTTP em Node (que suportam autenticação
 * SOCKS5), mas o Chromium NÃO suporta autenticação usuário/senha em SOCKS5
 * (limitação conhecida do próprio Chromium, não deste sistema) - um teste
 * baseado em axios aprovaria esse proxy como "ACTIVE" e a automação real
 * falharia silenciosamente na primeira navegação. Rodar o teste com o
 * mesmo Chromium elimina esse descompasso.
 */
export async function testProxyConnectivity(
  credentials: ProxyCredentials,
  options?: { timeoutMs?: number; testUrl?: string },
): Promise<ProxyTestResult> {
  const timeoutMs = options?.timeoutMs ?? Number(process.env.PROXY_TEST_TIMEOUT_MS ?? 15000);
  const testUrl =
    options?.testUrl ?? process.env.PROXY_TEST_URL ?? "https://api.ipify.org?format=json";

  const startedAt = Date.now();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });

  try {
    const context = await browser.newContext({
      proxy: {
        server: buildProxyServer(credentials),
        username: credentials.username,
        password: credentials.password,
      },
    });
    const page = await context.newPage();

    await page.goto(testUrl, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    const latencyMs = Date.now() - startedAt;

    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
    let externalIp: string | undefined;
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.ip === "string") externalIp = parsed.ip;
    } catch {
      // resposta nao era o JSON esperado - mantem sucesso (a pagina carregou
      // atraves do proxy, que e o que importa), so sem o IP externo.
    }

    return { success: true, latencyMs, externalIp };
  } catch (error) {
    return {
      success: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Erro desconhecido ao testar o proxy",
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
