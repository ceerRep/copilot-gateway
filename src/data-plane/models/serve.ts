// GET /v1/models, /api/models — merge model lists from every configured
// upstream and every connected GitHub account.
//
// Account order matches `repo.github.listAccounts()`; custom OpenAI-compatible
// upstreams come after. The first upstream/account declaring a model "owns"
// that id — later entries are dropped so dashboards and routing agree on a
// single capability set per id (consistent with the routing rule that model
// ids are global upstream contracts).

import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../lib/copilot.ts";
import {
  loadModels,
  loadModelsForAccount,
  type ModelInfo,
  ModelsFetchError,
} from "../../lib/models-cache.ts";
import { getRepo } from "../../repo/index.ts";
import { createOpenAiUpstream } from "../../lib/upstream/openai.ts";
import {
  apiErrorResponse,
  getErrorMessage,
} from "../shared/http/proxy-response.ts";
import { mergeClaudeVariants } from "./merge.ts";

const errorResponse = (error: unknown): Response | null => {
  if (error instanceof ModelsFetchError) {
    return new Response(error.body, {
      status: error.status,
      headers: error.headers,
    });
  }

  if (isCopilotTokenFetchError(error)) {
    return new Response(error.body, {
      status: error.status,
      headers: error.headers,
    });
  }

  return null;
};

export const models = async (c: Context) => {
  try {
    const byId = new Map<string, ModelInfo>();
    let lastCopilotError: unknown = null;
    let sawCopilotSuccess = false;

    const accounts = await getRepo().github.listAccounts();
    for (const account of accounts) {
      const result = await loadModelsForAccount(account);
      if (result.type === "error") {
        lastCopilotError = result.error;
        continue;
      }
      sawCopilotSuccess = true;
      for (const model of result.data.data) {
        if (!model?.id || byId.has(model.id)) continue;
        // Copilot's /models is authoritative — supported_endpoints is set
        // explicitly per SKU, so we keep whatever it declares (or undefined).
        byId.set(model.id, { ...model, upstream_kind: "copilot" });
      }
    }

    const customConfigs = await getRepo().upstreamConfigs.list();
    let sawCustomSuccess = false;
    let lastCustomError: unknown = null;
    for (const config of customConfigs) {
      if (!config.enabled) continue;
      const upstream = createOpenAiUpstream(config);
      const result = await loadModels(upstream);
      if (result.type === "error") {
        lastCustomError = result.error;
        continue;
      }
      sawCustomSuccess = true;
      for (const model of result.data.data) {
        if (!model?.id || byId.has(model.id)) continue;
        // Most third-party OpenAI-compatible providers do not declare
        // per-model supported_endpoints — fall back to the upstream-level
        // configuration so dashboard pickers and routing agree.
        const supported_endpoints = model.supported_endpoints ??
          upstream.supportedEndpoints;
        byId.set(model.id, {
          ...model,
          supported_endpoints,
          upstream_kind: "openai",
        });
      }
    }

    if (sawCopilotSuccess || sawCustomSuccess) {
      // Merge Claude variants (reasoning-effort, 1M-context, dated aliases)
      // into base model ids for a clean outbound view. Non-Claude models
      // (gpt-*, gemini-*, custom-upstream) pass through unchanged.
      const merged = mergeClaudeVariants({
        object: "list",
        data: [...byId.values()],
      });
      return Response.json(merged);
    }

    if (accounts.length === 0 && !sawCustomSuccess) {
      const anyError = lastCustomError ?? lastCopilotError;
      if (anyError) {
        const upstreamErr = errorResponse(anyError);
        if (upstreamErr) return upstreamErr;
        return apiErrorResponse(c, getErrorMessage(anyError), 502);
      }
      return apiErrorResponse(
        c,
        "No GitHub account connected — add one via the dashboard",
        502,
      );
    }

    const upstreamErr = errorResponse(lastCopilotError);
    if (upstreamErr) return upstreamErr;
    if (lastCopilotError) {
      return apiErrorResponse(c, getErrorMessage(lastCopilotError), 502);
    }
    if (lastCustomError) {
      const customErr = errorResponse(lastCustomError);
      if (customErr) return customErr;
      return apiErrorResponse(c, getErrorMessage(lastCustomError), 502);
    }
    return Response.json({ object: "list", data: [] });
  } catch (e: unknown) {
    return apiErrorResponse(c, getErrorMessage(e), 502);
  }
};
