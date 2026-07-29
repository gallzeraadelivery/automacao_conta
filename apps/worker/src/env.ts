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
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
});

export const env = envSchema.parse(process.env);
