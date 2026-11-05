/**
 * Request limits shared by every server instance.
 *
 * On Vercel each request may land on a different instance, so counters kept in
 * memory would each count only their own share. They live in Upstash Redis instead,
 * which every instance reads and writes. Without Redis credentials (local
 * development) an in-memory store stands in.
 */
import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type Verdict = { ok: boolean; retryAfterS?: number };

type Bucket = { max: number; windowS: number };

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && Number.isInteger(n) && n >= 0 ? n : fallback;
};

export const LIMITS = {
  /** Questions per IP: retrieval costs an embedding call, answers an LLM call. */
  ask: { max: int(process.env.RATE_LIMIT_PER_MINUTE, 20), windowS: 60 },
  /** Password attempts per IP: makes guessing the shared password impractical. */
  unlock: { max: 5, windowS: 15 * 60 },
} satisfies Record<string, Bucket>;

/** LLM answers per UTC day across everyone: the most a leaked password can cost. */
export const DAILY_ANSWER_LIMIT = int(process.env.DAILY_ANSWER_LIMIT, 200);

export interface LimitStore {
  hit(bucket: string, id: string, limit: Bucket): Promise<Verdict>;
  /** Add one to a counter that expires after two days; returns the new count. */
  increment(key: string): Promise<number>;
}

export class MemoryStore implements LimitStore {
  private hits = new Map<string, number[]>();
  private counts = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}

  async hit(bucket: string, id: string, { max, windowS }: Bucket): Promise<Verdict> {
    const key = `${bucket}:${id}`;
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowS * 1000);
    if (max > 0 && recent.length >= max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterS: Math.ceil((recent[0] + windowS * 1000 - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }

  async increment(key: string) {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
}

class RedisStore implements LimitStore {
  private limiters = new Map<string, Ratelimit>();
  constructor(private redis: Redis) {}

  async hit(bucket: string, id: string, { max, windowS }: Bucket): Promise<Verdict> {
    if (max <= 0) return { ok: true };
    let limiter = this.limiters.get(bucket);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(max, `${windowS} s`),
        prefix: `rag:limit:${bucket}`,
      });
      this.limiters.set(bucket, limiter);
    }
    const res = await limiter.limit(id);
    return res.success
      ? { ok: true }
      : { ok: false, retryAfterS: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) };
  }

  async increment(key: string) {
    const [count] = await this.redis
      .multi()
      .incr(key)
      .expire(key, 2 * 24 * 60 * 60)
      .exec<[number, number]>();
    return count;
  }
}

let store: LimitStore | undefined;

function getStore(): LimitStore {
  if (store) return store;
  // Vercel's Upstash integration names them KV_*; Upstash's own docs use UPSTASH_*.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    store = new RedisStore(new Redis({ url, token }));
  } else {
    if (process.env.VERCEL)
      console.warn("Redis is not configured: limits are per instance and reset on cold starts");
    store = new MemoryStore();
  }
  return store;
}

/**
 * Rate-limit a request. If Redis itself fails, the request is let through:
 * an outage of the limiter shouldn't take the site down.
 */
export async function checkLimit(bucket: keyof typeof LIMITS, ip: string): Promise<Verdict> {
  try {
    return await getStore().hit(bucket, ip, LIMITS[bucket]);
  } catch (err) {
    console.error("rate limit check failed", err);
    return { ok: true };
  }
}

/**
 * Count one LLM answer against today's budget. Unlike checkLimit this fails closed:
 * if the budget can't be checked, no answer is generated, because answers cost money.
 */
export async function spendAnswer(store: LimitStore = getStore(), now = new Date()) {
  if (DAILY_ANSWER_LIMIT === 0) return true;
  try {
    const day = now.toISOString().slice(0, 10);
    return (await store.increment(`rag:answers:${day}`)) <= DAILY_ANSWER_LIMIT;
  } catch (err) {
    console.error("answer budget check failed", err);
    return false;
  }
}
