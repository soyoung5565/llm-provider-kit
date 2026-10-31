/**
 * 内置 Provider 注册表。
 *
 * 每个供应商都是一份**纯数据**定义；上层只依赖 `ProviderConfig`，
 * 想加新供应商只要往 `PROVIDERS` 里加一条，不用改任何逻辑分支。
 */

import {
  applyModelMetadata,
  type ModelInfo,
  type ProviderConfig,
} from './types.js';

/** 构造一个能力齐全的模型条目，省去重复写默认值。 */
function model(
  id: string,
  name: string,
  contextWindow: number,
  outputWindow: number,
  overrides: Partial<ModelInfo['capabilities']> = {},
): ModelInfo {
  return {
    id,
    name,
    contextWindow,
    outputWindow,
    capabilities: {
      streaming: true,
      tools: false,
      vision: false,
      thinking: {
        toggleable: false,
        budgetAdjustable: false,
        defaultEnabled: false,
      },
      ...overrides,
    },
  };
}

/**
 * 全局 Provider 表。
 *
 * 新增供应商时：在此登记 + （可选）在 `types.ts` 的能力判定函数里加规则。
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    models: [
      model('gpt-4o', 'GPT-4o', 128000, 16384, {
        tools: true,
        vision: true,
        thinking: { toggleable: false, budgetAdjustable: false, defaultEnabled: false },
      }),
      model('gpt-4.1', 'GPT-4.1', 1047576, 32768, {
        tools: true,
        vision: true,
      }),
      model('gpt-5', 'GPT-5', 400000, 128000, {
        tools: true,
        vision: true,
        thinking: { toggleable: true, budgetAdjustable: true, defaultEnabled: true },
      }),
    ],
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresApiKey: true,
    models: [
      model('claude-sonnet-4-5', 'Claude Sonnet 4.5', 200000, 64000, {
        tools: true,
        vision: true,
        thinking: { toggleable: true, budgetAdjustable: true, defaultEnabled: true },
      }),
      model('claude-haiku-4-5', 'Claude Haiku 4.5', 200000, 32000, {
        tools: true,
        vision: true,
      }),
    ],
  },

  /**
   * NVIDIA NIM。
   *
   * 走 OpenAI 兼容端点，但鉴权头与部分模型元数据需要单独登记。
   * 这里以 Kimi K3 为例说明如何接入"第三方托管的开放权重模型"。
   */
  'nvidia-nim': {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    type: 'nvidia-nim',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    requiresApiKey: true,
    icon: '/logos/nvidia.svg',
    models: [
      model('moonshotai/kimi-k3', 'Kimi K3 (NVIDIA NIM)', 131072, 8192, {
        thinking: { toggleable: false, budgetAdjustable: false, defaultEnabled: true },
      }),
    ],
  },
};

// 统一补齐派生能力（vision 等）
applyModelMetadata(PROVIDERS);

/**
 * 按 id 取 Provider，找不到返回 undefined。
 */
export function getProvider(providerId: string): ProviderConfig | undefined {
  return PROVIDERS[providerId];
}

/**
 * 列出所有可用的 provider id。
 */
export function listProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * 列出某个 provider 下的所有模型 id。
 */
export function listModelIds(providerId: string): string[] {
  return PROVIDERS[providerId]?.models.map((m) => m.id) ?? [];
}

/**
 * 校验 provider/model 组合是否合法。
 *
 * 用于设置页保存前拦截"选了不存在的模型"这类错误。
 */
export function isValidModel(providerId: string, modelId: string): boolean {
  return listModelIds(providerId).includes(modelId);
}
