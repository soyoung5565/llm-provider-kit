# llm-provider-kit

> 可复用的 LLM 接入工具集：**多供应商 Provider 定义** · **Anthropic 兼容端点适配** · **有界并发执行器** · **Windows 安全原子写**。
> *A reusable toolkit for wiring up LLM providers: provider metadata, Anthropic-compatible auth, bounded concurrency, and Windows-safe atomic writes.*

[![npm](https://img.shields.io/badge/npm-llm--provider--kit-7F52FF?logo=npm&logoColor=white)](https://www.npmjs.com/package/llm-provider-kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-44%20passed-brightgreen?logo=vitest&logoColor=white)](test/)

---

## 📖 这是什么

做 AI 应用时，有四类问题几乎每个项目都会踩到，且**解法高度通用**：

| 问题 | 典型症状 | 本库的做法 |
|---|---|---|
| **供应商接入** | 每加一个 LLM 就要改一堆 if/else | 把模型元数据表达成纯数据（`PROVIDERS` 表），上层只读数据 |
| **端点选择** | 同一个模型该打 `/v1/chat/completions` 还是 `/v1/responses`？打错就 500 | 集中判定函数，Responses 与 ChatCompat 两套谓词**互斥**保证 |
| **批量调用** | 串行 await 太慢，全并发会打爆限流 | 固定数量的 worker 抢任务队列的有界并发池 |
| **状态落盘** | Windows 上 `fs.rename` 偶发 EPERM/EACCES/EBUSY | 带线性退避的原子写，只重试"文件被占用"类错误 |

这四块能力最初是从我给 [THU-MAIC](https://github.com/THU-MAIC/OpenMAIC) 做的贡献里提炼出来的，
后来发现每次新项目都要重写一遍，于是抽成了这个独立库。

---

## ✨ 核心能力

### 1. Provider 注册表（数据驱动）

```ts
import { PROVIDERS, listModelIds } from 'llm-provider-kit';

PROVIDERS['nvidia-nim'].models;  // [{ id: 'moonshotai/kimi-k3', contextWindow: 131072, ... }]
listModelIds('nvidia-nim');      // ['moonshotai/kimi-k3']
```

内置 `openai` / `anthropic` / `nvidia-nim` 三个供应商，每个模型带完整能力元数据
（streaming / tools / vision / thinking 可开关性与预算可调性）。

**加一个新供应商 = 加一条数据，不改任何逻辑分支。**

### 2. 端点路由（两个互斥谓词）

```ts
import { shouldUseOpenAIResponsesApi, shouldUseOpenAIStreamingChatCompat } from 'llm-provider-kit';

shouldUseOpenAIResponsesApi('openai', 'gpt-5.4-codex');            // true → 走 /v1/responses
shouldUseOpenAIResponsesApi('openai', 'muse-spark-1.3');            // true → 中转站必须走 responses
shouldUseOpenAIStreamingChatCompat('openai', 'gpt-4o');            // true → 走 /v1/chat/completions
```

> **踩过的坑**：`muse-spark-*` 模型走 `/v1/chat/completions` 会直接 **500**，
> 必须在 `/v1/responses`（codex_responses 模式）上调用。
> 库里把这条规则固化成了谓词，并加了测试保证两个谓词互斥。

### 3. Anthropic 兼容端点鉴权

```ts
import { buildAnthropicHeaders } from 'llm-provider-kit';

buildAnthropicHeaders({
  apiKey: process.env.ANTHROPIC_KEY!,
  baseUrl: 'https://api.minimaxi.com/anthropic',
});
// → { 'X-Api-Key': '...', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
```

> **踩过的坑**：部分 Anthropic 兼容端点（MiniMax 等）要求 API Key 放在
> **`X-Api-Key`** 头里，而不是标准的 `Authorization: Bearer`。
> 用标准方式请求会得到 401。库里按 base url 自动判定，也可用 `authScheme` 强制指定。

### 4. 有界并发池

```ts
import { runWithConcurrency, concurrencyFromEnv } from 'llm-provider-kit';

const results = await runWithConcurrency(
  sentences.map((s) => () => synthesizeTts(s)),
  { concurrency: concurrencyFromEnv(process.env, 'TTS_CONCURRENCY', 4) },
);
// results[i] 对应输入的第 i 个任务，与完成顺序无关
```

- 并发数固定，**不会**出现 `Promise.all` 那种"任务数=并发数"的问题
- worker 数量不会超过任务数
- 单个任务失败不中断整批（`continueOnError: false` 可改为中断）
- `onError` 回调拿到 `(error, task, index)`

### 5. Windows 安全原子写

```ts
import { writeJsonFileAtomic } from 'llm-provider-kit';

await writeJsonFileAtomic('/data/state.json', { ok: true });
```

> **踩过的坑**：Windows 上 `fs.rename(temp, target)` 会**间歇性失败** ——
> 目标文件正被文件监视器 / 杀毒软件短暂持有时抛 `EPERM` / `EACCES` / `EBUSY`。
> Linux/macOS 不会复现。库里带线性退避重试（默认 8 次），且**只**重试这三类错误，
> 其它错误（如 `ENOENT`）立即抛出，不会掩盖真实问题。

---

## 🚀 快速开始

```bash
npm install llm-provider-kit
```

```ts
import {
  PROVIDERS,
  shouldUseOpenAIResponsesApi,
  buildAnthropicHeaders,
  runWithConcurrency,
  writeJsonFileAtomic,
} from 'llm-provider-kit';
```

按需引入单个模块，减小打包体积：

```ts
import { PROVIDERS } from 'llm-provider-kit/providers';
import { runWithConcurrency } from 'llm-provider-kit/concurrency';
import { writeJsonFileAtomic } from 'llm-provider-kit/fs';
import { buildAnthropicHeaders } from 'llm-provider-kit/compat';
```

---

## 🧪 测试

```bash
npm install
npm test          # 44 个用例
npm run typecheck # tsc --noEmit，strict + noUncheckedIndexedAccess
npm run build     # 产出 dist/（含 .d.ts 与 source map）
```

测试覆盖的关键行为：

| 文件 | 覆盖内容 |
|---|---|
| `test/providers.test.ts` | Provider 注册表完整性、端点路由规则、**两个路由谓词互斥**、能力推导 |
| `test/compat.test.ts` | 鉴权方式自动判定、请求头构造、密钥不泄漏到非鉴权头 |
| `test/concurrency.test.ts` | 并发上限不被突破、**结果顺序与完成顺序解耦**、失败隔离、`env` 解析兜底 |
| `test/fs.test.ts` | 原子写正确性、目录自动创建、无临时文件残留、非重试错误立即抛出 |

---

## 🏗️ 项目结构

```
src/
├── index.ts              # 公共 API 入口（re-export 四个模块）
├── providers/
│   ├── types.ts          # ProviderConfig / ModelInfo / 能力判定谓词
│   ├── registry.ts       # PROVIDERS 表（NIM、OpenAI、Anthropic）
│   └── index.ts
├── compat/
│   └── anthropic.ts      # X-Api-Key vs Bearer 鉴权适配
├── concurrency/
│   └── pool.ts           # 有界并发执行器
└── fs/
    └── atomic.ts         # Windows 安全原子写 + rename 重试
test/                     # vitest，44 个用例
```

---

## 🔗 与上游项目的关系

本库的四个能力最初来自我为 **[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)**
（清华多智能体课堂）提交的贡献分支。原仓库是大型 Next.js 应用，直接 fork 整个仓库
对使用者没有价值，因此把这几块**可独立复用**的逻辑重写并抽成这个库。

| 本库模块 | 上游对应改动 |
|---|---|
| `providers` | 新增 NVIDIA NIM provider + Kimi K3 模型元数据；muse-spark 走 Responses API |
| `compat` | MiniMax anthropic-compat 端点需 `X-Api-Key` 头 |
| `concurrency` | TTS 并行生成（`TTS_CONCURRENCY`，默认 4） |
| `fs` | Windows 上原子重命名的 EPERM/EACCES/EBUSY 退避重试 |

上游仓库采用 MIT 协议，本库同样以 MIT 发布。

---

## 📄 License

MIT © soyoung5565
