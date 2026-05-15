import type { ChatCompletionResponse } from "../../../../../lib/chat-completions-types.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToChatCompletionsInput } from "../emit.ts";
import { withUsageStreamOptionsIncluded } from "./include-usage-stream-options.ts";
import { withDeepseekReasoningDialect } from "./normalize-reasoning-dialect.ts";

export const chatCompletionsTargetInterceptors = [
  withUsageStreamOptionsIncluded,
  withDeepseekReasoningDialect,
] satisfies readonly TargetInterceptor<
  EmitToChatCompletionsInput,
  ChatCompletionResponse
>[];
