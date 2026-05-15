import type { ChatCompletionChunk } from "../../../../../lib/chat-completions-types.ts";
import type { SourceInterceptor } from "../../run-interceptors.ts";
import { rewriteVirtualModel } from "./rewrite-virtual-model.ts";
import type { ChatCompletionsSourceContext } from "./types.ts";

export type { ChatCompletionsSourceContext };

export const chatCompletionsSourceInterceptors = [
  rewriteVirtualModel,
] satisfies readonly SourceInterceptor<
  ChatCompletionsSourceContext,
  ChatCompletionChunk
>[];
