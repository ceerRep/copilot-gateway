import type { MessagesStreamEventData } from "../../../../../lib/messages-types.ts";
import { resolveVirtualModel } from "../../../shared/models/virtual-models.ts";
import type { SourceInterceptor } from "../../run-interceptors.ts";
import type { MessagesSourceContext } from "./types.ts";

// Rewrite virtual model names (e.g. codex-auto-review) to the admin-configured
// target model and disable reasoning, mirroring the web search shim's approach:
// clients pairing virtual models with forced tool_choice would 400 on most
// upstreams if reasoning is also enabled.
export const rewriteVirtualModel: SourceInterceptor<
  MessagesSourceContext,
  MessagesStreamEventData
> = async (ctx, run) => {
  const resolution = await resolveVirtualModel(ctx.payload.model);
  if (!resolution) return run();

  const { output_config: _outputConfig, ...rest } = ctx.payload;
  ctx.payload = {
    ...rest,
    model: resolution.targetModel,
    thinking: { type: "disabled" as const },
  };
  return run();
};
