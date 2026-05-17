import type {
  ResponsesPayload,
  ResponsesResult,
} from "../../../../../lib/responses-types.ts";
import type { EmitInput } from "../../emit-types.ts";
import { disableResponsesReasoning } from "../../../shared/disable-reasoning.ts";
import { responsesHasForcedToolChoice } from "../../../shared/forced-tool-choice.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";

// Opt-in workaround for upstreams where forced `tool_choice` and enabled
// reasoning do not compose. Vendor field mapping and references live in
// shared/disable-reasoning.ts.
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
