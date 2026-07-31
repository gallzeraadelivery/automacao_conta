import { and, eq } from "drizzle-orm";
import { db, proxyConfigs, browserProfiles } from "@uber-automation/database";
import type { CredentialVault } from "@uber-automation/credential-vault";
import { testProxyConnectivity } from "@uber-automation/proxy-manager";
import type { CreateProxyInput } from "@uber-automation/shared";
import { HttpError } from "../middleware/errorHandler";
import { createCredentialVault } from "../lib/credentialVault";

interface ProxySecretBlob {
  host: string;
  username?: string;
  password?: string;
}

/**
 * Proxies sao um recurso da empresa, nao de um motorista especifico - mas o
 * ICredentialVault exige um `applicantId` no contexto (para correlacionar o
 * evento de auditoria a um motorista quando aplicavel). Como nao ha um
 * motorista especifico aqui, usamos um identificador sentinela para deixar
 * claro nos logs de auditoria que o acesso e a nivel de proxy da empresa.
 */
const PROXY_CREDENTIAL_CONTEXT = { applicantId: "system:proxy" };

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
async function sealProxySecrets(
  vault: CredentialVault,
  proxyId: string | undefined,
  blob: ProxySecretBlob,
) {
  return vault.encrypt(JSON.stringify(blob), PROXY_CREDENTIAL_CONTEXT, proxyId);
}

async function unsealProxySecrets(
  vault: CredentialVault,
  row: { id: string; hostEncrypted: string; encryptionIv: string; encryptionAuthTag: string },
): Promise<ProxySecretBlob> {
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

export function toPublicView(row: typeof proxyConfigs.$inferSelect): ProxyPublicView {
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
  const vault = createCredentialVault(companyId);
  const sealed = await sealProxySecrets(vault, undefined, {
    host: input.host,
    username: input.username,
    password: input.password,
  });

  const [row] = await db
    .insert(proxyConfigs)
    .values({
      companyId,
      hostEncrypted: sealed.ciphertext,
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

/**
 * `browser_profiles.proxy_id` referencia `proxy_configs.id` sem
 * `onDelete: "cascade"` (perfil de navegador é histórico/auditoria, não
 * deve sumir só porque o proxy foi removido) - por isso, antes de apagar,
 * desvincula (SET NULL, coluna já é nullable) qualquer perfil que
 * referencie este proxy, em vez de deixar a constraint de FK falhar com um
 * erro cru de Postgres.
 */
export async function deleteProxy(companyId: string, proxyId: string): Promise<void> {
  const [row] = await db
    .select({ id: proxyConfigs.id })
    .from(proxyConfigs)
    .where(and(eq(proxyConfigs.companyId, companyId), eq(proxyConfigs.id, proxyId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Proxy não encontrado");
  }

  await db
    .update(browserProfiles)
    .set({ proxyId: null })
    .where(eq(browserProfiles.proxyId, proxyId));

  await db.delete(proxyConfigs).where(eq(proxyConfigs.id, proxyId));
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

  const vault = createCredentialVault(companyId);
  const secrets = await unsealProxySecrets(vault, row);

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
