/** Chaves Redis para interromper automação (API ↔ worker). */

export function automationStopKey(applicantId: string): string {
  return `automation:stop:${applicantId}`;
}

export function automationStopAllKey(companyId: string): string {
  return `automation:stop-all:${companyId}`;
}

export const AUTOMATION_STOP_TTL_SEC = 5 * 60;
