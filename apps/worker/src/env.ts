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
  /**
   * "mock" (padrão, seguro): a etapa RUN_ADMINISTRATIVE_FLOW mira em
   * apps/mock-server (MOCK_UBER_BASE_URL) - nada é enviado à Uber real.
   * "production": mira no site real da Uber (config.ts/selectors.ts de
   * @uber-automation/platform-adapters) - seletores nunca validados contra
   * o site real (ver comentário em UBER_CONFIG); só usar depois de validar
   * manualmente com uma conta de teste. Ver SECURITY.md.
   */
  AUTOMATION_TARGET: z.enum(["mock", "production"]).default("mock"),
  MOCK_UBER_BASE_URL: z.string().default("http://localhost:3001/mock-uber"),
  /**
   * Só necessário fora da imagem Docker (que já instala o Chromium em
   * PLAYWRIGHT_BROWSERS_PATH e o Playwright o resolve sozinho) - usado em
   * ambientes de desenvolvimento com um Chromium pré-instalado em caminho
   * não padrão.
   */
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  /**
   * false = abre uma janela de navegador de verdade (só funciona rodando o
   * worker fora do Docker, numa máquina com tela) - útil para acompanhar ao
   * vivo o primeiro teste real (AUTOMATION_TARGET=production). Padrão true
   * (sem interface, como sempre roda em produção/Docker).
   */
  AUTOMATION_HEADLESS: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  /**
   * Pasta onde screenshots de PAUSED/ERROR são salvos (ver
   * captureDebugScreenshot em uberAutomationRunner.ts) - ajuda a diagnosticar
   * seletores errados sem precisar de tela. Path relativo resolve a partir
   * do cwd do processo (apps/worker em dev, /app em Docker).
   */
  AUTOMATION_SCREENSHOTS_PATH: z.string().default("storage/automation-screenshots"),
});

export const env = envSchema.parse(process.env);
