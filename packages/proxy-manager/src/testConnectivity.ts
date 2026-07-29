import axios from "axios";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

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

function buildProxyUrl({ host, port, protocol, username, password }: ProxyCredentials): string {
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password ?? "")}@`
    : "";
  const scheme = protocol === "socks5" ? "socks5" : protocol;
  return `${scheme}://${auth}${host}:${port}`;
}

function buildAgent(credentials: ProxyCredentials) {
  const url = buildProxyUrl(credentials);
  switch (credentials.protocol) {
    case "socks5":
      return new SocksProxyAgent(url);
    case "https":
      return new HttpsProxyAgent(url);
    case "http":
    default:
      return new HttpProxyAgent(url);
  }
}

/**
 * Testa a conectividade de um proxy fazendo uma requisicao real atraves dele.
 * Nao usado para nenhuma etapa de verificacao de identidade - apenas para validar
 * se as credenciais/host/porta do proxy estao funcionais antes de disponibiliza-lo.
 */
export async function testProxyConnectivity(
  credentials: ProxyCredentials,
  options?: { timeoutMs?: number; testUrl?: string },
): Promise<ProxyTestResult> {
  const timeoutMs = options?.timeoutMs ?? Number(process.env.PROXY_TEST_TIMEOUT_MS ?? 10000);
  const testUrl =
    options?.testUrl ?? process.env.PROXY_TEST_URL ?? "https://api.ipify.org?format=json";

  const agent = buildAgent(credentials);
  const startedAt = Date.now();

  try {
    const response = await axios.get(testUrl, {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: timeoutMs,
      proxy: false,
    });

    const latencyMs = Date.now() - startedAt;
    const externalIp = typeof response.data?.ip === "string" ? response.data.ip : undefined;

    return { success: true, latencyMs, externalIp };
  } catch (error) {
    return {
      success: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Erro desconhecido ao testar o proxy",
    };
  }
}
