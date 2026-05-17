import type { ChatCompletionResponse } from "../../../../../lib/chat-completions-types.ts";
import { disableChatCompletionsReasoning } from "../../../shared/disable-reasoning.ts";
import { chatHasForcedToolChoice } from "../../../shared/forced-tool-choice.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToChatCompletionsInput } from "../emit.ts";

// Opt-in workaround for upstreams where forced `tool_choice` and enabled
// reasoning do not compose. Vendor field mapping and references live in
// shared/disable-reasoning.ts.
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
