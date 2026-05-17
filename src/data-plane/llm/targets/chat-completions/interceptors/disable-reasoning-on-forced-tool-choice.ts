import type { ChatCompletionResponse } from "../../../../../lib/chat-completions-types.ts";
import { disableChatCompletionsReasoning } from "../../../shared/disable-reasoning.ts";
import { chatHasForcedToolChoice } from "../../../shared/forced-tool-choice.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToChatCompletionsInput } from "../emit.ts";

// Some upstreams reject the combination of forced `tool_choice` and
// enabled reasoning_effort. When opted in, explicitly disable
// reasoning so the request is accepted. Vendor-style flags on the
// upstream (`vendor-deepseek`, `vendor-qwen`) add vendor-specific
// explicit-disable signals on top of the OpenAI strip.
export const withReasoningDisabledOnForcedToolChoice: TargetInterceptor<
  EmitToChatCompletionsInput,
  ChatCompletionResponse
> = async (ctx, run) => {
  if (!chatHasForcedToolChoice(ctx.payload)) return await run();
  ctx.payload = disableChatCompletionsReasoning(
    ctx.payload,
    ctx.upstream.enabledFixes,
  );
  return await run();
};
