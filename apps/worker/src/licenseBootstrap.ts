import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLicenseGuard } from "@uber-automation/license-client";
import { env } from "./env";

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export async function bootstrapLicenseGuard() {
  const explicitKeyFile = env.LICENSE_KEY_FILE?.trim();
  const licenseKeyFile =
    explicitKeyFile || path.join(MONOREPO_ROOT, "storage", "license.key");
  const machineIdFile =
    env.LICENSE_MACHINE_ID_FILE?.trim() ||
    (explicitKeyFile
      ? path.join(path.dirname(explicitKeyFile), ".license-machine-id")
      : undefined);

  const guard = await startLicenseGuard({
    enabled: env.LICENSE_ENABLED,
    serverUrl: env.LICENSE_SERVER_URL,
    licenseKey: env.LICENSE_KEY,
    licenseKeyFile,
    machineIdFile,
    baseDir: MONOREPO_ROOT,
    appVersion: "0.1.0",
    heartbeatMs: env.LICENSE_HEARTBEAT_MS,
  });

  if (guard.client) {
    const state = guard.client.getState();
    console.log(`[worker] Licenca OK — ${state.message}`);
  }

  return guard;
}
