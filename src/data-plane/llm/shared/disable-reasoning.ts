// Vendor-aware reasoning-disable helpers for forced tool-call requests. The
// target interceptors decide when to apply the workaround; this file owns how
// "turn reasoning off" is spelled for each upstream dialect.
//
// Some reasoning-capable upstreams do not compose forced `tool_choice` with
// active reasoning. DeepSeek documents one such case for its thinking mode;
// other vendors and self-hosted deployments are provider-specific, so the
// consuming fix stays admin opt-in per upstream.
// Reference:
//   - https://api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi
//
// Signals emitted:
//
//   Default (no vendor flag): just remove `reasoning_effort` /
//     `reasoning`. Works for non-reasoning models; reasoning-only
//     models keep their model-default effort because the OpenAI-style
//     request shape has no portable off switch.
//
//   `vendor-deepseek`: also emit `thinking: { type: "disabled" }` as a
//     top-level field. DeepSeek documents this as an OpenAI-compatible
//     `extra_body` field.
//     Reference:
//       - https://api-docs.deepseek.com/guides/thinking_mode
//
//   `vendor-qwen`: also emit `enable_thinking: false`. Qwen's hybrid
//     thinking models use this non-standard parameter.
//     Reference:
//       - https://www.alibabacloud.com/help/en/model-studio/deep-thinking
//
// Multiple vendor flags may be on simultaneously; emitted fields stack.
// Upstreams may reject unknown fields, so admins must only enable vendor
// flags matching the actual upstream protocol.

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
