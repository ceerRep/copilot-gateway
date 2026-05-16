// Copilot upstream adapter — wraps the existing copilotFetch + token exchange
// behind the generic Upstream interface. Reuses lib/copilot.ts so the token
// cache (in-process + KV) stays shared across all callers.

import { copilotFetch } from "../copilot.ts";
import type { EndpointKey } from "../../repo/types.ts";
import { defaultFixesFor } from "../../data-plane/llm/targets/optional-fixes.ts";
import type { Upstream, UpstreamFetchOptions } from "./types.ts";

const COPILOT_UPSTREAM_ID = "copilot";

// Copilot mounts its API at the host root and uses an Anthropic-style
// `/v1/messages` for the Messages endpoint while keeping `/chat/completions`,
// `/responses`, `/embeddings`, and `/models` un-prefixed. These paths are not
// admin-configurable: they reflect Copilot's own contract, not a deployment
// choice.
const COPILOT_PATHS: Record<EndpointKey, string> = {
  chat_completions: "/chat/completions",
  responses: "/responses",
  messages: "/v1/messages",
  messages_count_tokens: "/v1/messages/count_tokens",
  embeddings: "/embeddings",
  models: "/models",
};

export const COPILOT_SUPPORTED_ENDPOINTS = [
  "/chat/completions",
  "/responses",
  "/v1/messages",
  "/embeddings",
];

// Encode the active token into the upstream id so the per-upstream models
// cache is invalidated when the GitHub account or accountType changes. The
// hash keeps the id stable across requests with the same credentials.
const tokenHash = async (token: string, accountType: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${accountType}:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
};

export const createCopilotUpstream = async (
  githubToken: string,
  accountType: string,
): Promise<Upstream> => {
  const tag = await tokenHash(githubToken, accountType);
  return {
    id: `${COPILOT_UPSTREAM_ID}:${tag}`,
    name: "GitHub Copilot",
    kind: "copilot",
    supportedEndpoints: COPILOT_SUPPORTED_ENDPOINTS,
    // Copilot gets every flag that opts into "copilot" by default.
    // Copilot-only structural workarounds (anthropic beta header rewrite,
    // [DONE] sentinel stripping, etc.) live in targets/<x>/interceptors/copilot/
    // and are attached by the assembler purely on `kind === "copilot"`, so
    // they don't appear here.
    enabledFixes: defaultFixesFor("copilot"),
    fetch: (endpoint, init, options?: UpstreamFetchOptions) =>
      copilotFetch(COPILOT_PATHS[endpoint], init, githubToken, accountType, options),
  };
};

export { COPILOT_UPSTREAM_ID };
