import type { BrowserFingerprint } from "./browserFingerprint";

/**
 * Mapeia `proxy_configs.declared_region` (texto livre) → IANA timezone.
 * Earn fixo em Orlando, FL → default America/New_York quando região vazia.
 */
const REGION_TIMEZONE_RULES: Array<{ match: RegExp; timezoneId: string }> = [
  { match: /\b(orlando|florida|fl|miami|tampa|us-?east|virginia|ny|nyc|new.?york)\b/i, timezoneId: "America/New_York" },
  { match: /\b(chicago|illinois|il|texas|tx|dallas|us-?central)\b/i, timezoneId: "America/Chicago" },
  { match: /\b(denver|colorado|co|us-?mountain)\b/i, timezoneId: "America/Denver" },
  { match: /\b(phoenix|arizona|az)\b/i, timezoneId: "America/Phoenix" },
  { match: /\b(los.?angeles|la|california|ca|seattle|us-?west|pacific)\b/i, timezoneId: "America/Los_Angeles" },
];

export const DEFAULT_EARN_TIMEZONE = "America/New_York";

export function timezoneForProxyRegion(declaredRegion: string | null | undefined): string {
  const raw = declaredRegion?.trim();
  if (!raw) return DEFAULT_EARN_TIMEZONE;
  for (const rule of REGION_TIMEZONE_RULES) {
    if (rule.match.test(raw)) return rule.timezoneId;
  }
  return DEFAULT_EARN_TIMEZONE;
}

/**
 * Alinha timezone/locale do fingerprint ao proxy (evita Mac+LA com IP da Flórida).
 * Mantém o restante do pacote (WebGL, CPU, audio seed, etc.).
 */
export function alignFingerprintToProxy(
  fingerprint: BrowserFingerprint,
  declaredRegion: string | null | undefined,
): BrowserFingerprint {
  const timezoneId = timezoneForProxyRegion(declaredRegion);
  return {
    ...fingerprint,
    timezoneId,
    locale: fingerprint.locale || "en-US",
  };
}
