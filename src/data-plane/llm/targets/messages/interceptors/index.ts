import type { MessagesResponse } from "../../../../../lib/messages-types.ts";
import type { Upstream } from "../../../../../lib/upstream/types.ts";
import type { OptionalInterceptor } from "../../optional-fix.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToMessagesInput } from "../emit.ts";
import { messagesCopilotInterceptors } from "./copilot/index.ts";
import { withReasoningDisabledOnForcedToolChoice } from "./disable-reasoning-on-forced-tool-choice.ts";

const baseInterceptors: readonly TargetInterceptor<
  EmitToMessagesInput,
  MessagesResponse
>[] = [];

export const messagesOptionalInterceptors = [
  {
    fixId: "disable-reasoning-on-forced-tool-choice",
    run: withReasoningDisabledOnForcedToolChoice,
  },
] as const satisfies readonly OptionalInterceptor<
  EmitToMessagesInput,
  MessagesResponse
>[];

export const interceptorsForMessages = (
  upstream: Upstream,
): readonly TargetInterceptor<EmitToMessagesInput, MessagesResponse>[] => [
  ...baseInterceptors,
  ...(upstream.kind === "copilot" ? messagesCopilotInterceptors : []),
  ...messagesOptionalInterceptors
    .filter(({ fixId }) => upstream.enabledFixes.has(fixId))
    .map(({ run }) => run),
];
