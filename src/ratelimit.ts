/**
 * In-memory token buckets: per chat, per user and one global bucket.
 *
 * The global bucket protects HEY: the anonymous public API allows 120 requests
 * a minute per client, and the bot is one client for every chat it serves, so
 * it spends at most half of that. The per-chat and per-user buckets keep one
 * busy group or one person from using the whole allowance.
 *
 * State lives in this process only; a restart forgets it. The number of keys
 * is bounded: the least recently refreshed key is dropped first.
 */

export type Decision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number; firstDenial: boolean };

type Bucket = { tokens: number; updatedAt: number; denied: boolean };

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: {
    capacity: number;
    perSeconds: number;
    maxKeys?: number;
    now?: () => number;
  }) {
    this.capacity = options.capacity;
    this.refillPerMs = options.capacity / (options.perSeconds * 1000);
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Whether `key` may spend `cost` tokens; spends them when it may. */
  take(key: string, cost = 1): Decision {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket = existing
      ? {
          tokens: Math.min(
            this.capacity,
            existing.tokens + (now - existing.updatedAt) * this.refillPerMs,
          ),
          updatedAt: now,
          denied: existing.denied,
        }
      : { tokens: this.capacity, updatedAt: now, denied: false };
    // Re-insert so Map order is least recently used first.
    this.buckets.delete(key);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      bucket.denied = false;
      this.store(key, bucket);
      return { allowed: true };
    }
    const firstDenial = !bucket.denied;
    bucket.denied = true;
    this.store(key, bucket);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((cost - bucket.tokens) / this.refillPerMs / 1000),
    );
    return { allowed: false, retryAfterSeconds, firstDenial };
  }

  get size(): number {
    return this.buckets.size;
  }

  private store(key: string, bucket: Bucket): void {
    this.buckets.set(key, bucket);
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/** The bot's limits. HEY calls are what the global bucket counts. */
export const LIMITS = {
  perChat: { capacity: 8, perSeconds: 60 },
  perUser: { capacity: 6, perSeconds: 60 },
  global: { capacity: 60, perSeconds: 60 },
} as const;

export type Limiters = {
  chat: TokenBucketLimiter;
  user: TokenBucketLimiter;
  global: TokenBucketLimiter;
};

export function createLimiters(now?: () => number): Limiters {
  const opts = now ? { now } : {};
  return {
    chat: new TokenBucketLimiter({ ...LIMITS.perChat, ...opts }),
    user: new TokenBucketLimiter({ ...LIMITS.perUser, ...opts }),
    global: new TokenBucketLimiter({ ...LIMITS.global, maxKeys: 1, ...opts }),
  };
}
