import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { assertValidKey } from "@uber-automation/security";

export interface MasterKeyProvider {
  getMasterKey(): Promise<Buffer>;
}

/**
 * Busca a chave mestra no AWS Secrets Manager. Preferida para producao -
 * a chave nunca fica no repositorio nem em variavel de ambiente do host.
 * O segredo deve conter os 64 caracteres hex (32 bytes) da chave AES-256.
 */
export class AwsSecretsManagerKeyProvider implements MasterKeyProvider {
  private cached?: Buffer;

  constructor(
    private readonly secretId: string,
    private readonly region?: string,
  ) {}

  async getMasterKey(): Promise<Buffer> {
    if (this.cached) return this.cached;

    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const client = new SecretsManagerClient({ region: this.region });

    let response;
    try {
      response = await client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    } catch (error) {
      // Nunca inclua o secretId completo nem detalhes de credenciais AWS no erro.
      throw new Error(
        `Falha ao buscar a chave mestra no AWS Secrets Manager (secret "${maskSecretId(this.secretId)}")`,
        { cause: error },
      );
    }

    const hex = response.SecretString?.trim();
    if (!hex) {
      throw new Error("AWS Secrets Manager retornou um segredo vazio para a chave mestra");
    }

    const key = Buffer.from(hex, "hex");
    assertValidKey(key, "A chave mestra do AWS Secrets Manager");
    this.cached = key;
    return key;
  }
}

function maskSecretId(secretId: string): string {
  if (secretId.length <= 6) return "***";
  return `${secretId.slice(0, 3)}***${secretId.slice(-3)}`;
}

/**
 * Fallback local para desenvolvimento: le a chave mestra de um arquivo
 * `.secrets.key` fora do controle de versao (nunca deve ser commitado).
 * Se o arquivo nao existir, cai de volta para CREDENTIAL_ENCRYPTION_KEY
 * (compatibilidade com a Fase 1) para nao quebrar ambientes existentes,
 * mas isso deve ser evitado fora de desenvolvimento local.
 */
export class LocalFileKeyProvider implements MasterKeyProvider {
  private cached?: Buffer;

  constructor(private readonly filePath: string) {}

  async getMasterKey(): Promise<Buffer> {
    if (this.cached) return this.cached;

    let hex: string | undefined;

    if (existsSync(this.filePath)) {
      hex = (await readFile(this.filePath, "utf8")).trim();
    } else if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
      hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
    }

    if (!hex) {
      throw new Error(
        `Chave mestra nao encontrada. Crie o arquivo "${this.filePath}" (ex: openssl rand -hex 32 > ${this.filePath}) ` +
          `ou defina CREDENTIAL_ENCRYPTION_KEY. Nunca commite esse arquivo.`,
      );
    }

    const key = Buffer.from(hex, "hex");
    assertValidKey(key, `A chave mestra em "${this.filePath}"`);
    this.cached = key;
    return key;
  }
}

export interface CreateMasterKeyProviderOptions {
  provider?: "aws" | "local";
  awsSecretId?: string;
  awsRegion?: string;
  localKeyFilePath?: string;
}

/**
 * Fabrica o provider correto a partir de variaveis de ambiente:
 * - SECRETS_PROVIDER=aws  -> AWS Secrets Manager (requer AWS_SECRETS_MANAGER_SECRET_ID)
 * - SECRETS_PROVIDER=local (padrao) -> arquivo local .secrets.key
 */
export function createMasterKeyProvider(
  options: CreateMasterKeyProviderOptions = {},
): MasterKeyProvider {
  const provider = options.provider ?? (process.env.SECRETS_PROVIDER as "aws" | "local") ?? "local";

  if (provider === "aws") {
    const secretId = options.awsSecretId ?? process.env.AWS_SECRETS_MANAGER_SECRET_ID;
    if (!secretId) {
      throw new Error("AWS_SECRETS_MANAGER_SECRET_ID e obrigatorio quando SECRETS_PROVIDER=aws");
    }
    return new AwsSecretsManagerKeyProvider(secretId, options.awsRegion ?? process.env.AWS_REGION);
  }

  const filePath =
    options.localKeyFilePath ??
    process.env.SECRETS_KEY_FILE_PATH ??
    path.resolve(process.cwd(), ".secrets.key");
  return new LocalFileKeyProvider(filePath);
}
