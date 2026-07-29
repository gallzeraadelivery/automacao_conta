/**
 * Subconjunto do cliente ioredis que o limiter precisa - permite injetar um
 * fake em memoria nos testes, sem depender de um Redis real.
 */
export interface RedisEvalClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const ACQUIRE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then
  return 0
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  redis.call('DECR', KEYS[1])
end
return 1
`;

const DEFAULT_SAFETY_TTL_SECONDS = 3600;

/**
 * Limite de concorrencia por chave (empresa/proxy/conta de e-mail/motorista)
 * usando um contador atomico no Redis. BullMQ open-source nao tem grupos de
 * concorrencia nativos - isso substitui essa funcionalidade sem depender de
 * BullMQ Pro. O TTL de seguranca evita que um slot fique preso para sempre
 * se um worker cair sem liberar.
 */
export class ConcurrencyLimiter {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly safetyTtlSeconds: number = DEFAULT_SAFETY_TTL_SECONDS,
  ) {}

  async acquire(key: string, limit: number): Promise<boolean> {
    const result = await this.redis.eval(ACQUIRE_SCRIPT, 1, key, limit, this.safetyTtlSeconds);
    return result === 1;
  }

  async release(key: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key);
  }
}

export interface ConcurrencyRequest {
  key: string;
  limit: number;
}

export interface AcquireAllResult {
  acquired: boolean;
  acquiredKeys: string[];
}

/**
 * Adquire varias chaves atomicamente do ponto de vista logico: se qualquer
 * uma falhar, libera as que ja tinham sido adquiridas (tudo ou nada).
 */
export async function acquireAll(
  limiter: ConcurrencyLimiter,
  requests: ConcurrencyRequest[],
): Promise<AcquireAllResult> {
  const acquiredKeys: string[] = [];

  for (const request of requests) {
    const ok = await limiter.acquire(request.key, request.limit);
    if (!ok) {
      for (const key of acquiredKeys) {
        await limiter.release(key);
      }
      return { acquired: false, acquiredKeys: [] };
    }
    acquiredKeys.push(request.key);
  }

  return { acquired: true, acquiredKeys };
}

export async function releaseAll(limiter: ConcurrencyLimiter, keys: string[]): Promise<void> {
  for (const key of keys) {
    await limiter.release(key);
  }
}
