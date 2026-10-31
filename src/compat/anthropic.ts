/**
 * Anthropic 兼容端点适配。
 *
 * 问题背景：不少中转/代理服务在对外暴露 Anthropic Messages API 时，
 * **要求把 API Key 放在 `X-Api-Key` 头里**，而不是标准的
 * `Authorization: Bearer <key>`。用标准方式请求会得到 401。
 *
 * 这个模块把这类差异收敛成一个函数：调用方只管说"我要发 Anthropic 风格请求"，
 * 由它决定用哪种鉴权头。
 */

/** Anthropic 风格请求头构造选项。 */
export interface AnthropicHeaderOptions {
  /** API Key */
  apiKey: string;
  /**
   * 鉴权方式。
   *
   * - `x-api-key`：写 `X-Api-Key: <key>`（Anthropic 官方兼容端点、部分中转）
   * - `bearer`：写 `Authorization: Bearer <key>`（OpenAI 兼容端点）
   * - `auto`：先按 `x-api-key` 构造（见 {@link detectAuthScheme}）
   */
  authScheme?: 'x-api-key' | 'bearer' | 'auto';
  /** anthropic-version 头，默认 2023-06-01 */
  version?: string;
  /** 额外自定义头 */
  extraHeaders?: Record<string, string>;
}

/**
 * 猜测某个 base url 应该用哪种鉴权头。
 *
 * 规则（可按需扩展）：
 * - 官方 api.anthropic.com → `x-api-key`
 * - MiniMax 的 anthropic 兼容端点 → `x-api-key`
 * - 其余（自建代理、OpenAI 兼容） → `bearer`
 */
export function detectAuthScheme(baseUrl: string): 'x-api-key' | 'bearer' {
  const url = baseUrl.toLowerCase();
  if (url.includes('anthropic.com')) return 'x-api-key';
  if (url.includes('minimaxi.com') || url.includes('minimax.io')) return 'x-api-key';
  return 'bearer';
}

/**
 * 构造 Anthropic Messages API 的请求头。
 *
 * @example
 * ```ts
 * const headers = buildAnthropicHeaders({
 *   apiKey: process.env.ANTHROPIC_KEY!,
 *   baseUrl: 'https://api.minimaxi.com/anthropic',
 * });
 * // → { 'X-Api-Key': '...', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
 * ```
 */
export function buildAnthropicHeaders(
  options: AnthropicHeaderOptions & { baseUrl?: string },
): Record<string, string> {
  const scheme =
    options.authScheme && options.authScheme !== 'auto'
      ? options.authScheme
      : options.baseUrl
        ? detectAuthScheme(options.baseUrl)
        : 'x-api-key';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': options.version ?? '2023-06-01',
  };

  if (scheme === 'x-api-key') {
    headers['X-Api-Key'] = options.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }

  return { ...headers, ...(options.extraHeaders ?? {}) };
}

/**
 * 判断请求头里是否带有 Anthropic 风格的 `X-Api-Key`。
 *
 * 用于测试断言与调试输出。
 */
export function hasXApiKey(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([key, value]) => key.toLowerCase() === 'x-api-key' && value.length > 0,
  );
}
