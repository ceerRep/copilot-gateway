import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../../../../lib/copilot.ts";
import type { MessagesPayload } from "../../../../../lib/messages-types.ts";
import { withAccountFallback } from "../../../../shared/account-pool/fallback.ts";
import {
  messagesModelResolutionIntent,
  resolveModelForRequest,
} from "../../../shared/models/resolve-model.ts";

// count_tokens is an Anthropic Messages-shaped endpoint hosted only by
// Copilot — third-party OpenAI-compatible upstreams do not implement it. We
// always go through the Copilot account pool here; the account-fallback path
// returns a clear error when no GitHub account is connected.
export const countTokens = async (c: Context) => {
  try {
    const payload = await c.req.json<MessagesPayload>();
    const rawBeta = c.req.header("anthropic-beta");
    const intent = messagesModelResolutionIntent(payload, rawBeta);
    const modelId = await resolveModelForRequest(payload.model, intent);

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
