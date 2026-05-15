import type { SourceInterceptor } from "../../run-interceptors.ts";
import type { SourceResponseStreamEvent } from "../events/protocol.ts";
import { fixApplyPatchTools } from "./fix-apply-patch-tools.ts";
import { rewriteVirtualModel } from "./rewrite-virtual-model.ts";
import { stripUnsupportedTools } from "./strip-unsupported-tools.ts";
import type { ResponsesSourceContext } from "./types.ts";

export type { ResponsesSourceContext };

export const responsesSourceInterceptors = [
  // rewriteVirtualModel runs first so codex-auto-review resolves before any
  // tool fix-up looks at the request.
  rewriteVirtualModel,
  // fix-apply-patch-tools must run before strip-unsupported-tools so the
  // `apply_patch` Freeform tool is rewritten into a function tool before the
  // strip pass removes every remaining `custom` entry.
  fixApplyPatchTools,
  stripUnsupportedTools,
] satisfies readonly SourceInterceptor<
  ResponsesSourceContext,
  SourceResponseStreamEvent
>[];
