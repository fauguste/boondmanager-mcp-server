import { describe, it, expect } from "vitest";
import { TokenBucket, type Clock } from "./rate-limiter.js";

/** Drain pending microtasks until the queue is quiet enough for assertions. */
async function flushMicrotasks(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/**
 * A test clock that lets us advance time deterministically. `sleep(ms)` does
 * not actually sleep — it returns a promise that resolves only when the test
 * advances the clock past the wakeup time.
 */
function createFakeClock(): Clock & {
  advance(ms: number): Promise<void>;
  current(): number;
} {
  let current = 0;
  type Pending = { wakeAt: number; resolve: () => void };
  const pending: Pending[] = [];

  return {
    now: () => current,
    sleep(ms: number): Promise<void> {
      if (ms <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        pending.push({ wakeAt: current + ms, resolve });
      });
    },
    current: () => current,
    async advance(ms: number) {
      current += ms;
      // Wake any sleepers that should have fired by now, in chronological order.
      // Process in a loop so cascading sleeps (sleep → consume → sleep again)
      // also resolve before we return.
      let progress = true;
      while (progress) {
        progress = false;
        for (let i = 0; i < pending.length; i++) {
          if (pending[i].wakeAt <= current) {
            const { resolve } = pending.splice(i, 1)[0];
            resolve();
            // Yield to the microtask queue so the awaited continuation runs
            // and any new sleep() it schedules is registered before we loop.
            await Promise.resolve();
            await Promise.resolve();
            progress = true;
            break;
          }
        }
      }
    },
  };
}

describe("TokenBucket", () => {
  it("rejects non-positive capacity / refill", () => {
    expect(() => new TokenBucket(0, 1)).toThrow();
    expect(() => new TokenBucket(1, 0)).toThrow();
    expect(() => new TokenBucket(-1, 1)).toThrow();
  });

  it("starts full at capacity", () => {
    const clock = createFakeClock();
    const b = new TokenBucket(5, 1, clock);
    expect(b.peek()).toBe(5);
  });

  it("allows a burst up to capacity without waiting", async () => {
    const clock = createFakeClock();
    const b = new TokenBucket(3, 1, clock);

    await b.acquire();
    await b.acquire();
    await b.acquire();

    expect(b.peek()).toBeLessThan(1);
  });

  it("blocks the next acquire until a token refills", async () => {
    const clock = createFakeClock();
    const b = new TokenBucket(1, 1, clock); // 1 token, refill 1/sec

    await b.acquire(); // consumes the only token

    let resolved = false;
    const pending = b.acquire().then(() => {
      resolved = true;
    });

    // Without time advance, the second acquire should be parked.
    await flushMicrotasks();
    expect(resolved).toBe(false);

    // After 1 second of refill, the bucket has 1 token again.
    await clock.advance(1000);
    await pending;
    expect(resolved).toBe(true);
  });

  it("serialises concurrent acquires (no double-spend)", async () => {
    const clock = createFakeClock();
    const b = new TokenBucket(2, 1, clock); // 2 tokens, refill 1/sec

    // Fire 4 acquires at once. The first 2 should resolve immediately, the
    // remaining 2 should each wait roughly 1s for a token refill.
    const order: number[] = [];
    const promises = [0, 1, 2, 3].map((i) =>
      b.acquire().then(() => order.push(i))
    );

    await flushMicrotasks();
    expect(order).toEqual([0, 1]);

    await clock.advance(1000);
    await flushMicrotasks();
    expect(order).toEqual([0, 1, 2]);

    await clock.advance(1000);
    await flushMicrotasks();
    expect(order).toEqual([0, 1, 2, 3]);

    await Promise.all(promises);
  });

  it("refills proportionally to elapsed time, capped at capacity", async () => {
    const clock = createFakeClock();
    const b = new TokenBucket(5, 2, clock); // 2 tokens/sec, capacity 5

    // Drain the bucket completely.
    for (let i = 0; i < 5; i++) await b.acquire();
    expect(b.peek()).toBeLessThan(1);

    // 1 second → ~2 tokens.
    await clock.advance(1000);
    expect(b.peek()).toBeCloseTo(2, 5);

    // 10 more seconds would refill 20, but capacity caps at 5.
    await clock.advance(10_000);
    expect(b.peek()).toBe(5);
  });
});
