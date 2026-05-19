// Copilot-only Messages target workarounds. These are structurally bound to
// Copilot upstreams via the assembler in ../index.ts — they never run for
// custom OpenAI-compatible upstreams and are not exposed as admin-toggleable
// fixes.

import type { MessagesResponse } from "../../../../shared/protocol/messages.ts";
import type { TargetInterceptor } from "../../../run-interceptors.ts";
import type { EmitToMessagesInput } from "../../emit.ts";
import { withThinkingDisplayPromoted } from "./promote-thinking-display.ts";
import { withBetaHeaderFixed } from "./fix-beta-header.ts";
import { withEagerInputStreamingStripped } from "./strip-eager-input-streaming.ts";

export const messagesCopilotInterceptors = [
  withThinkingDisplayPromoted,
  withBetaHeaderFixed,
  withEagerInputStreamingStripped,
] as const satisfies readonly TargetInterceptor<
  EmitToMessagesInput,
  MessagesResponse
>[];
