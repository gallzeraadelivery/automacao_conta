import { describe, it, expect } from "vitest";
import {
  ConcurrencyLimiter,
  acquireAll,
  releaseAll,
  type RedisEvalClient,
} from "./concurrencyLimiter";

/** Fake em memoria que reproduz a semantica dos scripts Lua reais. */
class FakeRedis implements RedisEvalClient {
  private counters = new Map<string, number>();

  async eval(script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const key = String(args[0]);
    const current = this.counters.get(key) ?? 0;

    if (script.includes("INCR")) {
      const limit = Number(args[1]);
      if (current >= limit) return 0;
      this.counters.set(key, current + 1);
      return 1;
    }

    if (script.includes("DECR")) {
      if (current > 0) this.counters.set(key, current - 1);
      return 1;
    }

    throw new Error("unknown script");
  }

  get(key: string): number {
    return this.counters.get(key) ?? 0;
  }
}

describe("ConcurrencyLimiter", () => {
  it("allows acquiring up to the limit and rejects beyond it", async () => {
    const redis = new FakeRedis();
    const limiter = new ConcurrencyLimiter(redis);

    expect(await limiter.acquire("proxy:1", 2)).toBe(true);
    expect(await limiter.acquire("proxy:1", 2)).toBe(true);
    expect(await limiter.acquire("proxy:1", 2)).toBe(false);
    expect(redis.get("proxy:1")).toBe(2);
  });

  it("frees a slot after release", async () => {
    const redis = new FakeRedis();
    const limiter = new ConcurrencyLimiter(redis);

    await limiter.acquire("email:1", 1);
    expect(await limiter.acquire("email:1", 1)).toBe(false);

    await limiter.release("email:1");
    expect(await limiter.acquire("email:1", 1)).toBe(true);
  });

  it("never decrements below zero", async () => {
    const redis = new FakeRedis();
    const limiter = new ConcurrencyLimiter(redis);

    await limiter.release("applicant:1");
    await limiter.release("applicant:1");
    expect(redis.get("applicant:1")).toBe(0);
  });
});

describe("acquireAll / releaseAll", () => {
  it("acquires all keys when every limit has room", async () => {
    const redis = new FakeRedis();
    const limiter = new ConcurrencyLimiter(redis);

    const result = await acquireAll(limiter, [
      { key: "company:1", limit: 5 },
      { key: "proxy:1", limit: 2 },
    ]);

    expect(result.acquired).toBe(true);
    expect(result.acquiredKeys).toEqual(["company:1", "proxy:1"]);
  });

  it("rolls back already-acquired keys when a later key is at its limit (all-or-nothing)", async () => {
    const redis = new FakeRedis();
    const limiter = new ConcurrencyLimiter(redis);

    // exhaust the email-account slot up front
    await limiter.acquire("email:1", 1);

    const result = await acquireAll(limiter, [
      { key: "company:1", limit: 5 },
      { key: "email:1", limit: 1 }, // will fail: already at limit
    ]);

    expect(result.acquired).toBe(false);
    // company:1 should have been rolled back to 0
    expect(redis.get("company:1")).toBe(0);
    // email:1's original holder is untouched
    expect(redis.get("email:1")).toBe(1);
  });

  it("enforces the per-applicant limit of 1 (no two simultaneous automations for the same driver)", async () => {
    const redis = new FakeRedis();
    const limiter = new ConcurrencyLimiter(redis);

    const first = await acquireAll(limiter, [{ key: "applicant:1", limit: 1 }]);
    const second = await acquireAll(limiter, [{ key: "applicant:1", limit: 1 }]);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);

    await releaseAll(limiter, first.acquiredKeys);
    const third = await acquireAll(limiter, [{ key: "applicant:1", limit: 1 }]);
    expect(third.acquired).toBe(true);
  });
});
