/**
 * 有界并发执行器。
 *
 * 背景：批量生成 TTS / 批量调 LLM 时，串行 await 会让总耗时线性叠加；
 * 但完全并发又可能打爆下游限流。正确做法是**固定数量的 worker 抢任务队列**。
 *
 * 与朴素的 `Promise.all(tasks.map(fn))` 的区别：后者并发数 = 任务数。
 * 这里并发数固定为 `concurrency`，且 worker 数量不会超过任务数。
 */

/** 并发执行选项。 */
export interface PoolOptions {
  /** 最大并发数，默认 4 */
  concurrency?: number;
  /** 单个任务失败时是否继续，默认 true（失败不中断整批） */
  continueOnError?: boolean;
  /** 任务失败回调，用于打日志 */
  onError?: (error: unknown, task: unknown, index: number) => void;
}

/** 单个任务的结果状态。 */
export type TaskOutcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

/**
 * 以固定并发度执行一组任务，返回每个任务的成败结果。
 *
 * **顺序保证**：返回数组的第 i 项对应输入数组的第 i 个任务，
 * 无论实际完成顺序如何。
 *
 * @example
 * ```ts
 * const results = await runWithConcurrency(
 *   items.map((it) => () => generateTts(it.text)),
 *   { concurrency: 4 },
 * );
 * const ok = results.filter((r) => r.status === 'fulfilled');
 * ```
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  options: PoolOptions = {},
): Promise<Array<TaskOutcome<T>>> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const continueOnError = options.continueOnError ?? true;
  const results = new Array<TaskOutcome<T>>(tasks.length);

  if (tasks.length === 0) return results;

  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    // 每个 worker 循环抢下一个任务，直到队列空
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;

      const task = tasks[index]!;
      try {
        results[index] = { status: 'fulfilled', value: await task() };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
        options.onError?.(error, task, index);
        if (!continueOnError) {
          // 抛出以中断其它 worker；已完成的 results 仍会被返回
          throw error;
        }
      }
    }
  };

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * {@link runWithConcurrency} 的"只要成功值"版本。
 *
 * 失败项被丢弃；配合 `onError` 使用可以既拿到数据又看到错误。
 */
export async function runWithConcurrencySettled<T>(
  tasks: Array<() => Promise<T>>,
  options: PoolOptions = {},
): Promise<T[]> {
  const outcomes = await runWithConcurrency(tasks, options);
  return outcomes
    .filter((o): o is { status: 'fulfilled'; value: T } => o.status === 'fulfilled')
    .map((o) => o.value);
}

/**
 * 从环境变量读取并发度，带安全兜底。
 *
 * 解析规则：非法值 / 负数 / 0 → 回退到 `fallback`。
 */
export function concurrencyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  key = 'TTS_CONCURRENCY',
  fallback = 4,
): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}
