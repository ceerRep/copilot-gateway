// Read normalized cache token counts from a Chat Completions / Responses
// `usage` object. Multiple OpenAI-compatible providers report cache hits using
// different field names; this helper centralizes the variant handling so
// the usage middleware, translators, and any future call sites agree.

export type JsonObject = Record<string, unknown>;

export const asJsonObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" ? value as JsonObject : null;

export const readJsonNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

export interface ChatCompletionsCacheTokens {
  // Cached prompt tokens, ALWAYS already counted inside `prompt_tokens` for
  // every variant we recognize below. Callers that need "newly billed input
  // tokens" should compute `prompt_tokens - cacheRead` themselves.
  cacheRead: number;
  // Chat Completions has no widely adopted "cache creation" field; left at 0.
  // Anthropic Messages exposes it natively and is handled separately.
  cacheCreation: number;
}

const EMPTY: ChatCompletionsCacheTokens = { cacheRead: 0, cacheCreation: 0 };

/**
 * Resolve `cached_tokens` from a Chat Completions–shaped `usage` object,
 * tolerant of the field-name variants observed across OpenAI-compatible
 * providers.
 *
 * Variants (priority order matters: standard wins to avoid an upstream
 * accidentally adding a vendor-specific field on top):
 *
 * 1. OpenAI / vLLM / Qwen / xAI Grok (chat) — standard:
 *      usage.prompt_tokens_details.cached_tokens
 *    `prompt_tokens` already includes cached_tokens.
 *    - https://platform.openai.com/docs/guides/prompt-caching
 *    - https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html
 *      (requires `--enable-prompt-tokens-details`)
 *    - https://help.aliyun.com/zh/model-studio/user-guide/context-cache
 *
 * 2. DeepSeek — split hit/miss:
 *      usage.prompt_cache_hit_tokens / usage.prompt_cache_miss_tokens
 *    `prompt_tokens = hit + miss`.
 *    - https://api-docs.deepseek.com/guides/kv_cache
 *
 * 3. Kimi / Moonshot — flat:
 *      usage.cached_tokens (included in prompt_tokens)
 *    - https://platform.moonshot.cn/docs/api/caching
 */
export const readChatCompletionsCacheTokens = (
  usage: JsonObject | null | undefined,
): ChatCompletionsCacheTokens => {
  if (!usage) return EMPTY;

  const standard = readJsonNumber(
    asJsonObject(usage.prompt_tokens_details)?.cached_tokens,
  );
  if (standard != null) return { cacheRead: standard, cacheCreation: 0 };

  const dsHit = readJsonNumber(usage.prompt_cache_hit_tokens);
  if (dsHit != null) return { cacheRead: dsHit, cacheCreation: 0 };

  const kimi = readJsonNumber(usage.cached_tokens);
  if (kimi != null) return { cacheRead: kimi, cacheCreation: 0 };

  return EMPTY;
};
