import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isRetryableFileError,
  renameWithRetry,
  writeFileAtomic,
  writeJsonFileAtomic,
} from '../src/fs/index.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lpk-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('isRetryableFileError', () => {
  it('recognises the Windows file-in-use error codes', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      expect(isRetryableFileError(Object.assign(new Error('x'), { code }))).toBe(true);
    }
  });

  it('rejects everything else', () => {
    expect(isRetryableFileError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
    expect(isRetryableFileError(new Error('plain'))).toBe(false);
    expect(isRetryableFileError(undefined)).toBe(false);
  });
});

describe('writeJsonFileAtomic', () => {
  it('writes valid JSON to the target path', async () => {
    const target = path.join(tmpDir, 'state.json');
    await writeJsonFileAtomic(target, { hello: 'world', n: 42 });

    const raw = await fs.readFile(target, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ hello: 'world', n: 42 });
  });

  it('creates missing parent directories', async () => {
    const target = path.join(tmpDir, 'nested', 'deep', 'state.json');
    await writeJsonFileAtomic(target, { ok: true });

    expect(JSON.parse(await fs.readFile(target, 'utf-8'))).toEqual({ ok: true });
  });

  it('leaves no temp files behind on success', async () => {
    const target = path.join(tmpDir, 'state.json');
    await writeJsonFileAtomic(target, { ok: true });

    const entries = await fs.readdir(tmpDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('overwrites an existing file atomically', async () => {
    const target = path.join(tmpDir, 'state.json');
    await writeJsonFileAtomic(target, { version: 1 });
    await writeJsonFileAtomic(target, { version: 2 });

    expect(JSON.parse(await fs.readFile(target, 'utf-8'))).toEqual({ version: 2 });
  });
});

describe('writeFileAtomic', () => {
  it('writes raw text', async () => {
    const target = path.join(tmpDir, 'note.txt');
    await writeFileAtomic(target, 'hello');

    expect(await fs.readFile(target, 'utf-8')).toBe('hello');
  });

  it('does not corrupt the target when the source write fails', async () => {
    const target = path.join(tmpDir, 'note.txt');
    await fs.writeFile(target, 'original');

    // 传入一个会导致写入失败的路径（目标是目录）
    const dirAsTarget = path.join(tmpDir, 'subdir');
    await fs.mkdir(dirAsTarget);

    await expect(writeFileAtomic(dirAsTarget, 'x')).rejects.toBeTruthy();
    // 原文件不受影响
    expect(await fs.readFile(target, 'utf-8')).toBe('original');
  });
});

describe('renameWithRetry', () => {
  it('renames a file', async () => {
    const from = path.join(tmpDir, 'a.txt');
    const to = path.join(tmpDir, 'b.txt');
    await fs.writeFile(from, 'data');

    await renameWithRetry(from, to);
    expect(await fs.readFile(to, 'utf-8')).toBe('data');
    await expect(fs.access(from)).rejects.toBeTruthy();
  });

  it('throws immediately on a non-retryable error', async () => {
    await expect(
      renameWithRetry(path.join(tmpDir, 'missing.txt'), path.join(tmpDir, 'x.txt')),
    ).rejects.toBeTruthy();
  });
});
