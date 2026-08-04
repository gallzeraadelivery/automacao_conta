import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Cidade fixa na tela Earn with Uber (todas as contas). */
export const EARN_CITY_FIXED = "Orlando, FL" as const;

/** Mantido só por compat / logs — sempre Orlando. */
export const EARN_CITY_POOL = [EARN_CITY_FIXED] as const;

function poolFilePath(): string {
  const configured = process.env.UBER_EARN_CITY_POOL_PATH;
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) return path.resolve(MONOREPO_ROOT, configured);
  return path.resolve(MONOREPO_ROOT, "apps/worker/storage/earn-cities-rotation.json");
}

/**
 * Sempre Orlando, FL. Grava lastAssigned só pra auditoria local.
 */
export async function allocateNextEarnCity(applicantId: string): Promise<string> {
  const city = EARN_CITY_FIXED;
  try {
    const file = poolFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        {
          nextIndex: 0,
          lastAssigned: {
            city,
            applicantId,
            at: new Date().toISOString(),
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch {
    // best-effort — a cidade fixa não depende do arquivo
  }
  return city;
}
