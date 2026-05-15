// Per-upstream model list cache.
//
// Each upstream (Copilot — one per GitHub account — or a custom
// OpenAI-compatible provider) gets its own /models cache key.
//
// Copilot's `Upstream` adapter id encodes the GitHub token + account type, so
// "per-upstream" is automatically per-account for the Copilot side. Account
// pool routing iterates accounts -> upstreams -> caches without a separate
// keying scheme.
//
// Tiers:
//   L1 in-process (120s)            — avoids repeated repo reads on hot isolates
//   L2 repo-backed soft expiry      — refresh attempts after 600s
//   L2 repo-backed hard expiry      — switchable upstream failures may reuse
//                                     stale data for up to 2h to keep
//                                     account-pool routing usable

import { getRepo } from "../repo/index.ts";
import type { GitHubAccount } from "../repo/types.ts";
import { isAccountSwitchableStatus, isCopilotTokenFetchError } from "./copilot.ts";
import { dateSuffixedClaudeModelAliasTarget } from "./model-name.ts";
import { createCopilotUpstream } from "./upstream/copilot.ts";
import type { Upstream } from "./upstream/types.ts";

export interface ModelInfo {
  id: string;
  name: string;
  version: string;
  object: string;
  capabilities: {
    family: string;
    type: string;
    limits: {
      max_context_window_tokens?: number;
      max_non_streaming_output_tokens?: number;
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
    supports: {
      tool_calls?: boolean;
      parallel_tool_calls?: boolean;
      streaming?: boolean;
      vision?: boolean;
      adaptive_thinking?: boolean;
      reasoning_effort?: string[];
    };
  };
  supported_endpoints?: string[];
  // Set by the merging /v1/models handler so the dashboard can group models
  // by which upstream serves them. Not present on the upstream's raw /models
  // response.
  upstream_kind?: "copilot" | "openai";
  // Upstream-only fields: the gateway clients are OpenAI/Anthropic SDKs that
  // do not consume these, but they pass through verbatim and the /v1/models
  // merge logic needs to read/write them.
  billing?: {
    is_premium?: boolean;
    multiplier?: number;
    restricted_to?: string[];
  };
  policy?: {
    state?: string;
    terms?: string;
  };
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

interface ModelsCacheEntry {
  fetchedAt: number;
  hardExpiresAt: number;
  data: ModelsResponse;
}

export interface ModelsLoadSuccess {
  type: "models";
  data: ModelsResponse;
  stale: boolean;
}

export interface ModelsLoadFailure {
  type: "error";
  error: unknown;
}

export type ModelsLoadResult = ModelsLoadSuccess | ModelsLoadFailure;

export class ModelsFetchError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly headers: Headers,
  ) {
    super(`Models fetch failed: ${status} ${body}`);
    this.name = "ModelsFetchError";
  }
}

const IN_PROCESS_TTL_MS = 120_000;
const SOFT_TTL_MS = 600_000;
const HARD_TTL_MS = 2 * 60 * 60 * 1000;
const MODELS_CACHE_KEY_PREFIX = "models_cache_v2";

const inProcessCache = new Map<string, {
  entry: ModelsCacheEntry;
  cachedAt: number;
}>();

export const clearModelsCache = (): void => {
  inProcessCache.clear();
};

const cacheKeyForUpstream = (upstream: Upstream): string =>
  `${MODELS_CACHE_KEY_PREFIX}:${upstream.id}`;

// Drop both L1 and L2 cache entries for a single upstream id. Use when an
// upstream's config (base URL, bearer, supported endpoints) changes — the
// stored model list belongs to the old credentials and would otherwise
// linger up to HARD_TTL_MS.
export const invalidateUpstreamModels = async (
  upstreamId: string,
): Promise<void> => {
  const cacheKey = `${MODELS_CACHE_KEY_PREFIX}:${upstreamId}`;
  inProcessCache.delete(cacheKey);
  try {
    await getRepo().cache.delete(cacheKey);
  } catch {
    // Best-effort; the in-process drop alone still forces a refresh on this isolate.
  }
};

const isSoftFresh = (entry: ModelsCacheEntry, now: number): boolean =>
  now - entry.fetchedAt < SOFT_TTL_MS;

const isHardFresh = (entry: ModelsCacheEntry, now: number): boolean =>
  entry.hardExpiresAt > now;

const isCacheEntry = (value: unknown): value is ModelsCacheEntry => {
  const entry = value as ModelsCacheEntry;
  return typeof entry?.fetchedAt === "number" &&
    typeof entry.hardExpiresAt === "number" &&
    Boolean(entry.data) &&
    Array.isArray(entry.data.data);
};

const isModelsResponse = (value: unknown): value is ModelsResponse => {
  const response = value as ModelsResponse;
  return Array.isArray(response?.data);
};

const readRepoCache = async (
  cacheKey: string,
): Promise<ModelsCacheEntry | null> => {
  try {
    const raw = await getRepo().cache.get(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isCacheEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeRepoCache = async (
  cacheKey: string,
  entry: ModelsCacheEntry,
): Promise<void> => {
  try {
    await getRepo().cache.set(cacheKey, JSON.stringify(entry));
  } catch {
    // Repo cache is an optimization; fetch result is still usable without persisting it.
  }
};

export const isSwitchableModelsLoadError = (error: unknown): boolean => {
  if (error instanceof ModelsFetchError) {
    return isAccountSwitchableStatus(error.status);
  }
  return isCopilotTokenFetchError(error) &&
    isAccountSwitchableStatus(error.status);
};

const fetchUpstreamModels = async (
  upstream: Upstream,
): Promise<ModelsResponse> => {
  const resp = await upstream.fetch("models", { method: "GET" });

  if (!resp.ok) {
    throw new ModelsFetchError(
      resp.status,
      await resp.text(),
      new Headers(resp.headers),
    );
  }

  const data = (await resp.json()) as unknown;
  if (!isModelsResponse(data)) {
    throw new Error(`Invalid /models response from upstream ${upstream.id}`);
  }
  return data;
};

/**
 * Load models for an upstream with discriminated success/failure result.
 *
 * Used by the account-pool fallback so it can classify failures (switchable
 * upstream errors → reuse stale cache, mark account/model as unavailable;
 * everything else → propagate).
 */
export const loadModels = async (
  upstream: Upstream,
): Promise<ModelsLoadResult> => {
  const now = Date.now();
  const cacheKey = cacheKeyForUpstream(upstream);
  const cached = inProcessCache.get(cacheKey);

  if (
    cached &&
    now - cached.cachedAt < IN_PROCESS_TTL_MS &&
    isHardFresh(cached.entry, now)
  ) {
    return {
      type: "models",
      data: cached.entry.data,
      stale: !isSoftFresh(cached.entry, now),
    };
  }

  const repoEntry = await readRepoCache(cacheKey);
  if (repoEntry && isSoftFresh(repoEntry, now)) {
    inProcessCache.set(cacheKey, { entry: repoEntry, cachedAt: now });
    return { type: "models", data: repoEntry.data, stale: false };
  }

  try {
    const data = await fetchUpstreamModels(upstream);
    const entry = {
      fetchedAt: now,
      hardExpiresAt: now + HARD_TTL_MS,
      data,
    } satisfies ModelsCacheEntry;
    inProcessCache.set(cacheKey, { entry, cachedAt: now });
    await writeRepoCache(cacheKey, entry);
    return { type: "models", data, stale: false };
  } catch (error) {
    if (
      repoEntry &&
      isHardFresh(repoEntry, now) &&
      isSwitchableModelsLoadError(error)
    ) {
      inProcessCache.set(cacheKey, { entry: repoEntry, cachedAt: now });
      return { type: "models", data: repoEntry.data, stale: true };
    }

    if (
      cached &&
      isHardFresh(cached.entry, now) &&
      isSwitchableModelsLoadError(error)
    ) {
      return { type: "models", data: cached.entry.data, stale: true };
    }

    return { type: "error", error };
  }
};

export const loadModelsForAccount = async (
  account: GitHubAccount,
): Promise<ModelsLoadResult> => {
  const upstream = await createCopilotUpstream(
    account.token,
    account.accountType,
  );
  return loadModels(upstream);
};

/**
 * Get cached model list for the given upstream, refreshing after soft expiry.
 *
 * Convenience wrapper for callers that don't need success/failure
 * discrimination — returns an empty list on hard failure so non-critical
 * paths (dashboard pickers, capability lookups) don't have to branch on
 * errors.
 */
export const getModelsForUpstream = async (
  upstream: Upstream,
): Promise<ModelsResponse> => {
  const result = await loadModels(upstream);
  if (result.type === "models") return result.data;
  console.warn(
    `Failed to load models for upstream ${upstream.id}:`,
    result.error,
  );
  return { object: "list", data: [] };
};

/** Look up a model by id within a fetched model list. Honors Claude alias rewriting. */
export const findModelInModels = (
  models: ModelsResponse,
  modelId: string,
): ModelInfo | undefined => {
  const exact = models.data.find((m) => m.id === modelId);
  if (exact) return exact;

  // Date-suffixed Claude IDs are client aliases for the same Copilot model,
  // but exact /models IDs must win first so future upstream dated releases are
  // not rewritten to their base model.
  const aliasTarget = dateSuffixedClaudeModelAliasTarget(modelId);
  if (!aliasTarget) return undefined;
  return models.data.find((m) => m.id === aliasTarget);
};

/** Find a model on a specific upstream. */
export const findModel = async (
  modelId: string,
  upstream: Upstream,
): Promise<ModelInfo | undefined> => {
  const models = await getModelsForUpstream(upstream);
  return findModelInModels(models, modelId);
};
