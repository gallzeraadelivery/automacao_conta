import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLicenseGuard, type LicenseGuard } from "@uber-automation/license-client";
import { env } from "./env";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let guard: LicenseGuard | null = null;

export async function bootstrapLicenseGuard(): Promise<LicenseGuard> {
  const licenseKeyFile =
    env.LICENSE_KEY_FILE?.trim() || path.join(MONOREPO_ROOT, "storage", "license.key");

  guard = await startLicenseGuard({
    enabled: env.LICENSE_ENABLED,
    serverUrl: env.LICENSE_SERVER_URL,
    licenseKey: env.LICENSE_KEY,
    licenseKeyFile,
    baseDir: MONOREPO_ROOT,
    appVersion: "0.1.0",
    heartbeatMs: env.LICENSE_HEARTBEAT_MS,
  });

  return guard;
}

export function getLicenseGuard(): LicenseGuard {
  if (!guard) {
    throw new Error("License guard nao inicializado");
  }
  return guard;
}
