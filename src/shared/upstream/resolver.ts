// Resolves the upstream that should serve a request based on the requested
// model id.
//
// Discovery iterates connected GitHub accounts (Copilot upstreams) first,
// then admin-configured custom OpenAI-compatible upstreams. The first match
// wins. For Copilot, the caller is expected to wrap its upstream attempts in
// `withAccountFallback` from `data-plane/shared/account-pool/fallback.ts`,
// which iterates accounts and applies per-account-per-model backoff. Custom
// upstreams are served by the single matching configuration.

import { getRepo } from "../../repo/index.ts";
import {
  findModelInModels,
  isSwitchableModelsLoadError,
  loadModels,
  loadModelsForAccount,
} from "../../data-plane/models/cache.ts";
import { createCopilotUpstream } from "./copilot.ts";
import { createOpenAiUpstream } from "./openai.ts";
import type { Upstream } from "./types.ts";

export type UpstreamSelection =
  | { kind: "copilot" }
  | { kind: "openai"; upstream: Upstream };

export type UpstreamResolution =
  | { type: "selected"; selection: UpstreamSelection }
  | { type: "not-found" }
  | { type: "upstream-error"; error: unknown };

/**
 * Returns the list of currently usable upstreams.
 *
 * One Copilot upstream per connected GitHub account, in account order, then
 * each enabled custom OpenAI-compatible upstream. Used by the merging
 * /v1/models route and by request resolution that needs to union across all
 * upstreams.
 */
export const listAllUpstreams = async (): Promise<Upstream[]> => {
  const upstreams: Upstream[] = [];

  const accounts = await getRepo().github.listAccounts();
  for (const account of accounts) {
    upstreams.push(
      await createCopilotUpstream(account.token, account.accountType),
    );
  }

  const customConfigs = await getRepo().upstreamConfigs.list();
  for (const config of customConfigs) {
    if (!config.enabled) continue;
    upstreams.push(createOpenAiUpstream(config));
  }

  return upstreams;
};

/**
 * Find which upstream serves the given model id.
 *
 * Copilot is checked first via account-aware model loading. If at least one
 * connected account lists the model, we return Copilot. If every account's
 * /models load fails with a switchable upstream error (rate-limited token
 * fetch, transient 5xx), we still return Copilot so the account-fallback
 * path can re-attempt and surface the upstream error. Otherwise we walk
 * custom OpenAI-compatible upstreams; if none of them claim the model the
 * request is rejected with a 404-style error by the caller.
 */
export const resolveUpstreamForModel = async (
  modelId: string,
): Promise<UpstreamResolution> => {
  const accounts = await getRepo().github.listAccounts();
  let copilotSwitchableErrorOnly = accounts.length > 0;

  for (const account of accounts) {
    const result = await loadModelsForAccount(account);
    if (result.type === "models") {
      copilotSwitchableErrorOnly = false;
      if (findModelInModels(result.data, modelId)) {
        return { type: "selected", selection: { kind: "copilot" } };
      }
      continue;
    }
    if (!isSwitchableModelsLoadError(result.error)) {
      copilotSwitchableErrorOnly = false;
    }
  }

  const customConfigs = await getRepo().upstreamConfigs.list();
  let lastCustomError: unknown = null;
  for (const config of customConfigs) {
    if (!config.enabled) continue;
    const upstream = createOpenAiUpstream(config);
    const result = await loadModels(upstream);
    if (result.type === "models") {
      if (findModelInModels(result.data, modelId)) {
        return { type: "selected", selection: { kind: "openai", upstream } };
      }
      continue;
    }
    // Track rather than swallow — auth errors, config errors, and upstream 5xx
    // from custom upstreams must surface when no other upstream can serve the
    // model, instead of masquerading as model-not-found 404s.
    lastCustomError = result.error;
  }

  if (copilotSwitchableErrorOnly) {
    return { type: "selected", selection: { kind: "copilot" } };
  }

  if (lastCustomError) {
    return { type: "upstream-error", error: lastCustomError };
  }
  return { type: "not-found" };
};
