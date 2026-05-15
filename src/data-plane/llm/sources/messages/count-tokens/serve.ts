import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../../../../lib/copilot.ts";
import type { MessagesPayload } from "../../../../../lib/messages-types.ts";
import { resolveUpstreamForModel } from "../../../../../lib/upstream/resolver.ts";
import { withAccountFallback } from "../../../../shared/account-pool/fallback.ts";
import {
  messagesModelResolutionIntent,
  resolveModelForRequest,
} from "../../../shared/models/resolve-model.ts";
import { resolveVirtualModel } from "../../../shared/models/virtual-models.ts";

export const countTokens = async (c: Context) => {
  try {
    let payload = await c.req.json<MessagesPayload>();

    const virtualResolution = await resolveVirtualModel(payload.model);
    if (virtualResolution) {
      // Match the generation path: strip output_config and disable thinking
      // so the token count reflects what the upstream will actually receive.
      const { output_config: _outputConfig, ...rest } = payload;
      payload = {
        ...rest,
        model: virtualResolution.targetModel,
        thinking: { type: "disabled" as const },
      };
    }

    const rawBeta = c.req.header("anthropic-beta");
    const intent = messagesModelResolutionIntent(payload, rawBeta);
    const modelId = await resolveModelForRequest(payload.model, intent);

    const selection = await resolveUpstreamForModel(modelId);
    if (selection && selection.kind !== "copilot") {
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
