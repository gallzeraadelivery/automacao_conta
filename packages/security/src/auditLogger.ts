import { maskEmail, maskPhone } from "./masking";

/**
 * Tokens de nome de campo (apos separar por camelCase/underscore) que
 * indicam dado sensivel e devem ser sempre redigidos. Uso de tokens inteiros
 * (nao substring bruta) evita falsos positivos como "driver" casando com "iv".
 */
const SENSITIVE_TOKENS = new Set([
  "password",
  "senha",
  "secret",
  "token",
  "cookie",
  "cookies",
  "session",
  "code",
  "codigo",
  "ciphertext",
  "cipher",
  "authtag",
  "auth",
  "iv",
  "key",
  "encrypted",
  "document",
  "cnh",
  "cpf",
  "selfie",
  "image",
  "storage",
]);

const EMAIL_TOKENS = new Set(["email"]);
const PHONE_TOKENS = new Set(["phone", "telefone", "celular"]);

function tokenize(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\s-]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function hasAnyToken(tokens: string[], set: Set<string>): boolean {
  return tokens.some((token) => set.has(token));
}

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/**
 * Mascara recursivamente um objeto antes de ele ser gravado em log/auditoria.
 * Funciona como rede de seguranca: mesmo que o chamador esqueca de mascarar
 * um campo, chaves cujo nome indica dado sensivel sao sempre redigidas, e
 * campos de e-mail/telefone sao mascarados automaticamente por heuristica de
 * nome do campo.
 */
export function maskSensitiveData<T>(data: T, seen: WeakSet<object> = new WeakSet(), depth = 0): T {
  if (data === null || data === undefined) return data;

  if (typeof data !== "object") {
    return data;
  }

  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]" as unknown as T;
  }

  if (data instanceof Date) {
    return data;
  }

  if (seen.has(data as object)) {
    return "[CIRCULAR]" as unknown as T;
  }
  seen.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => maskSensitiveData(item, seen, depth + 1)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const tokens = tokenize(key);

    // Campos cujo nome comeca com "masked" (ex: maskedCode, maskedPhone) sao
    // um contrato explicito do chamador de que o valor ja foi sanitizado
    // (ex: maskCode/maskEmail/maskPhone) - nao redigir de novo por cima.
    if (tokens[0] === "masked") {
      result[key] = value;
      continue;
    }

    if (hasAnyToken(tokens, SENSITIVE_TOKENS)) {
      result[key] = REDACTED;
      continue;
    }

    if (typeof value === "string" && hasAnyToken(tokens, EMAIL_TOKENS) && value.includes("@")) {
      result[key] = maskEmail(value);
      continue;
    }

    if (typeof value === "string" && hasAnyToken(tokens, PHONE_TOKENS)) {
      result[key] = maskPhone(value);
      continue;
    }

    if (value && typeof value === "object") {
      result[key] = maskSensitiveData(value, seen, depth + 1);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

export interface AuditLogEntry {
  companyId: string;
  operatorId?: string;
  applicantId?: string;
  action: string;
  metadata?: Record<string, unknown>;
}

export type AuditLogSink = (entry: AuditLogEntry) => Promise<void> | void;

function defaultSink(entry: AuditLogEntry): void {
  // eslint-disable-next-line no-console
  console.log("[audit]", JSON.stringify(entry));
}

/**
 * Logger de auditoria generico e independente de banco de dados. Todo
 * `metadata` passa por `maskSensitiveData` antes de chegar ao sink, entao
 * mesmo um sink "burro" (console, arquivo, DB) nunca recebe segredos.
 * Consumidores (ex: apps/api) injetam um `sink` que grava em `audit_logs`.
 */
export class AuditLogger {
  private readonly sink: AuditLogSink;

  constructor(options?: { sink?: AuditLogSink }) {
    this.sink = options?.sink ?? defaultSink;
  }

  async maskSensitiveData<T>(data: T): Promise<T> {
    return maskSensitiveData(data);
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const safeEntry: AuditLogEntry = {
      ...entry,
      metadata: entry.metadata ? maskSensitiveData(entry.metadata) : undefined,
    };
    await this.sink(safeEntry);
  }
}
