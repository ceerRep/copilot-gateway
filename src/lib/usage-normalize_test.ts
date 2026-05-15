import { assertEquals } from "@std/assert";
import { readChatCompletionsCacheTokens } from "./usage-normalize.ts";

Deno.test("readChatCompletionsCacheTokens: OpenAI standard prompt_tokens_details.cached_tokens", () => {
  const result = readChatCompletionsCacheTokens({
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_tokens_details: { cached_tokens: 60 },
  });
  assertEquals(result, { cacheRead: 60, cacheCreation: 0 });
});

Deno.test("readChatCompletionsCacheTokens: DeepSeek prompt_cache_hit_tokens", () => {
  const result = readChatCompletionsCacheTokens({
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_cache_hit_tokens: 70,
    prompt_cache_miss_tokens: 30,
  });
  assertEquals(result, { cacheRead: 70, cacheCreation: 0 });
});

Deno.test("readChatCompletionsCacheTokens: Kimi/Moonshot flat cached_tokens", () => {
  const result = readChatCompletionsCacheTokens({
    prompt_tokens: 100,
    completion_tokens: 20,
    cached_tokens: 50,
  });
  assertEquals(result, { cacheRead: 50, cacheCreation: 0 });
});

Deno.test("readChatCompletionsCacheTokens: returns zeros when no cache field present", () => {
  const result = readChatCompletionsCacheTokens({
    prompt_tokens: 100,
    completion_tokens: 20,
  });
  assertEquals(result, { cacheRead: 0, cacheCreation: 0 });
});

Deno.test("readChatCompletionsCacheTokens: standard wins over vendor variants when both present", () => {
  // If an upstream returned both standard and vendor-specific fields, the
  // standard reading must win so we don't double-count or pick up an
  // accidentally populated vendor field.
  const result = readChatCompletionsCacheTokens({
    prompt_tokens: 100,
    prompt_tokens_details: { cached_tokens: 40 },
    prompt_cache_hit_tokens: 99,
    cached_tokens: 88,
  });
  assertEquals(result, { cacheRead: 40, cacheCreation: 0 });
});

Deno.test("readChatCompletionsCacheTokens: handles null/undefined usage", () => {
  assertEquals(readChatCompletionsCacheTokens(null), {
    cacheRead: 0,
    cacheCreation: 0,
  });
  assertEquals(readChatCompletionsCacheTokens(undefined), {
    cacheRead: 0,
    cacheCreation: 0,
  });
});

Deno.test("readChatCompletionsCacheTokens: ignores non-numeric vendor fields", () => {
  const result = readChatCompletionsCacheTokens({
    prompt_tokens: 100,
    cached_tokens: "60" as unknown as number,
  });
  assertEquals(result, { cacheRead: 0, cacheCreation: 0 });
});
