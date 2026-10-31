import { describe, expect, it } from 'vitest';
import {
  concurrencyFromEnv,
  runWithConcurrency,
  runWithConcurrencySettled,
} from '../src/concurrency/index.js';

/** 记录某一时刻正在执行的任务数。 */
function makeTracker() {
  let current = 0;
  let peak = 0;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      current += 1;
      peak = Math.max(peak, current);
      try {
        return await fn();
      } finally {
        current -= 1;
      }
    },
    get peak() {
      return peak;
    },
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('runWithConcurrency', () => {
  it('returns an empty array for no tasks', async () => {
    await expect(runWithConcurrency([])).resolves.toEqual([]);
  });

  it('preserves input order regardless of completion order', async () => {
    const results = await runWithConcurrency([
      async () => {
        await tick(30);
        return 'slow';
      },
      async () => {
        await tick(1);
        return 'fast';
      },
      async () => 'instant',
    ]);

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason))).toEqual([
      'slow',
      'fast',
      'instant',
    ]);
  });

  it('never exceeds the concurrency limit', async () => {
    const tracker = makeTracker();
    const tasks = Array.from({ length: 20 }, (_, i) => () =>
      tracker.run(async () => {
        await tick(5);
        return i;
      }),
    );

    await runWithConcurrency(tasks, { concurrency: 4 });
    expect(tracker.peak).toBeLessThanOrEqual(4);
    expect(tracker.peak).toBeGreaterThan(1);
  });

  it('never spawns more workers than there are tasks', async () => {
    const tracker = makeTracker();
    const tasks = Array.from({ length: 2 }, (_, i) => () =>
      tracker.run(async () => {
        await tick(5);
        return i;
      }),
    );

    await runWithConcurrency(tasks, { concurrency: 10 });
    expect(tracker.peak).toBeLessThanOrEqual(2);
  });

  it('isolates failures when continueOnError is on', async () => {
    const results = await runWithConcurrency([
      async () => 'ok-1',
      async () => {
        throw new Error('boom');
      },
      async () => 'ok-2',
    ]);

    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(results[2]!.status).toBe('fulfilled');
  });

  it('reports failures through onError', async () => {
    const seen: number[] = [];
    await runWithConcurrency(
      [
        async () => 'ok',
        async () => {
          throw new Error('boom');
        },
      ],
      {
        onError: (_err, _task, index) => seen.push(index),
      },
    );

    expect(seen).toEqual([1]);
  });

  it('stops the batch when continueOnError is off', async () => {
    await expect(
      runWithConcurrency(
        [
          async () => {
            throw new Error('boom');
          },
          async () => 'never-runs',
        ],
        { continueOnError: false },
      ),
    ).rejects.toThrow('boom');
  });

  it('drops rejected tasks in the settled variant', async () => {
    const values = await runWithConcurrencySettled([
      async () => 1,
      async () => {
        throw new Error('boom');
      },
      async () => 3,
    ]);

    expect(values).toEqual([1, 3]);
  });
});

describe('concurrencyFromEnv', () => {
  it('reads a valid value', () => {
    expect(concurrencyFromEnv({ TTS_CONCURRENCY: '8' } as NodeJS.ProcessEnv)).toBe(8);
  });

  it('falls back on missing, invalid, or non-positive values', () => {
    expect(concurrencyFromEnv({} as NodeJS.ProcessEnv)).toBe(4);
    expect(concurrencyFromEnv({ TTS_CONCURRENCY: 'abc' } as NodeJS.ProcessEnv)).toBe(4);
    expect(concurrencyFromEnv({ TTS_CONCURRENCY: '0' } as NodeJS.ProcessEnv)).toBe(4);
    expect(concurrencyFromEnv({ TTS_CONCURRENCY: '-3' } as NodeJS.ProcessEnv)).toBe(4);
  });

  it('honours a custom key and fallback', () => {
    expect(
      concurrencyFromEnv({ MY_LIMIT: '3' } as NodeJS.ProcessEnv, 'MY_LIMIT', 2),
    ).toBe(3);
    expect(concurrencyFromEnv({} as NodeJS.ProcessEnv, 'MY_LIMIT', 2)).toBe(2);
  });
});
