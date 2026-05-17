// LLM-flavoured wrapper around the neutral `runOnUpstream`. Adds the
// per-kind default-fix merge so the target interceptor assembler always
// sees `defaults ∪ admin opt-ins` on `upstream.enabledFixes`. Non-LLM
// endpoints (e.g. embeddings) should import the neutral version from
// `data-plane/shared/upstream-run.ts` directly — they don't run target
// interceptors and don't need the catalog.

import { ModelsFetchError } from "../../../lib/models-cache.ts";
import type { PerformanceTelemetryContext } from "../../../lib/performance-telemetry.ts";
import type { UpstreamSelection } from "../../../lib/upstream/resolver.ts";
import type { Upstream } from "../../../lib/upstream/types.ts";
import { runOnUpstream as runOnUpstreamNeutral } from "../../shared/upstream-run.ts";
import { defaultFixesFor } from "../targets/optional-fixes.ts";
import type { UpstreamErrorResult } from "./errors/result.ts";

// `lib/upstream/*` adapters carry only the admin's explicit opt-in fix ids
// (empty for built-in Copilot). The flag catalog is data-plane territory,
// so per-kind defaults are merged here at the request-path boundary
// instead of inside the adapter — keeping lib/upstream catalog-agnostic.
export const withDefaultFixes = (upstream: Upstream): Upstream => {
  const defaults = defaultFixesFor(upstream.kind);
  if (defaults.size === 0) return upstream;
  return {
    ...upstream,
    enabledFixes: new Set([...defaults, ...upstream.enabledFixes]),
  };
};

export const runOnUpstream = <T>(
  selection: UpstreamSelection,
  model: string,
  run: (upstream: Upstream) => Promise<T>,
): Promise<T> =>
  runOnUpstreamNeutral(
    selection,
    model,
    (upstream) => run(withDefaultFixes(upstream)),
  );

export const modelLoadErrorResult = (
  error: unknown,
  performance?: PerformanceTelemetryContext,
): UpstreamErrorResult => {
  if (!(error instanceof ModelsFetchError)) throw error;

  return {
    type: "upstream-error",
    status: error.status,
    headers: new Headers(error.headers),
    body: new TextEncoder().encode(error.body),
    ...(performance ? { performance } : {}),
  };
};
