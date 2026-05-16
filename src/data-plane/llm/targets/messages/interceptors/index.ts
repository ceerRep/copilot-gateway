import type { MessagesResponse } from "../../../../../lib/messages-types.ts";
import type { Upstream } from "../../../../../lib/upstream/types.ts";
import type { OptionalInterceptor } from "../../optional-fix.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { EmitToMessagesInput } from "../emit.ts";
import { messagesCopilotInterceptors } from "./copilot/index.ts";

// Always-on Messages target interceptors. None currently apply — Messages
// `max_tokens` defaulting moved into pairwise translators, so the target
// boundary has no spec-compliance work today.
const baseInterceptors: readonly TargetInterceptor<
  EmitToMessagesInput,
  MessagesResponse
>[] = [];

// Optional interceptors for the Messages target. Each entry binds an
// interceptor run function to a flag id declared in
// ../../optional-fixes.ts. None currently apply at this boundary.
export const messagesOptionalInterceptors: readonly OptionalInterceptor<
  EmitToMessagesInput,
  MessagesResponse
>[] = [];

export const interceptorsForMessages = (
  upstream: Upstream,
): readonly TargetInterceptor<EmitToMessagesInput, MessagesResponse>[] => [
  ...baseInterceptors,
  ...(upstream.kind === "copilot" ? messagesCopilotInterceptors : []),
  ...messagesOptionalInterceptors
    .filter(({ fixId }) => upstream.enabledFixes.has(fixId))
    .map(({ run }) => run),
];
