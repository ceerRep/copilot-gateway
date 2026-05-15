import type { ChatCompletionChunk } from "../../../../../lib/chat-completions-types.ts";
import { resolveVirtualModel } from "../../../shared/models/virtual-models.ts";
import type { SourceInterceptor } from "../../run-interceptors.ts";
import type { ChatCompletionsSourceContext } from "./types.ts";

export const rewriteVirtualModel: SourceInterceptor<
  ChatCompletionsSourceContext,
  ChatCompletionChunk
> = async (ctx, run) => {
  const resolution = await resolveVirtualModel(ctx.payload.model);
  if (!resolution) return run();

  const { reasoning_effort: _effort, ...rest } = ctx.payload;
  ctx.payload = { ...rest, model: resolution.targetModel };
  return run();
};
