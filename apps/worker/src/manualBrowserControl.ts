/**
 * Controle do browser manual via Redis (API ↔ worker).
 * - stop: operador pediu fechar → runner fecha o Chromium
 * - active-job: evita reabrir Chromium quando BullMQ reentrega job stalled
 *   (ex.: tsx watch reiniciou o worker com a janela ainda aberta)
 */
export function manualBrowserStopKey(applicantId: string): string {
  return `manual-browser:stop:${applicantId}`;
}

export function manualBrowserActiveJobKey(applicantId: string): string {
  return `manual-browser:active-job:${applicantId}`;
}

export const MANUAL_BROWSER_STOP_TTL_SEC = 120;
export const MANUAL_BROWSER_ACTIVE_TTL_SEC = 4 * 60 * 60;
