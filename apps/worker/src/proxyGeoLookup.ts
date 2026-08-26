import type { BrowserContext, Page } from "playwright";
import { eq } from "drizzle-orm";
import { db, applicants } from "@uber-automation/database";

export interface ProxyGeoLookupResult {
  externalIp: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  source: "ip2location_demo";
}

const IP2LOCATION_DEMO_URL = "https://www.ip2location.com/demo";

/**
 * Resolve cidade/região do IP de saída do proxy abrindo o IP2Location Demo
 * **no próprio browser** (Electron/Chromium já configurado com proxy).
 *
 * Preferir a página principal do Electron (`page` existente): `context.newPage()`
 * no CDP costuma falhar/ficar instável. Não usa `context.request` (fura proxy).
 *
 * Se o IP detectado for igual ao egress do container (sem proxy), rejeita.
 * Falha soft — nunca derruba o job.
 */
export async function lookupProxyGeoViaContext(
  context: BrowserContext,
  options?: { timeoutMs?: number; hostEgressIp?: string | null; page?: Page },
): Promise<ProxyGeoLookupResult | null> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const hostIp =
    options?.hostEgressIp !== undefined
      ? options.hostEgressIp
      : await getHostEgressIp().catch(() => null);

  const ownedPage = options?.page ? null : await context.newPage();
  const page = options?.page ?? ownedPage!;
  try {
    return await lookupProxyGeoOnPage(page, { timeoutMs, hostIp });
  } catch {
    return null;
  } finally {
    if (ownedPage) await ownedPage.close().catch(() => undefined);
  }
}

/** Variante explícita: navega a página já aberta (caminho Electron). */
export async function lookupProxyGeoViaPage(
  page: Page,
  options?: { timeoutMs?: number; hostEgressIp?: string | null },
): Promise<ProxyGeoLookupResult | null> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const hostIp =
    options?.hostEgressIp !== undefined
      ? options.hostEgressIp
      : await getHostEgressIp().catch(() => null);
  try {
    return await lookupProxyGeoOnPage(page, { timeoutMs, hostIp });
  } catch {
    return null;
  }
}

async function lookupProxyGeoOnPage(
  page: Page,
  args: { timeoutMs: number; hostIp: string | null },
): Promise<ProxyGeoLookupResult | null> {
  const { timeoutMs, hostIp } = args;
  const response = await page.goto(IP2LOCATION_DEMO_URL, {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  });
  if (!response) return null;

  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        const hasIp =
          /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text) ||
          /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i.test(text);
        return hasIp && /\bCity\b/i.test(text) && /\bRegion\b/i.test(text);
      },
      { timeout: Math.min(timeoutMs, 15_000) },
    )
    .catch(() => undefined);

  const parsed = await extractIp2LocationDemo(page);
  if (!parsed?.externalIp && !parsed?.city) return null;

  if (hostIp && parsed.externalIp && parsed.externalIp === hostIp) {
    return null;
  }

  return { ...parsed, source: "ip2location_demo" };
}

/** IP público do container/host **sem** proxy — baseline anti-vazamento. */
export async function getHostEgressIp(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ip?: string };
    return typeof json.ip === "string" ? json.ip.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractIp2LocationDemo(page: Page): Promise<{
  externalIp: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
} | null> {
  // Sem funções nomeadas dentro do evaluate — tsx/esbuild injeta `__name`
  // e o Playwright quebra no browser ("__name is not defined").
  return page.evaluate(() => {
    const tableMap: Record<string, string> = {};
    const rows = Array.from(document.querySelectorAll("table tr"));
    for (let i = 0; i < rows.length; i++) {
      const cells = Array.from(rows[i]!.querySelectorAll("td, th")).map((c) =>
        (c.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
      if (cells.length >= 2 && cells[0] && cells[1]) {
        const label = cells[0].replace(/^[^\w]+/, "").toLowerCase();
        tableMap[label] = cells[1];
      }
    }

    const body = document.body?.innerText ?? "";
    const ipv4 = body.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    const ipv6 = body.match(/\b((?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4})\b/i);
    const ipFromBody =
      body.match(/IP Address\s+([0-9a-f.:]+)/i)?.[1] ?? ipv4?.[1] ?? ipv6?.[1] ?? null;

    const cityFromBody =
      body.match(/(?:^|\n)\s*City\s+([^\n\r]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    const regionFromBody =
      body.match(/(?:^|\n)\s*Region\s+([^\n\r]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    const countryFromBody =
      body.match(/(?:^|\n)\s*Country\s+([^\n\r]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;

    const cityTable = tableMap["city"];
    const regionTable = tableMap["region"];
    const countryTable = tableMap["country"];
    const ipTable = tableMap["ip address"];

    const city =
      cityTable && cityTable !== "-"
        ? cityTable
        : cityFromBody && cityFromBody !== "-"
          ? cityFromBody
          : null;
    const region =
      regionTable && regionTable !== "-"
        ? regionTable
        : regionFromBody && regionFromBody !== "-"
          ? regionFromBody
          : null;
    const countryRaw =
      countryTable && countryTable !== "-"
        ? countryTable
        : countryFromBody && countryFromBody !== "-"
          ? countryFromBody
          : null;
    const country = countryRaw ? countryRaw.replace(/\s*\[[A-Z]{2}\]\s*$/, "").trim() : null;
    const externalIp =
      ipTable && ipTable !== "-"
        ? ipTable
        : ipFromBody
          ? ipFromBody.replace(/\s+/g, " ").trim()
          : null;

    if (!externalIp && !city) return null;
    return { externalIp, city, region, country };
  });
}

export function formatProxyGeoLabel(city: string | null, region: string | null): string | null {
  if (city && region) return `${city}, ${region}`;
  return city || region || null;
}

export async function saveApplicantProxyGeo(
  applicantId: string,
  geo: ProxyGeoLookupResult,
): Promise<void> {
  await db
    .update(applicants)
    .set({
      proxyExternalIp: geo.externalIp,
      proxyGeoCity: geo.city,
      proxyGeoRegion: geo.region,
      proxyGeoLookedUpAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(applicants.id, applicantId));
}

/** True se o motorista ainda não tem geo do proxy gravado. */
export async function applicantNeedsProxyGeo(applicantId: string): Promise<boolean> {
  const [row] = await db
    .select({
      city: applicants.proxyGeoCity,
      ip: applicants.proxyExternalIp,
    })
    .from(applicants)
    .where(eq(applicants.id, applicantId))
    .limit(1);
  if (!row) return true;
  return !row.city && !row.ip;
}

/** Limpa geo inválido (ex.: vazamento Cuiabá) para forçar novo lookup. */
export async function clearApplicantProxyGeo(applicantId: string): Promise<void> {
  await db
    .update(applicants)
    .set({
      proxyExternalIp: null,
      proxyGeoCity: null,
      proxyGeoRegion: null,
      proxyGeoLookedUpAt: null,
      updatedAt: new Date(),
    })
    .where(eq(applicants.id, applicantId));
}
