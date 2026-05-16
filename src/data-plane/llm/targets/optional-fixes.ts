// Flag catalog. Single source of truth for every admin-toggleable
// per-upstream fix exposed by the dashboard, validated by the
// /api/upstreams endpoint, and stored in upstream_configs.enabled_fixes.
//
// The catalog only describes flags — what the toggle says to the admin
// and which endpoints it applies to. Interceptor code lives in each
// target's interceptors/ folder and references a flag by id; the
// dependency goes interceptor → flag, never the other way. This makes
// "one flag drives multiple interceptors" trivial (each target
// registers an OptionalInterceptor with the same fixId) and keeps the
// catalog free of runtime closures.

import type { UpstreamKind } from "../../../lib/upstream/types.ts";

export type FixEndpoint = "messages" | "responses" | "chat_completions";

export interface Flag {
  id: string;
  label: string;
  description: string;
  defaultFor: readonly UpstreamKind[];
  // Endpoints on which an interceptor exists for this flag (or, for
  // vendor-style flags, may be read by interceptors there). Catalog
  // metadata only — admins may enable any known flag on any upstream;
  // the assembler naturally no-ops on flags whose endpoints aren't
  // actually served.
  appliesTo: readonly FixEndpoint[];
}

export const OPTIONAL_FIXES = [
  {
    id: "retry-cyber-policy",
    label: "Retry on upstream cyber-policy block",
    description:
      "Responses: retry up to 10 times when the upstream returns a cyber_policy error code.",
    defaultFor: ["copilot"],
    appliesTo: ["responses"],
  },
  {
    id: "deepseek-reasoning-dialect",
    label: "DeepSeek reasoning dialect",
    description:
      "Chat Completions: rename reasoning_text ↔ reasoning_content and drop reasoning_opaque / reasoning_items for upstreams that follow DeepSeek's legacy reasoner shape.",
    defaultFor: [],
    appliesTo: ["chat_completions"],
  },
] as const satisfies readonly Flag[];

export type OptionalFixId = typeof OPTIONAL_FIXES[number]["id"];

const KNOWN_IDS = new Set<string>(OPTIONAL_FIXES.map((f) => f.id));

export const getFixCatalog = (): readonly Flag[] => OPTIONAL_FIXES;

export const isKnownFixId = (id: string): id is OptionalFixId =>
  KNOWN_IDS.has(id);

export const defaultFixesFor = (
  kind: UpstreamKind,
): ReadonlySet<OptionalFixId> =>
  new Set(
    getFixCatalog()
      .filter((f) => f.defaultFor.includes(kind))
      .map((f) => f.id as OptionalFixId),
  );
