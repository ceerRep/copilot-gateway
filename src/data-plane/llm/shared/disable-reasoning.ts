// Vendor-aware reasoning-disable helpers. Each takes the upstream's
// `enabledFixes` set and emits explicit-disable signals on top of the
// OpenAI-standard strip.
//
// Why disable at all: DeepSeek's reasoner models and vLLM-served
// reasoning models are known to reject the combination of forced
// `tool_choice` + reasoning. Other upstreams may accept the
// combination — the consuming flag is admin opt-in per upstream.
//
// Signals emitted:
//
//   Default (no vendor flag): just remove `reasoning_effort` /
//     `reasoning`. Works for non-reasoning models; reasoning-only
//     models keep their model-default effort because OpenAI standard
//     has no off switch.
//
//   `vendor-deepseek`: also emit `thinking: { type: "disabled" }` as a
//     top-level field. DeepSeek copied Anthropic's schema verbatim into
//     its OpenAI-compatible request body.
//     Reference:
//       - https://api-docs.deepseek.com/guides/thinking_mode
//
//   `vendor-qwen`: also emit `enable_thinking: false`. Qwen's hybrid
//     thinking models use this non-standard parameter.
//     Reference:
//       - https://www.alibabacloud.com/help/en/model-studio/deep-thinking
//
// Multiple vendor flags may be on simultaneously; emitted fields stack.
// Strict upstreams that reject unknown fields will 400 — admins must
// only enable vendor flags matching the actual upstream protocol.

import type { ChatCompletionsPayload } from "../../../lib/chat-completions-types.ts";
import type { MessagesPayload } from "../../../lib/messages-types.ts";
import type { ResponsesPayload } from "../../../lib/responses-types.ts";

const usesThinkingTypeDisabled = (fixes: ReadonlySet<string>): boolean =>
  fixes.has("vendor-deepseek");

const usesEnableThinkingFalse = (fixes: ReadonlySet<string>): boolean =>
  fixes.has("vendor-qwen");

// Messages (Anthropic-native): protocol has a real disable. Vendor
// flags are irrelevant here; ignore them and always emit
// `thinking: disabled` + strip `output_config`.
export const disableMessagesReasoning = (
  payload: MessagesPayload,
): MessagesPayload => {
  const { output_config: _outputConfig, ...rest } = payload;
  return { ...rest, thinking: { type: "disabled" as const } };
};

export const disableResponsesReasoning = (
  payload: ResponsesPayload,
  enabledFixes: ReadonlySet<string>,
): ResponsesPayload => {
  const { reasoning: _reasoning, ...rest } = payload;
  const out: ResponsesPayload & Record<string, unknown> = { ...rest };
  if (usesThinkingTypeDisabled(enabledFixes)) {
    out.thinking = { type: "disabled" };
  }
  if (usesEnableThinkingFalse(enabledFixes)) {
    out.enable_thinking = false;
  }
  return out;
};

export const disableChatCompletionsReasoning = (
  payload: ChatCompletionsPayload,
  enabledFixes: ReadonlySet<string>,
): ChatCompletionsPayload => {
  const { reasoning_effort: _reasoningEffort, ...rest } = payload;
  const out: ChatCompletionsPayload & Record<string, unknown> = { ...rest };
  if (usesThinkingTypeDisabled(enabledFixes)) {
    out.thinking = { type: "disabled" };
  }
  if (usesEnableThinkingFalse(enabledFixes)) {
    out.enable_thinking = false;
  }
  return out;
};
