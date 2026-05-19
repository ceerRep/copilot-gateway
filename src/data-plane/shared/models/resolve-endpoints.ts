// Generic endpoint-capability helper: resolve the effective supported
// endpoints for a model on a given upstream. Neutral — knows about
// supported_endpoints semantics but not about specific LLM endpoints.
// LLM-specific routing helpers (chat-completions inference, generation
// eligibility, etc.) live in `data-plane/llm/shared/models/`.
//
// Custom OpenAI-compatible upstreams have admin-configured capabilities
// that are trusted and tight — when the provider's /models entry omits
// per-model supported_endpoints, the upstream-level config fills in.
//
// Copilot's /models is authoritative per SKU; a missing field means
// "not declared", not "all of the above". We return an empty list so
// embedding-only SKUs are not promoted onto endpoints they don't
// declare. The caller's planning layer is still allowed to layer on
// legacy model-name heuristics on top of this (LLM-specific).

import type { Upstream } from "../../../shared/upstream/types.ts";

export const resolveEffectiveSupportedEndpoints = (
  modelEndpoints: string[] | undefined,
  upstream: { kind: Upstream["kind"]; supportedEndpoints: string[] },
): { endpoints: string[]; explicit: boolean } => {
  if (modelEndpoints) return { endpoints: modelEndpoints, explicit: true };
  if (upstream.kind === "openai") {
    return { endpoints: upstream.supportedEndpoints, explicit: true };
  }
  return { endpoints: [], explicit: false };
};
