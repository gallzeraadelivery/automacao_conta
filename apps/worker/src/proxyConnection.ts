import { eq } from "drizzle-orm";
import { db, proxyConfigs } from "@uber-automation/database";
import { CredentialVault } from "@uber-automation/credential-vault";

/**
 * Mesmo formato do blob que apps/api/src/services/proxies.service.ts grava
 * em proxy_configs (host+username+password serializados e criptografados
 * juntos, com um unico IV por linha). Duplicado aqui (em vez de importado de
 * apps/api) porque apps/worker e apps/api sao apps independentes no
 * workspace - nenhum importa o outro.
 */
interface ProxySecretBlob {
  host: string;
  username?: string;
  password?: string;
}

export interface ProxyConnection {
  server: string;
  username?: string;
  password?: string;
}

const PROXY_CREDENTIAL_CONTEXT = { applicantId: "system:proxy" };

/**
 * Resolve os dados de conexao de um proxy para uso direto em
 * `browser.newContext({ proxy })` do Playwright. Retorna `null` se o proxy
 * nao existir mais (ex: removido entre o enfileiramento e o processamento).
 */
export async function resolveProxyConnection(proxyId: string): Promise<ProxyConnection | null> {
  const [row] = await db.select().from(proxyConfigs).where(eq(proxyConfigs.id, proxyId)).limit(1);
  if (!row) return null;

  const vault = new CredentialVault();
  const json = await vault.decrypt(
    {
      ciphertext: row.hostEncrypted,
      iv: row.encryptionIv,
      authTag: row.encryptionAuthTag,
      algorithm: "AES-256-GCM",
    },
    PROXY_CREDENTIAL_CONTEXT,
    row.id,
  );
  const secret = JSON.parse(json) as ProxySecretBlob;

  return {
    server: `${row.protocol}://${secret.host}:${row.port}`,
    username: secret.username,
    password: secret.password,
  };
}
