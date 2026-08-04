/**
 * Pool de fingerprints para `browser.newContext`.
 *
 * - **Desktop** no signup (portal / Earn / identifier) — UI desktop que já funciona.
 * - **Mobile** (Android/iPhone) só depois da conta criada — Take Photo Veriff/Socure.
 */
export interface BrowserFingerprint {
  id: string;
  userAgent: string;
  viewport: { width: number; height: number };
  timezoneId: string;
  locale: string;
  deviceScaleFactor: number;
  /** Emula touch / mobile no Playwright newContext. */
  isMobile?: boolean;
  hasTouch?: boolean;
}

/** Desktop — signup / portal até criar a conta. */
export const DESKTOP_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  {
    id: "chrome-mac-1440",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 2,
  },
  {
    id: "chrome-win-1920",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "America/Chicago",
    locale: "en-US",
    deviceScaleFactor: 1,
  },
  {
    id: "chrome-mac-1680",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    deviceScaleFactor: 2,
  },
  {
    id: "chrome-win-1366",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    timezoneId: "America/Denver",
    locale: "en-US",
    deviceScaleFactor: 1,
  },
] as const;

/** Mobile — hub / Documents / Take Photo (Veriff/Socure). */
export const MOBILE_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  {
    id: "chrome-android-pixel7",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  {
    id: "safari-iphone-15",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    viewport: { width: 393, height: 852 },
    timezoneId: "America/Chicago",
    locale: "en-US",
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
] as const;

/** Alias histórico = desktop (signup). */
export const BROWSER_FINGERPRINT_POOL = DESKTOP_FINGERPRINT_POOL;

/** Fingerprint de signup: desktop em rodízio. */
export function pickFingerprint(attemptIndex: number): BrowserFingerprint {
  return pickDesktopFingerprint(attemptIndex);
}

/** Desktop pelo índice. */
export function pickDesktopFingerprint(attemptIndex: number): BrowserFingerprint {
  const pool = DESKTOP_FINGERPRINT_POOL;
  return pool[attemptIndex % pool.length]!;
}

/** Mobile (Android/iPhone) — pós-conta / Take Photo. */
export function pickMobileFingerprint(attemptIndex: number): BrowserFingerprint {
  const pool = MOBILE_FINGERPRINT_POOL;
  return pool[attemptIndex % pool.length]!;
}
