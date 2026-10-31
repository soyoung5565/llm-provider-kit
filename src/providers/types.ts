/**
 * Provider 能力描述模型。
 *
 * 设计要点：把"某个 LLM 供应商有哪些模型、每个模型支持什么能力"表达成**纯数据**，
 * 而不是散落在各处的 if/else。上层 UI 只需要读这份数据就能渲染模型选择器、
 * 判断某个模型能不能用 tool / vision / thinking。
 */

/** 模型支持的能力开关。 */
export interface ModelCapabilities {
  /** 是否支持流式输出 */
  streaming: boolean;
  /** 是否支持 function/tool calling */
  tools: boolean;
  /** 是否支持图片输入（视觉） */
  vision: boolean;
  /** 思考/推理（chain-of-thought）相关配置 */
  thinking: ThinkingCapability;
}

/** 思考能力的三档描述：能否开关、能否调预算、默认是否开启。 */
export interface ThinkingCapability {
  /** 用户能不能手动开关思考 */
  toggleable: boolean;
  /** 用户能不能调思考 token 预算 */
  budgetAdjustable: boolean;
  /** 默认是否开启思考 */
  defaultEnabled: boolean;
}

/** 单个模型的元数据。 */
export interface ModelInfo {
  /** 调用时使用的模型 id（供应商侧的真实标识） */
  id: string;
  /** 展示名 */
  name: string;
  /** 上下文窗口 token 数 */
  contextWindow: number;
  /** 单次输出最大 token 数 */
  outputWindow: number;
  /** 能力开关 */
  capabilities: ModelCapabilities;
}

/** 供应商接入方式类型。 */
export type ProviderType =
  /** OpenAI Chat Completions 兼容（绝大多数供应商都兼容这个） */
  | 'openai'
  /** OpenAI Responses API（新一代接口，推理模型常用） */
  | 'openai-responses'
  /** Anthropic Messages API */
  | 'anthropic'
  /** NVIDIA NIM（OpenAI 兼容但有独立鉴权与特殊端点） */
  | 'nvidia-nim';

/** 供应商定义。 */
export interface ProviderConfig {
  /** 唯一 id */
  id: string;
  /** 展示名 */
  name: string;
  /** 接入方式 */
  type: ProviderType;
  /** 默认 base url */
  defaultBaseUrl: string;
  /** 是否需要 API Key */
  requiresApiKey: boolean;
  /** 图标路径（可选） */
  icon?: string;
  /** 该供应商下可选的模型 */
  models: ModelInfo[];
}

/**
 * 判断某个模型是否应当走 OpenAI **Responses** API 而非 Chat Completions。
 *
 * 背景：新一代推理模型（gpt-5.x pro、codex 系列）只提供 Responses 接口；
 * 部分中转/网关的 muse-spark-* 模型也必须在 Responses 接口上调用 ——
 * 同一个地址走 /v1/chat/completions 会直接 500。
 *
 * @param providerId 供应商 id
 * @param modelId    模型 id
 */
export function shouldUseOpenAIResponsesApi(providerId: string, modelId: string): boolean {
  if (providerId === 'openai-responses') return true;

  // 中转站 relay：muse-spark-* 必须用 /v1/responses（codex_responses 模式），
  // /v1/chat/completions 在 muse 端点上会返回 500。
  if (/^muse-spark(?:-|$)/.test(modelId)) return true;

  // GPT-5 系列的 pro / codex 变体只提供 Responses 接口。
  if (/^gpt-5\.\d+-pro(?:-|$)/.test(modelId)) return true;
  if (/^gpt-5\.(?:6|5)(?:-|$)/.test(modelId)) return true;
  if (/^gpt-5\.[3-9]-codex(?:-|$)/.test(modelId)) return true;

  return false;
}

/**
 * 判断某个模型是否走 OpenAI **Chat Completions** 兼容流式接口。
 *
 * 与 {@link shouldUseOpenAIResponsesApi} 互斥使用：二者共同决定请求打向
 * 哪个端点、是否带 `stream: true`。
 */
export function shouldUseOpenAIStreamingChatCompat(
  providerId: string,
  modelId: string,
): boolean {
  if (providerId === 'openai-responses') return false;
  if (shouldUseOpenAIResponsesApi(providerId, modelId)) return false;
  return providerId === 'openai' || providerId === 'nvidia-nim';
}

/**
 * 模型 id 是否属于"多模态"（能看图）。
 *
 * 用于在设置页自动决定要不要显示图片上传入口。
 *
 * 注意：判定必须**保守**。像 `moonshotai/kimi-k3` 这类纯文本模型，
 * 模型名里带 "kimi" 不代表支持视觉；只有 id 里明确出现
 * vision / vl / -vl 后缀这类标记时才判定为多模态。
 */
export function isVisionModel(providerId: string, modelId: string): boolean {
  if (providerId === 'openai' && /^(gpt-4o|gpt-4\.1|gpt-5)/.test(modelId)) return true;
  // 只认明确的视觉标记，避免把纯文本模型误判成多模态
  if (providerId === 'nvidia-nim' && /(vision|(^|[/_-])vl([/_-]|$))/i.test(modelId)) return true;
  return false;
}

/** 为未显式声明能力的模型补齐默认能力表。 */
export function applyModelMetadata(providers: Record<string, ProviderConfig>): void {
  for (const provider of Object.values(providers)) {
    for (const model of provider.models) {
      model.capabilities = {
        ...model.capabilities,
        vision: model.capabilities.vision ?? isVisionModel(provider.id, model.id),
      };
    }
  }
}
