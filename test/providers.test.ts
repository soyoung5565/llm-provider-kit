import { describe, expect, it } from 'vitest';
import {
  applyModelMetadata,
  getProvider,
  isValidModel,
  isVisionModel,
  listModelIds,
  listProviderIds,
  PROVIDERS,
  shouldUseOpenAIResponsesApi,
  shouldUseOpenAIStreamingChatCompat,
} from '../src/providers/index.js';

describe('provider registry', () => {
  it('registers the built-in providers', () => {
    expect(listProviderIds()).toContain('openai');
    expect(listProviderIds()).toContain('anthropic');
    expect(listProviderIds()).toContain('nvidia-nim');
  });

  it('exposes NVIDIA NIM with the Kimi K3 model', () => {
    const nim = getProvider('nvidia-nim');
    expect(nim).toBeDefined();
    expect(nim!.defaultBaseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(nim!.requiresApiKey).toBe(true);
    expect(listModelIds('nvidia-nim')).toContain('moonshotai/kimi-k3');
  });

  it('returns undefined for an unknown provider', () => {
    expect(getProvider('does-not-exist')).toBeUndefined();
    expect(listModelIds('does-not-exist')).toEqual([]);
  });

  it('validates provider/model pairs', () => {
    expect(isValidModel('openai', 'gpt-4o')).toBe(true);
    expect(isValidModel('openai', 'gpt-999')).toBe(false);
    expect(isValidModel('nvidia-nim', 'moonshotai/kimi-k3')).toBe(true);
  });

  it('keeps every registered model internally consistent', () => {
    for (const provider of Object.values(PROVIDERS)) {
      for (const model of provider.models) {
        expect(model.id.length).toBeGreaterThan(0);
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(model.outputWindow).toBeGreaterThan(0);
        expect(model.capabilities.streaming).toBeTypeOf('boolean');
      }
    }
  });
});

describe('endpoint routing', () => {
  it('routes GPT-5 pro / codex variants to the Responses API', () => {
    expect(shouldUseOpenAIResponsesApi('openai', 'gpt-5.2-pro')).toBe(true);
    expect(shouldUseOpenAIResponsesApi('openai', 'gpt-5.4-codex')).toBe(true);
    expect(shouldUseOpenAIResponsesApi('openai', 'gpt-5.6')).toBe(true);
    expect(shouldUseOpenAIResponsesApi('openai', 'gpt-5.5')).toBe(true);
  });

  it('routes muse-spark models to the Responses API', () => {
    // muse 端点走 /v1/chat/completions 会 500，必须走 responses
    expect(shouldUseOpenAIResponsesApi('openai', 'muse-spark')).toBe(true);
    expect(shouldUseOpenAIResponsesApi('openai', 'muse-spark-1.3-contributor-free')).toBe(true);
  });

  it('does not route plain chat models to the Responses API', () => {
    expect(shouldUseOpenAIResponsesApi('openai', 'gpt-4o')).toBe(false);
    expect(shouldUseOpenAIResponsesApi('openai', 'gpt-4.1')).toBe(false);
    expect(shouldUseOpenAIResponsesApi('openai', 'muse-something-else')).toBe(false);
  });

  it('routes the openai-responses provider type to the Responses API', () => {
    expect(shouldUseOpenAIResponsesApi('openai-responses', 'gpt-4o')).toBe(true);
  });

  it('keeps the two routing predicates mutually exclusive', () => {
    for (const providerId of listProviderIds()) {
      for (const modelId of listModelIds(providerId)) {
        const responses = shouldUseOpenAIResponsesApi(providerId, modelId);
        const chatCompat = shouldUseOpenAIStreamingChatCompat(providerId, modelId);
        expect(responses && chatCompat).toBe(false);
      }
    }
  });

  it('uses chat-compat streaming for openai and nvidia-nim', () => {
    expect(shouldUseOpenAIStreamingChatCompat('openai', 'gpt-4o')).toBe(true);
    expect(shouldUseOpenAIStreamingChatCompat('nvidia-nim', 'moonshotai/kimi-k3')).toBe(true);
    expect(shouldUseOpenAIStreamingChatCompat('anthropic', 'claude-sonnet-4-5')).toBe(false);
  });
});

describe('capability inference', () => {
  it('detects vision models', () => {
    expect(isVisionModel('openai', 'gpt-4o')).toBe(true);
    expect(isVisionModel('openai', 'gpt-4.1-mini')).toBe(true);
    expect(isVisionModel('nvidia-nim', 'moonshotai/kimi-k3')).toBe(false);
  });

  it('backfills missing capabilities without overwriting declared ones', () => {
    const providers = {
      demo: {
        id: 'demo',
        name: 'Demo',
        type: 'openai' as const,
        defaultBaseUrl: 'https://example.com/v1',
        requiresApiKey: true,
        models: [
          {
            id: 'demo-vision',
            name: 'Demo Vision',
            contextWindow: 1000,
            outputWindow: 100,
            capabilities: {
              streaming: true,
              tools: false,
              vision: false,
              thinking: {
                toggleable: false,
                budgetAdjustable: false,
                defaultEnabled: false,
              },
            },
          },
        ],
      },
    };

    applyModelMetadata(providers);
    // vision 被显式声明为 false，applyModelMetadata 不应强行覆盖
    expect(providers.demo.models[0]!.capabilities.vision).toBe(false);
  });
});
