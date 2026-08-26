import { chromium } from "playwright";
import { resolveProxyConnection } from "../proxyConnection";
import {
  formatProxyGeoLabel,
  getHostEgressIp,
  lookupProxyGeoViaContext,
  saveApplicantProxyGeo,
} from "../proxyGeoLookup";

/**
 * Smoke: Chromium + proxy → IP2Location demo → grava geo no applicant.
 * Uso: APPLICANT_ID=... PROXY_ID=... pnpm exec tsx src/scripts/backfillProxyGeo.ts
 */
async function main() {
  const proxyId = process.env.PROXY_ID ?? "e356daa2-e48f-4ee0-9a30-70950ec783f0";
  const applicantId = process.env.APPLICANT_ID;
  if (!applicantId) throw new Error("APPLICANT_ID obrigatório");

  const hostIp = await getHostEgressIp();
  console.log(JSON.stringify({ hostEgressIp: hostIp }));

  const proxy = await resolveProxyConnection(proxyId);
  if (!proxy) throw new Error("proxy not found");

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  try {
    const context = await browser.newContext({
      proxy: {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      },
    });
    const geo = await lookupProxyGeoViaContext(context, { hostEgressIp: hostIp });
    console.log(
      JSON.stringify({
        geo,
        label: geo ? formatProxyGeoLabel(geo.city, geo.region) : null,
        leaked: Boolean(geo?.externalIp && hostIp && geo.externalIp === hostIp),
      }),
    );
    if (geo && (geo.city || geo.externalIp)) {
      await saveApplicantProxyGeo(applicantId, geo);
      console.log("saved");
    } else {
      console.log("lookup_failed_or_rejected");
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
