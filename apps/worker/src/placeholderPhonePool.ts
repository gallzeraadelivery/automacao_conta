import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatUsPhoneFromDigits,
  nextFreePlaceholderPhoneDigits,
  toPhoneDigits,
} from "@uber-automation/platform-adapters";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function poolFilePath(): string {
  const configured = process.env.UBER_PLACEHOLDER_PHONE_POOL_PATH;
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) return path.resolve(MONOREPO_ROOT, configured);
  return path.resolve(MONOREPO_ROOT, "apps/worker/storage/placeholder-phones-used.json");
}

interface PoolFile {
  /** Dígitos NANP (10) → metadados do uso no hub. */
  used: Record<string, { applicantId: string; usedAt: string; reason: string }>;
}

async function readPool(): Promise<PoolFile> {
  try {
    const raw = JSON.parse(await readFile(poolFilePath(), "utf8")) as PoolFile;
    if (!raw || typeof raw !== "object" || !raw.used || typeof raw.used !== "object") {
      return { used: {} };
    }
    return raw;
  } catch {
    return { used: {} };
  }
}

async function writePool(pool: PoolFile): Promise<void> {
  const file = poolFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(pool, null, 2), "utf8");
}

export interface PlaceholderPhoneAllocatorOptions {
  /** Resolvido a cada allocate (company_settings / env). */
  resolvePhoneBase?: () => Promise<string>;
}

/**
 * Alocador de placeholders por job: pula números já usados (hub **ou**
 * SMS rejeitado) e os já tentados nesta execução.
 */
export function createPlaceholderPhoneAllocator(
  applicantId: string,
  options: PlaceholderPhoneAllocatorOptions = {},
): {
  allocateNext(): Promise<string>;
  markUsed(phone: string, reason?: string): Promise<void>;
} {
  const reservedThisRun = new Set<string>();

  return {
    async allocateNext(): Promise<string> {
      const pool = await readPool();
      const blocked = new Set([...Object.keys(pool.used), ...reservedThisRun]);
      const baseOverride = options.resolvePhoneBase
        ? await options.resolvePhoneBase()
        : undefined;
      const digits = nextFreePlaceholderPhoneDigits(blocked, 10_000, baseOverride);
      reservedThisRun.add(digits);
      return formatUsPhoneFromDigits(digits);
    },

    async markUsed(phone: string, reason = "hub_session"): Promise<void> {
      const digits = toPhoneDigits(phone);
      if (digits.length !== 10) return;
      const pool = await readPool();
      pool.used[digits] = {
        applicantId,
        usedAt: new Date().toISOString(),
        reason,
      };
      await writePool(pool);
      reservedThisRun.add(digits);
    },
  };
}
