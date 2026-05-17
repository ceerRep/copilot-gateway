import type { ChatCompletionResponse } from "../../../../../lib/chat-completions-types.ts";
import type { Upstream } from "../../../../../lib/upstream/types.ts";
import type { OptionalInterceptor } from "../../optional-fix.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToChatCompletionsInput } from "../emit.ts";
import { withReasoningDisabledOnForcedToolChoice } from "./disable-reasoning-on-forced-tool-choice.ts";
import { withUsageStreamOptionsIncluded } from "./include-usage-stream-options.ts";
import { withDeepseekReasoningDialect } from "./normalize-reasoning-dialect.ts";
import { withUsageNormalized } from "./normalize-usage.ts";

// Always-on Chat Completions target interceptors. Both gate the gateway's
// usage-tracking pipeline:
//   - `include-usage-stream-options` ensures upstreams emit a final usage
//     chunk in streaming mode.
//   - `normalize-usage` normalizes vendor variants (DeepSeek / Kimi /
//     standard OpenAI) into the OpenAI standard usage shape so accounting
//     reads one contract.
// Turning either off would silently break per-key accounting, so neither
// is surfaced as a flag.
const baseInterceptors = [
  withUsageStreamOptionsIncluded,
  withUsageNormalized,
] as const satisfies readonly TargetInterceptor<
  EmitToChatCompletionsInput,
  ChatCompletionResponse
>[];

export const chatCompletionsOptionalInterceptors = [
  {
    fixId: "deepseek-reasoning-dialect",
    run: withDeepseekReasoningDialect,
  },
  {
    fixId: "disable-reasoning-on-forced-tool-choice",
    run: withReasoningDisabledOnForcedToolChoice,
  },
] as const satisfies readonly OptionalInterceptor<
  EmitToChatCompletionsInput,
  ChatCompletionResponse
>[];

export const interceptorsForChatCompletions = (
  upstream: Upstream,
): readonly TargetInterceptor<
  EmitToChatCompletionsInput,
  ChatCompletionResponse
>[] => [
  ...baseInterceptors,
  ...chatCompletionsOptionalInterceptors
    .filter(({ fixId }) => upstream.enabledFixes.has(fixId))
    .map(({ run }) => run),
];
