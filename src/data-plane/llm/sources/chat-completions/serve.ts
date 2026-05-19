import type { Context } from "hono";
import type {
  ChatCompletionChunk,
  ChatCompletionsPayload,
} from "../../shared/protocol/chat-completions.ts";
import { planChatRequest } from "./plan.ts";
import { getModelCapabilities } from "../../shared/models/get-model-capabilities.ts";
import {
  chatModelResolutionIntent,
  resolveModelForRequest,
} from "../../shared/models/resolve-model.ts";
import { buildTargetRequest as buildMessagesTargetRequest } from "../../translate/chat-completions-via-messages/request.ts";
import { buildTargetRequest as buildResponsesTargetRequest } from "../../translate/chat-completions-via-responses/request.ts";
import { emitToMessages } from "../../targets/messages/emit.ts";
import { emitToResponses } from "../../targets/responses/emit.ts";
import { emitToChatCompletions } from "../../targets/chat-completions/emit.ts";
import { translateToSourceEvents as translateMessagesToSourceEvents } from "../../translate/chat-completions-via-messages/events.ts";
import { translateToSourceEvents as translateResponsesToSourceEvents } from "../../translate/chat-completions-via-responses/events.ts";
import { respondChatCompletions } from "./respond.ts";
import {
  internalErrorResult,
  type StreamExecuteResult,
  type UpstreamErrorResult,
} from "../../shared/errors/result.ts";
import { toInternalDebugError } from "../../shared/errors/internal-debug-error.ts";
import {
  modelLoadErrorResult,
  runOnUpstream,
} from "../../shared/upstream-run.ts";
import { resolveUpstreamForModel } from "../../../../shared/upstream/resolver.ts";
import {
  type PerformanceTelemetryContext,
  runtimeLocationFromRequest,
} from "../../../shared/performance/telemetry.ts";
import { backgroundSchedulerFromContext } from "../../../../runtime/background.ts";
import type { ProtocolFrame } from "../../shared/stream/types.ts";

const unsupportedChatModelResult = (
  model: string,
): UpstreamErrorResult => ({
  type: "upstream-error",
  status: 400,
  headers: new Headers({ "content-type": "application/json" }),
  body: new TextEncoder().encode(JSON.stringify({
    error: {
      message:
        `Model ${model} does not support the /chat/completions endpoint.`,
      type: "invalid_request_error",
    },
  })),
});

const withTranslatedEvents = <T>(
  result: StreamExecuteResult<T>,
  translate: (
    events: AsyncIterable<ProtocolFrame<T>>,
  ) => AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): StreamExecuteResult<ChatCompletionChunk> =>
  result.type === "events"
    ? { ...result, events: translate(result.events) }
    : result;

const withResultMetadata = <T>(
  result: StreamExecuteResult<T>,
  usageModel: string,
  performance: PerformanceTelemetryContext,
): StreamExecuteResult<T> =>
  result.type === "events"
    ? { ...result, usageModel, performance }
    : { ...result, performance };

export const serveChatCompletions = async (
  c: Context,
): Promise<Response> => {
  let lastPerformance: PerformanceTelemetryContext | undefined;
  // Target interceptors may force upstream usage for gateway accounting, but
  // Chat SSE exposes usage only when the caller requested `include_usage`.
  let includeUsageChunk = false;
  let downstreamAbortController: AbortController | undefined;
  try {
    const payload = await c.req.json<ChatCompletionsPayload>();
    includeUsageChunk = payload.stream_options?.include_usage === true;
    const apiKeyId = c.get("apiKeyId") as string | undefined;
    const wantsStream = payload.stream === true;
    downstreamAbortController = wantsStream ? new AbortController() : undefined;
    const runtimeLocation = runtimeLocationFromRequest(c.req.raw);
    const scheduleBackground = backgroundSchedulerFromContext(c);
    const performanceFor = (
      model: string,
      targetApi: PerformanceTelemetryContext["targetApi"],
    ): PerformanceTelemetryContext => {
      lastPerformance = {
        keyId: apiKeyId ?? "unknown",
        model,
        sourceApi: "chat-completions",
        targetApi,
        stream: wantsStream,
        runtimeLocation,
      };
      return lastPerformance;
    };

    const intent = chatModelResolutionIntent(payload);
    const { id: modelId } = await resolveModelForRequest(
      payload.model,
      intent,
    );
    performanceFor(modelId, "chat-completions");

    const resolution = await resolveUpstreamForModel(modelId);
    const result = resolution.type === "not-found"
      ? {
        type: "upstream-error" as const,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        body: new TextEncoder().encode(JSON.stringify({
          error: {
            message:
              `No upstream provides model ${modelId}. Configure an upstream that exposes this model in the dashboard.`,
            type: "invalid_request_error",
          },
        })),
      }
      : resolution.type === "upstream-error"
      ? modelLoadErrorResult(resolution.error, lastPerformance)
      : await runOnUpstream(
        resolution.selection,
        modelId,
        async (upstream) => {
          const attemptPayload = structuredClone(payload);
          attemptPayload.model = modelId;
          const capabilities = await getModelCapabilities(
            modelId,
            upstream,
          );
          const plan = planChatRequest(attemptPayload, capabilities);
          if (!plan) {
            return unsupportedChatModelResult(attemptPayload.model);
          }

          if (plan.target === "messages") {
            performanceFor(attemptPayload.model, "messages");
            const targetPayload = await buildMessagesTargetRequest(
              attemptPayload,
              capabilities,
            );
            const performance = performanceFor(
              targetPayload.model,
              "messages",
            );
            const result = await emitToMessages({
              sourceApi: "chat-completions",
              payload: targetPayload,
              upstream,
              apiKeyId,
              clientStream: wantsStream,
              runtimeLocation,
              scheduleBackground,
              fetchOptions: plan.fetchOptions,
              downstreamAbortSignal: downstreamAbortController?.signal,
            });

            return withResultMetadata(
              withTranslatedEvents(result, translateMessagesToSourceEvents),
              targetPayload.model,
              performance,
            );
          }

          if (plan.target === "responses") {
            performanceFor(attemptPayload.model, "responses");
            const targetPayload = buildResponsesTargetRequest(attemptPayload);
            const performance = performanceFor(
              targetPayload.model,
              "responses",
            );
            const result = await emitToResponses({
              sourceApi: "chat-completions",
              payload: targetPayload,
              upstream,
              apiKeyId,
              clientStream: wantsStream,
              runtimeLocation,
              scheduleBackground,
              fetchOptions: plan.fetchOptions,
              downstreamAbortSignal: downstreamAbortController?.signal,
            });

            return withResultMetadata(
              withTranslatedEvents(result, translateResponsesToSourceEvents),
              targetPayload.model,
              performance,
            );
          }

          const performance = performanceFor(
            attemptPayload.model,
            "chat-completions",
          );
          return withResultMetadata(
            await emitToChatCompletions({
              sourceApi: "chat-completions",
              payload: attemptPayload,
              upstream,
              apiKeyId,
              clientStream: wantsStream,
              runtimeLocation,
              scheduleBackground,
              fetchOptions: plan.fetchOptions,
              downstreamAbortSignal: downstreamAbortController?.signal,
            }),
            attemptPayload.model,
            performance,
          );
        },
      );

    return await respondChatCompletions(
      c,
      result,
      wantsStream,
      includeUsageChunk,
      downstreamAbortController,
    );
  } catch (error) {
    return await respondChatCompletions(
      c,
      internalErrorResult(
        502,
        toInternalDebugError(error, "chat-completions"),
        lastPerformance,
      ),
      false,
      includeUsageChunk,
      downstreamAbortController,
    );
  }
};
