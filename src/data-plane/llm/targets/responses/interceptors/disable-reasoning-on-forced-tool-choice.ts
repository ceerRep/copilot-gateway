import type {
  ResponsesPayload,
  ResponsesResult,
} from "../../../../../lib/responses-types.ts";
import type { EmitInput } from "../../emit-types.ts";
import { disableResponsesReasoning } from "../../../shared/disable-reasoning.ts";
import { responsesHasForcedToolChoice } from "../../../shared/forced-tool-choice.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";

// Some upstreams reject the combination of forced `tool_choice` and
// enabled reasoning. When opted in, explicitly disable reasoning so
// the request is accepted. Vendor-style flags on the upstream
// (`vendor-deepseek`, `vendor-qwen`) add vendor-specific
// explicit-disable signals on top of the OpenAI strip.
export const withReasoningDisabledOnForcedToolChoice: TargetInterceptor<
  EmitInput<ResponsesPayload>,
  ResponsesResult
> = async (ctx, run) => {
  if (!responsesHasForcedToolChoice(ctx.payload)) return await run();
  ctx.payload = disableResponsesReasoning(
    ctx.payload,
    ctx.upstream.enabledFixes,
  );
  return await run();
};
