import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do monorepo (apps/api/src/lib → ../../../../). */
export const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve pasta de browser profiles. Relative paths ancoram na raiz do
 * monorepo (não no cwd do `pnpm --filter`). Inclui fallback do path legado
 * `apps/worker/storage/browser-profiles` onde o worker já gravou cookies.
 */
export async function resolveApplicantProfileDir(
  configuredRoot: string,
  applicantId: string,
): Promise<string> {
  const folder = `applicant-${applicantId}`;
  const primaryRoot = path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(MONOREPO_ROOT, configuredRoot);

  const candidates = [
    path.join(primaryRoot, folder),
    path.join(MONOREPO_ROOT, "apps/worker/storage/browser-profiles", folder),
    path.join(MONOREPO_ROOT, "storage/browser-profiles", folder),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return candidates[0]!;
}

export function defaultBrowserProfilesRoot(): string {
  // Preferir onde o worker em dev já persiste (cwd = apps/worker).
  return path.resolve(MONOREPO_ROOT, "apps/worker/storage/browser-profiles");
}
