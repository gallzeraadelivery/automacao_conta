/** Backoff progressivo: 1s, 5s, 15s - no maximo 3 tentativas. */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_DELAYS_MS = [1000, 5000, 15000];

export function progressiveBackoffStrategy(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade - 1, 0), BACKOFF_DELAYS_MS.length - 1);
  return BACKOFF_DELAYS_MS[index]!;
}
