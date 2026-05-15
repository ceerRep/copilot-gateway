import type { SourceResponseStreamEvent } from "../events/protocol.ts";
import { resolveVirtualModel } from "../../../shared/models/virtual-models.ts";
import type { SourceInterceptor } from "../../run-interceptors.ts";
import type { ResponsesSourceContext } from "./types.ts";

export const rewriteVirtualModel: SourceInterceptor<
  ResponsesSourceContext,
  SourceResponseStreamEvent
> = async (ctx, run) => {
  const resolution = await resolveVirtualModel(ctx.payload.model);
  if (!resolution) return run();

  const { reasoning: _reasoning, ...rest } = ctx.payload;
  ctx.payload = { ...rest, model: resolution.targetModel };
  return run();
};
