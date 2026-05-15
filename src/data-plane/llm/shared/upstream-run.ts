// Run a per-attempt callback against a resolved upstream, applying account
// fallback only for Copilot. Custom OpenAI-compatible upstreams are served
// by their single configured connection — there is no account pool to swap
// through, so we execute the attempt once.

import type { UpstreamSelection } from "../../../lib/upstream/resolver.ts";
import type { Upstream } from "../../../lib/upstream/types.ts";
import { withAccountFallback } from "../../shared/account-pool/fallback.ts";

export const runOnUpstream = async <T>(
  selection: UpstreamSelection,
  model: string,
  run: (upstream: Upstream) => Promise<T>,
): Promise<T> => {
  if (selection.kind === "openai") return run(selection.upstream);
  return withAccountFallback(model, ({ upstream }) => run(upstream));
};
