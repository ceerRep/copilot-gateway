// Run a per-attempt callback against a resolved upstream, applying account
// fallback only for Copilot. Custom OpenAI-compatible upstreams are served
// by their single configured connection — there is no account pool to swap
// through, so we execute the attempt once.

import type { UpstreamSelection } from "../../../lib/upstream/resolver.ts";
import type { Upstream } from "../../../lib/upstream/types.ts";
import { ModelsFetchError } from "../../../lib/models-cache.ts";
import type { PerformanceTelemetryContext } from "../../../lib/performance-telemetry.ts";
import { withAccountFallback } from "../../shared/account-pool/fallback.ts";
import type { UpstreamErrorResult } from "./errors/result.ts";

export const runOnUpstream = async <T>(
  selection: UpstreamSelection,
  model: string,
  run: (upstream: Upstream) => Promise<T>,
): Promise<T> => {
  if (selection.kind === "openai") return run(selection.upstream);
  return withAccountFallback(model, ({ upstream }) => run(upstream));
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
