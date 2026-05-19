// Copilot-only Responses target workarounds. Structurally bound to Copilot
// upstreams via the assembler in ../index.ts — they never run for custom
// OpenAI-compatible upstreams and are not exposed as admin-toggleable fixes.

import type {
  ResponsesPayload,
  ResponsesResult,
} from "../../../../shared/protocol/responses.ts";
import type { EmitInput } from "../../../emit-types.ts";
import type { TargetInterceptor } from "../../../run-interceptors.ts";
import { withConnectionMismatchRetried } from "./retry-connection-mismatch.ts";
import { withServiceTierStripped } from "./strip-service-tier.ts";
import { withOutputItemIdsSynchronized } from "./synchronize-output-item-ids.ts";

export const responsesCopilotInterceptors = [
  withServiceTierStripped,
  withConnectionMismatchRetried,
  withOutputItemIdsSynchronized,
] as const satisfies readonly TargetInterceptor<
  EmitInput<ResponsesPayload>,
  ResponsesResult
>[];
