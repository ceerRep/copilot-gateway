import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../../../../shared/copilot.ts";
import { ModelsFetchError } from "../../../../models/cache.ts";
import type { MessagesPayload } from "../../../shared/protocol/messages.ts";
import { resolveUpstreamForModel } from "../../../../../shared/upstream/resolver.ts";
import { withAccountFallback } from "../../../../shared/account-pool/fallback.ts";
import {
  messagesModelResolutionIntent,
  resolveModelForRequest,
} from "../../../shared/models/resolve-model.ts";

const modelsLoadErrorResponse = (error: ModelsFetchError): Response =>
  new Response(error.body, {
    status: error.status,
    headers: new Headers(error.headers),
  });

export const countTokens = async (c: Context) => {
  try {
    const payload = await c.req.json<MessagesPayload>();

    const rawBeta = c.req.header("anthropic-beta");
    const intent = messagesModelResolutionIntent(payload, rawBeta);
    const { id: modelId } = await resolveModelForRequest(payload.model, intent);

    const resolution = await resolveUpstreamForModel(modelId);
    if (resolution.type === "upstream-error") {
      if (resolution.error instanceof ModelsFetchError) {
        return modelsLoadErrorResponse(resolution.error);
      }
      throw resolution.error;
    }
    if (
      resolution.type === "selected" && resolution.selection.kind !== "copilot"
    ) {
      return c.json({
        error: {
          type: "invalid_request_error",
          message:
            "count_tokens is only supported for Copilot-hosted models. The resolved model is served by a custom upstream that does not implement this endpoint.",
        },
      }, 400);
    }

    const resp = await withAccountFallback(
      modelId,
      ({ upstream }) => {
        const attemptPayload = structuredClone(payload);
        attemptPayload.model = modelId;
        return upstream.fetch(
          "messages_count_tokens",
          { method: "POST", body: JSON.stringify(attemptPayload) },
        );
      },
    );

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e: unknown) {
    if (isCopilotTokenFetchError(e)) {
      return new Response(e.body, {
        status: e.status,
        headers: e.headers,
      });
    }

    const msg = e instanceof Error ? e.message : String(e);
    console.error("Error counting tokens:", msg);
    return c.json({
      error: {
        type: "invalid_request_error",
        message: `Failed to count tokens: ${msg}`,
      },
    }, 400);
  }
};
