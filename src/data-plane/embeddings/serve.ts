// POST /v1/embeddings — route embedding requests to the upstream that
// declares the requested model. Copilot upstreams go through the account pool
// so a 429/403/500 on one account fails over to the next; custom
// OpenAI-compatible upstreams are served by their single connection.

import type { Context } from "hono";

import { isCopilotTokenFetchError } from "../../lib/copilot.ts";
import { resolveUpstreamForModel } from "../../lib/upstream/resolver.ts";
import { runOnUpstream } from "../llm/shared/upstream-run.ts";
import { withUsageResponseMetadata } from "../../middleware/usage-response-metadata.ts";
import {
  apiErrorResponse,
  getErrorMessage,
  proxyJsonResponse,
} from "../shared/http/proxy-response.ts";

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

export const embeddings = async (c: Context) => {
  try {
    const request = prepareEmbeddingsRequest(await c.req.text());

    const selection = await resolveUpstreamForModel(request.model);
    if (!selection) {
      return apiErrorResponse(
        c,
        `No upstream provides model ${request.model}. Configure an upstream that exposes this model in the dashboard.`,
        404,
      );
    }

    const resp = await runOnUpstream(
      selection,
      request.model,
      (upstream) =>
        upstream.fetch("embeddings", { method: "POST", body: request.body }),
    );

    return withUsageResponseMetadata(c, proxyJsonResponse(resp), {
      usageModel: request.usageModel,
    });
  } catch (e: unknown) {
    if (isCopilotTokenFetchError(e)) {
      return new Response(e.body, {
        status: e.status,
        headers: e.headers,
      });
    }

    return apiErrorResponse(c, getErrorMessage(e), 502);
  }
};
