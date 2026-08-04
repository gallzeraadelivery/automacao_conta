/** Espelha apps/worker/src/manualBrowserControl.ts (mesmas chaves Redis). */
export function manualBrowserStopKey(applicantId: string): string {
  return `manual-browser:stop:${applicantId}`;
}

export function manualBrowserActiveJobKey(applicantId: string): string {
  return `manual-browser:active-job:${applicantId}`;
}

export const MANUAL_BROWSER_STOP_TTL_SEC = 120;
