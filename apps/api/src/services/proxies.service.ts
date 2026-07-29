import { and, eq } from "drizzle-orm";
import { db, proxyConfigs } from "@uber-automation/database";
import { sealSecret, unsealSecret } from "@uber-automation/credential-vault";
import { testProxyConnectivity } from "@uber-automation/proxy-manager";
import type { CreateProxyInput } from "@uber-automation/shared";
import { HttpError } from "../middleware/errorHandler";

interface ProxySecretBlob {
  host: string;
  username?: string;
  password?: string;
}

/**
 * A tabela proxy_configs tem um unico par (encryption_iv, encryption_auth_tag)
 * por linha. Reutilizar o mesmo IV para criptografar host/username/password
 * separadamente quebraria a garantia de seguranca do AES-256-GCM (IV nunca
 * pode ser reutilizado com a mesma chave para textos diferentes). Por isso,
 * host + username + password sao serializados em um unico blob JSON e
 * criptografados de uma vez; o resultado fica em host_encrypted e as colunas
 * username_encrypted/password_encrypted permanecem null (sao nullable no
 * schema, reservadas caso o time prefira futuramente migrar para IVs
 * individuais por campo).
 */
function sealProxySecrets(blob: ProxySecretBlob) {
  return sealSecret(JSON.stringify(blob));
}

function unsealProxySecrets(row: {
  hostEncrypted: string;
  encryptionIv: string;
  encryptionAuthTag: string;
}): ProxySecretBlob {
  const json = unsealSecret({
    encrypted: row.hostEncrypted,
    iv: row.encryptionIv,
    authTag: row.encryptionAuthTag,
  });
  return JSON.parse(json) as ProxySecretBlob;
}

export interface ProxyPublicView {
  id: string;
  port: number;
  protocol: string;
  declaredRegion: string | null;
  status: string;
  latencyMs: number | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
}

function toPublicView(row: typeof proxyConfigs.$inferSelect): ProxyPublicView {
  return {
    id: row.id,
    port: row.port,
    protocol: row.protocol,
    declaredRegion: row.declaredRegion,
    status: row.status,
    latencyMs: row.latencyMs,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
  };
}

export async function createProxy(
  companyId: string,
  input: CreateProxyInput,
): Promise<ProxyPublicView> {
  const sealed = sealProxySecrets({
    host: input.host,
    username: input.username,
    password: input.password,
  });

  const [row] = await db
    .insert(proxyConfigs)
    .values({
      companyId,
      hostEncrypted: sealed.encrypted,
      port: input.port,
      protocol: input.protocol,
      encryptionIv: sealed.iv,
      encryptionAuthTag: sealed.authTag,
      declaredRegion: input.declaredRegion,
      status: "UNTESTED",
    })
    .returning();

  return toPublicView(row!);
}

export async function listProxies(companyId: string): Promise<ProxyPublicView[]> {
  const rows = await db.select().from(proxyConfigs).where(eq(proxyConfigs.companyId, companyId));
  return rows.map(toPublicView);
}

export async function testProxy(companyId: string, proxyId: string): Promise<ProxyPublicView> {
  const [row] = await db
    .select()
    .from(proxyConfigs)
    .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.id, proxyId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Proxy não encontrado");
  }

  const secrets = unsealProxySecrets(row);

  const result = await testProxyConnectivity({
    host: secrets.host,
    port: row.port,
    protocol: row.protocol as "http" | "https" | "socks5",
    username: secrets.username,
    password: secrets.password,
  });

  const [updated] = await db
    .update(proxyConfigs)
    .set({
      status: result.success ? "ACTIVE" : "ERROR",
      latencyMs: result.latencyMs,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(proxyConfigs.id, proxyId))
    .returning();

  return toPublicView(updated!);
}
