import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Fallback se company_settings / env não tiverem cidade. */
export const DEFAULT_EARN_CITY = "Orlando, FL" as const;

/** @deprecated use DEFAULT_EARN_CITY — mantido por testes/compat. */
export const EARN_CITY_FIXED = DEFAULT_EARN_CITY;

/** Mantido só por compat / logs. */
export const EARN_CITY_POOL = [DEFAULT_EARN_CITY] as const;

function poolFilePath(): string {
  const configured = process.env.UBER_EARN_CITY_POOL_PATH;
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) return path.resolve(MONOREPO_ROOT, configured);
  return path.resolve(MONOREPO_ROOT, "apps/worker/storage/earn-cities-rotation.json");
}

/**
 * Aloca a cidade Earn. `cityOverride` vem de company_settings (painel);
 * senão usa env / Orlando.
 */
export async function allocateNextEarnCity(
  applicantId: string,
  cityOverride?: string,
): Promise<string> {
  const city =
    (cityOverride?.trim() || process.env.UBER_EARN_CITY?.trim() || DEFAULT_EARN_CITY).trim() ||
    DEFAULT_EARN_CITY;
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
    // best-effort — a cidade não depende do arquivo
  }
  return city;
}
