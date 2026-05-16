import type {
  ResponsesPayload,
  ResponsesResult,
} from "../../../../../lib/responses-types.ts";
import type { Upstream } from "../../../../../lib/upstream/types.ts";
import type { EmitInput } from "../../emit-types.ts";
import type { OptionalInterceptor } from "../../optional-fix.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import { responsesCopilotInterceptors } from "./copilot/index.ts";
import { withCyberPolicyRetried } from "./retry-cyber-policy.ts";

// Always-on Responses target interceptors. None currently apply.
const baseInterceptors: readonly TargetInterceptor<
  EmitInput<ResponsesPayload>,
  ResponsesResult
>[] = [];

// Optional interceptors for the Responses target. Each entry binds a run
// function to a flag id declared in ../../optional-fixes.ts.
export const responsesOptionalInterceptors = [
  { fixId: "retry-cyber-policy", run: withCyberPolicyRetried },
] as const satisfies readonly OptionalInterceptor<
  EmitInput<ResponsesPayload>,
  ResponsesResult
>[];

export const interceptorsForResponses = (
  upstream: Upstream,
): readonly TargetInterceptor<
  EmitInput<ResponsesPayload>,
  ResponsesResult
>[] => [
  ...baseInterceptors,
  ...(upstream.kind === "copilot" ? responsesCopilotInterceptors : []),
  ...responsesOptionalInterceptors
    .filter(({ fixId }) => upstream.enabledFixes.has(fixId))
    .map(({ run }) => run),
];
