import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8090),
  LICENSE_DB_PATH: z.string().default("./data/licenses.sqlite"),
  LICENSE_ADMIN_USER: z.string().min(3, "LICENSE_ADMIN_USER deve ter ao menos 3 caracteres"),
  LICENSE_ADMIN_PASSWORD: z.string().min(8, "LICENSE_ADMIN_PASSWORD deve ter ao menos 8 caracteres"),
  LICENSE_SESSION_SECRET: z.string().min(16, "LICENSE_SESSION_SECRET deve ter ao menos 16 caracteres"),
  LICENSE_CORS_ORIGIN: z.string().default("*"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
