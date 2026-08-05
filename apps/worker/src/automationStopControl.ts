/** Espelha apps/api/src/lib/automationStopControl.ts (mesmas chaves Redis). */

export function automationStopKey(applicantId: string): string {
  return `automation:stop:${applicantId}`;
}

export function automationStopAllKey(companyId: string): string {
  return `automation:stop-all:${companyId}`;
}

export const AUTOMATION_STOP_TTL_SEC = 5 * 60;
