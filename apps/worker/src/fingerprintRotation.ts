import type IORedis from "ioredis";

/** Índice de fingerprint persistente por motorista (sobrevive a retries BullMQ). */
export function fingerprintRotationKey(applicantId: string): string {
  return `automation:fingerprint-index:${applicantId}`;
}

const TTL_SEC = 7 * 24 * 60 * 60;

/** Lê o índice atual (0 se ainda não houver rotação). */
export async function getFingerprintIndex(
  redis: IORedis,
  applicantId: string,
): Promise<number> {
  const raw = await redis.get(fingerprintRotationKey(applicantId));
  const n = raw == null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Avança o índice (INCR) e renova TTL.
 * Usar em toda falha que exige novo fingerprint (ex.: OTP e-mail não chegou).
 */
export async function advanceFingerprintIndex(
  redis: IORedis,
  applicantId: string,
): Promise<number> {
  const key = fingerprintRotationKey(applicantId);
  const next = await redis.incr(key);
  await redis.expire(key, TTL_SEC).catch(() => undefined);
  return next;
}
