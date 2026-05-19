// GET /v1/models, /api/models — merge model lists from every configured
// upstream and every connected GitHub account.
//
// Account order matches `repo.github.listAccounts()`; custom OpenAI-compatible
// upstreams come after. The first upstream/account declaring a model "owns"
// that id — later entries are dropped so dashboards and routing agree on a
// single capability set per id (consistent with the routing rule that model
// ids are global upstream contracts).

import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../shared/copilot.ts";
import { ModelsFetchError } from "./cache.ts";
import { loadMergedModels } from "./load.ts";

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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const apiErrorResponse = (
  c: Context,
  message: string,
  status: 502,
): Response => c.json({ error: { message, type: "api_error" } }, status);

export const models = async (c: Context) => {
  try {
    return Response.json(await loadMergedModels());
  } catch (e: unknown) {
    const upstreamErr = errorResponse(e);
    if (upstreamErr) return upstreamErr;
    return apiErrorResponse(c, errorMessage(e), 502);
  }
};
