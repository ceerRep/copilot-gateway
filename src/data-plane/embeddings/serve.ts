// POST /v1/embeddings — route embedding requests to the upstream that
// declares the requested model. Copilot upstreams go through the account pool
// so a 429/403/500 on one account fails over to the next; custom
// OpenAI-compatible upstreams are served by their single connection.

import type { Context } from "hono";

import { isCopilotTokenFetchError } from "../../shared/copilot.ts";
import { findModel, ModelsFetchError } from "../models/cache.ts";
import { resolveUpstreamForModel } from "../../shared/upstream/resolver.ts";
import { resolveEffectiveSupportedEndpoints } from "../shared/models/resolve-endpoints.ts";
import { runOnUpstream } from "../shared/upstream-run.ts";
import { withAccountFallback } from "../shared/account-pool/fallback.ts";
import { setUsageResponseMetadata } from "../../middleware/usage-response-metadata.ts";

interface EmbeddingsRequestBody {
  model?: unknown;
  input?: unknown;
  [key: string]: unknown;
}

const prepareEmbeddingsRequest = (body: string) => {
  let model = "unknown";
  let usageModel: string | undefined;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { body, model, usageModel };
    }

    const request = parsed as EmbeddingsRequestBody;
    if (typeof request.model === "string") {
      model = request.model;
      usageModel = request.model;
    }

    if (typeof request.input !== "string") return { body, model, usageModel };

    // OpenAI-compatible clients may send scalar string input, but Copilot's
    // upstream /embeddings endpoint currently returns 400 unless text input is
    // wrapped as an array. This belongs at the embeddings boundary so invalid
    // JSON and already-array inputs remain transparent to upstream.
    // References:
    // https://platform.openai.com/docs/api-reference/embeddings/create
    // https://github.com/ericc-ch/copilot-api/blob/0ea08febdd7e3e055b03dd298bf57e669500b5c1/src/services/copilot/create-embeddings.ts#L19-L21
    // https://github.com/BerriAI/litellm/blob/c8fb77f119ad69a80f5fde088efd3a1aa77f458b/litellm/proxy/proxy_server.py#L7826-L7839
    return {
      body: JSON.stringify({ ...request, input: [request.input] }),
      model,
      usageModel,
    };
  } catch {
    // Let upstream preserve the request-shape error; fallback simply has no model signal.
    return { body, model, usageModel };
  }
};

const modelsLoadErrorResponse = (error: unknown): Response | null =>
  error instanceof ModelsFetchError
    ? new Response(error.body, {
      status: error.status,
      headers: new Headers(error.headers),
    })
    : null;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const apiErrorResponse = (
  c: Context,
  message: string,
  status: 400 | 404 | 502,
): Response => c.json({ error: { message, type: "api_error" } }, status);

const proxyJsonResponse = (resp: Response): Response =>
  new Response(resp.body, {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") ?? "application/json",
    },
  });

export const embeddings = async (c: Context) => {
  try {
    const request = prepareEmbeddingsRequest(await c.req.text());

    // When the body is malformed or lacks a model string, skip upstream
    // resolution and let Copilot produce the request-shape validation error
    // so the client sees the provider's native error rather than a gateway 404.
    if (!request.usageModel) {
      const resp = await withAccountFallback(
        request.model,
        ({ upstream }) =>
          upstream.fetch("embeddings", { method: "POST", body: request.body }),
      );
      setUsageResponseMetadata(c, {
        usageModel: request.usageModel,
      });
      return proxyJsonResponse(resp);
    }

    const resolution = await resolveUpstreamForModel(request.model);
    if (resolution.type === "not-found") {
      return apiErrorResponse(
        c,
        `No upstream provides model ${request.model}. Configure an upstream that exposes this model in the dashboard.`,
        404,
      );
    }
    if (resolution.type === "upstream-error") {
      const response = modelsLoadErrorResponse(resolution.error);
      if (response) return response;
      throw resolution.error;
    }

    const resp = await runOnUpstream(
      resolution.selection,
      request.model,
      async (upstream) => {
        const model = await findModel(request.model, upstream);
        const { endpoints, explicit } = resolveEffectiveSupportedEndpoints(
          model?.supported_endpoints,
          upstream,
        );
        if (explicit && !endpoints.includes("/embeddings")) {
          return apiErrorResponse(
            c,
            `Model ${request.model} does not support the /embeddings endpoint.`,
            400,
          );
        }
        const upstreamResponse = await upstream.fetch("embeddings", {
          method: "POST",
          body: request.body,
        });
        setUsageResponseMetadata(c, { usageModel: request.usageModel });
        return proxyJsonResponse(upstreamResponse);
      },
    );

    return resp;
  } catch (e: unknown) {
    if (isCopilotTokenFetchError(e)) {
      return new Response(e.body, {
        status: e.status,
        headers: e.headers,
      });
    }

    return apiErrorResponse(c, errorMessage(e), 502);
  }
};
