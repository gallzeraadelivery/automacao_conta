import { env } from "./env";
import { createApp } from "./app";
import { bootstrapLicenseGuard } from "./licenseBootstrap";

async function main() {
  const licenseGuard = await bootstrapLicenseGuard();
  const app = createApp({ assertLicensed: () => licenseGuard.assertAllowed() });

  app.listen(env.API_PORT, () => {
    console.log(`API listening on port ${env.API_PORT} (${env.NODE_ENV})`);
  });

  process.on("SIGINT", () => licenseGuard.stop());
  process.on("SIGTERM", () => licenseGuard.stop());
}

main().catch((error) => {
  console.error("[api] Falha ao iniciar:", error);
  process.exit(1);
});
