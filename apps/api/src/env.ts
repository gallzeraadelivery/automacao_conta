import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

// Carrega o .env da raiz do monorepo independentemente do cwd de onde o
// processo foi iniciado (ex: `pnpm --filter` muda o cwd para o pacote).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  API_CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // Base do painel web (apps/web) - usada para montar o link seguro de
  // entrega ao motorista (Central de Pendências, Fase 6): `${WEB_PUBLIC_URL}/d/:token`.
  WEB_PUBLIC_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be set and reasonably long"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be set and reasonably long"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900000),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  // Mesmo path do worker - relativo à raiz do monorepo.
  BROWSER_PROFILES_STORAGE_PATH: z
    .string()
    .default("apps/worker/storage/browser-profiles"),
  AUTOMATION_SCREENSHOTS_PATH: z.string().default("apps/worker/storage/automation-screenshots"),
  /** Proteção por licença GD-XXXX-XXXX (servidor central). */
  LICENSE_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  LICENSE_SERVER_URL: z.string().url().default("https://automacao.gdapps.online"),
  LICENSE_KEY: z.string().optional(),
  /** Arquivo local onde a chave e salva apos ativacao no painel. */
  LICENSE_KEY_FILE: z.string().optional(),
  LICENSE_HEARTBEAT_MS: z.coerce.number().int().min(60_000).default(900_000),
});

export const env = envSchema.parse(process.env);
