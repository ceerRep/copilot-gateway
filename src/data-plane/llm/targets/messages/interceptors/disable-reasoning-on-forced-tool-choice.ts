import type { MessagesResponse } from "../../../../../lib/messages-types.ts";
import { disableMessagesReasoning } from "../../../shared/disable-reasoning.ts";
import { messagesHasForcedToolChoice } from "../../../shared/forced-tool-choice.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToMessagesInput } from "../emit.ts";

// Some upstreams reject the combination of forced `tool_choice` and
// enabled reasoning/thinking. When opted in, explicitly disable
// reasoning so the request is accepted.
export const withReasoningDisabledOnForcedToolChoice: TargetInterceptor<
  EmitToMessagesInput,
  MessagesResponse
> = async (ctx, run) => {
  if (!messagesHasForcedToolChoice(ctx.payload)) return await run();
  ctx.payload = disableMessagesReasoning(ctx.payload);
  return await run();
};
