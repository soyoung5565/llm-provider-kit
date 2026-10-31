/**
 * Windows 安全的原子文件写入。
 *
 * 问题背景：`fs.rename(temp, target)` 在 Windows 上会**间歇性失败**：
 * 目标文件可能正被文件监视器、杀毒软件、索引服务短暂持有，
 * 于是 rename 抛 EPERM / EACCES / EBUSY。
 *
 * 典型场景：写 JSON 状态文件时，正好有 IDE 或同步盘在扫这个目录。
 * Linux/macOS 上同样的代码不会复现 —— 这是典型的"只在 Windows 上炸"的坑。
 *
 * 解决：带指数退避的重试。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** 原子写入选项。 */
export interface AtomicWriteOptions {
  /** 最大重试次数，默认 8 */
  retries?: number;
  /** 首次退避基数（毫秒），默认 50；第 n 次退避 = base * (n+1) */
  backoffMs?: number;
  /** 目标目录不存在时是否自动创建，默认 true */
  ensureDir?: boolean;
}

/** 只有这些错误码值得重试；其他错误直接抛出。 */
const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * 判断一个错误是否属于"文件被占用"类可重试错误。
 */
export function isRetryableFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

/**
 * 原子地把数据写入文件：先写临时文件，再 rename 覆盖。
 *
 * @example
 * ```ts
 * await writeJsonFileAtomic('/data/state.json', { ok: true });
 * ```
 */
export async function writeJsonFileAtomic(
  filePath: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFileAtomic(filePath, content, options);
}

/**
 * 原子地把文本写入文件。
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const retries = options.retries ?? 8;
  const backoffMs = options.backoffMs ?? 50;
  const dir = path.dirname(filePath);

  if (options.ensureDir !== false) {
    await fs.mkdir(dir, { recursive: true });
  }

  // 临时文件名带 pid + 时间戳，避免并发写同一目标时互相覆盖
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.writeFile(tempFilePath, content, 'utf-8');
  } catch (error) {
    await safeUnlink(tempFilePath);
    throw error;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.rename(tempFilePath, filePath);
      return;
    } catch (error) {
      if (!isRetryableFileError(error)) {
        await safeUnlink(tempFilePath);
        throw error;
      }
      lastError = error;
      // 线性退避：50ms, 100ms, 150ms ...
      await delay(backoffMs * (attempt + 1));
    }
  }

  await safeUnlink(tempFilePath);
  throw lastError ?? new Error(`Failed to rename ${tempFilePath} -> ${filePath}`);
}

/**
 * 带重试的 `fs.rename`，只重试"文件被占用"类错误。
 *
 * 适合迁移既有代码里裸调 `fs.rename` 的地方。
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const retries = options.retries ?? 8;
  const backoffMs = options.backoffMs ?? 50;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      if (!isRetryableFileError(error)) throw error;
      lastError = error;
      await delay(backoffMs * (attempt + 1));
    }
  }
  throw lastError ?? new Error(`Failed to rename ${from} -> ${to}`);
}

/** 删除文件，忽略所有失败（清理临时文件的最佳努力）。 */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    /* 忽略清理失败 */
  }
}

/** 睡一会儿。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
