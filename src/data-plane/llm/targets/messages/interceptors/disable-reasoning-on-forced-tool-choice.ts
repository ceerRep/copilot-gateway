import type { MessagesResponse } from "../../../../../lib/messages-types.ts";
import { disableMessagesReasoning } from "../../../shared/disable-reasoning.ts";
import { messagesHasForcedToolChoice } from "../../../shared/forced-tool-choice.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToMessagesInput } from "../emit.ts";

// Opt-in workaround for upstreams where forced `tool_choice` and enabled
// thinking do not compose. Messages has a native `thinking: disabled` shape.
export const withReasoningDisabledOnForcedToolChoice: TargetInterceptor<
  EmitToMessagesInput,
  MessagesResponse
> = async (ctx, run) => {
  if (!messagesHasForcedToolChoice(ctx.payload)) return await run();
  ctx.payload = disableMessagesReasoning(ctx.payload);
  return await run();
};
