import { describe, expect, it } from 'vitest';

import { TokenBucketLimiter } from '../src/ratelimit.js';

describe('TokenBucketLimiter', () => {
  it('allows the capacity, then refuses with a retry delay and refills over time', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 3, perSeconds: 60, now: () => now });
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 20, firstDenial: true });
    expect(limiter.take('a')).toMatchObject({ allowed: false, firstDenial: false });
    now += 20_000;
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toMatchObject({ allowed: false, firstDenial: true });
  });

  it('keeps keys apart', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, perSeconds: 60, now: () => 0 });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });

  it('never holds more than maxKeys, dropping the least recently used', () => {
    const limiter = new TokenBucketLimiter({
      capacity: 1,
      perSeconds: 60,
      maxKeys: 3,
      now: () => 0,
    });
    for (const key of ['a', 'b', 'c', 'd']) limiter.take(key);
    expect(limiter.size).toBe(3);
    // 'a' was dropped, so it starts with a full bucket again.
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.size).toBe(3);
  });

  it('never refills past capacity', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 2, perSeconds: 1, now: () => now });
    limiter.take('a');
    now += 1_000_000;
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });
});
