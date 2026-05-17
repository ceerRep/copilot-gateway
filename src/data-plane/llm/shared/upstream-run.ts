// Run a per-attempt callback against a resolved upstream, applying account
// fallback only for Copilot. Custom OpenAI-compatible upstreams are served
// by their single configured connection — there is no account pool to swap
// through, so we execute the attempt once.

import type { UpstreamSelection } from "../../../lib/upstream/resolver.ts";
import type { Upstream } from "../../../lib/upstream/types.ts";
import { ModelsFetchError } from "../../../lib/models-cache.ts";
import type { PerformanceTelemetryContext } from "../../../lib/performance-telemetry.ts";
import { withAccountFallback } from "../../shared/account-pool/fallback.ts";
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

export const runOnUpstream = async <T>(
  selection: UpstreamSelection,
  model: string,
  run: (upstream: Upstream) => Promise<T>,
): Promise<T> => {
  if (selection.kind === "openai") {
    return run(withDefaultFixes(selection.upstream));
  }
  return withAccountFallback(model, ({ upstream }) =>
    run(withDefaultFixes(upstream)));
};

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
