import { ImapEmailClient } from "./imapEmailClient";

export interface ImapTestResult {
  success: boolean;
  latencyMs: number | null;
  error?: string;
}

/**
 * Testa se um e-mail aceita IMAP com a senha direta, ANTES de importar um
 * lote inteiro - descoberto na prática que contas de um mesmo fornecedor
 * podem ter políticas diferentes (2FA/"less secure apps" bloqueando IMAP em
 * algumas, liberado em outras). Não salva nada no banco - só conecta,
 * confirma, e desconecta.
 */
export async function testImapConnectivity(
  email: string,
  password: string,
  options?: { host?: string; port?: number; connectionTimeout?: number },
): Promise<ImapTestResult> {
  const client = new ImapEmailClient({
    host: options?.host,
    port: options?.port,
    connectionTimeout: options?.connectionTimeout ?? 15000,
  });

  const startedAt = Date.now();
  try {
    await client.login(email, password, {});
    return { success: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      success: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Erro desconhecido ao testar IMAP",
    };
  } finally {
    await client.close();
  }
}
