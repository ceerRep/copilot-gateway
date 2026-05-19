import type { Context } from "hono";
import type { MessagesPayload } from "../../shared/protocol/messages.ts";
import {
  type MessagesSourceContext,
  messagesSourceInterceptors,
} from "./interceptors/index.ts";
import { runSourceInterceptors } from "../run-interceptors.ts";
import { planMessagesRequest } from "./plan.ts";
import { getModelCapabilities } from "../../shared/models/get-model-capabilities.ts";
import {
  messagesModelResolutionIntent,
  resolveModelForRequest,
} from "../../shared/models/resolve-model.ts";
import { buildTargetRequest as buildChatTargetRequest } from "../../translate/messages-via-chat-completions/request.ts";
import { buildTargetRequest as buildResponsesTargetRequest } from "../../translate/messages-via-responses/request.ts";
import { emitToMessages } from "../../targets/messages/emit.ts";
import { emitToResponses } from "../../targets/responses/emit.ts";
import { emitToChatCompletions } from "../../targets/chat-completions/emit.ts";
import { translateToSourceEvents as translateResponsesToSourceEvents } from "../../translate/messages-via-responses/events.ts";
import { translateToSourceEvents as translateChatToSourceEvents } from "../../translate/messages-via-chat-completions/events.ts";
import { respondMessages } from "./respond.ts";
import {
  internalErrorResult,
  type StreamExecuteResult,
  type UpstreamErrorResult,
} from "../../shared/errors/result.ts";
import { toInternalDebugError } from "../../shared/errors/internal-debug-error.ts";
import { thrownUpstreamErrorResult } from "../../shared/errors/upstream-error.ts";
import type { ProtocolFrame } from "../../shared/stream/types.ts";
import {
  modelLoadErrorResult,
  runOnUpstream,
} from "../../shared/upstream-run.ts";
import { resolveUpstreamForModel } from "../../../../shared/upstream/resolver.ts";
import {
  type PerformanceTelemetryContext,
  runtimeLocationFromRequest,
} from "../../../shared/performance/telemetry.ts";
import type { MessagesStreamEventData } from "../../shared/protocol/messages.ts";
import { backgroundSchedulerFromContext } from "../../../../runtime/background.ts";

const unsupportedMessagesModelResult = (
  model: string,
  performance: PerformanceTelemetryContext,
): UpstreamErrorResult => ({
  type: "upstream-error",
  status: 400,
  headers: new Headers({ "content-type": "application/json" }),
  body: new TextEncoder().encode(JSON.stringify({
    error: {
      message: `Model ${model} does not support the /messages endpoint.`,
      type: "invalid_request_error",
    },
  })),
  performance,
});

const withTranslatedEvents = <T>(
  result: StreamExecuteResult<T>,
  translate: (
    events: AsyncIterable<ProtocolFrame<T>>,
  ) => AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
): StreamExecuteResult<MessagesStreamEventData> =>
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

export const serveMessages = async (
  c: Context,
): Promise<Response> => {
  let lastPerformance: PerformanceTelemetryContext | undefined;
  let downstreamAbortController: AbortController | undefined;
  try {
    const payload = await c.req.json<MessagesPayload>();
    const apiKeyId = c.get("apiKeyId") as string | undefined;
    const wantsStream = payload.stream === true;
    downstreamAbortController = wantsStream ? new AbortController() : undefined;
    const runtimeLocation = runtimeLocationFromRequest(c.req.raw);
    const scheduleBackground = backgroundSchedulerFromContext(c);
    const rawBeta = c.req.header("anthropic-beta");
    const ctx: MessagesSourceContext = { payload, apiKeyId };
    const performanceFor = (
      model: string,
      targetApi: PerformanceTelemetryContext["targetApi"],
    ): PerformanceTelemetryContext => {
      lastPerformance = {
        keyId: apiKeyId ?? "unknown",
        model,
        sourceApi: "messages",
        targetApi,
        stream: wantsStream,
        runtimeLocation,
      };
      return lastPerformance;
    };

    const result = await runSourceInterceptors(
      ctx,
      messagesSourceInterceptors,
      async () => {
        const intent = messagesModelResolutionIntent(ctx.payload, rawBeta);
        const { id: modelId } = await resolveModelForRequest(
          ctx.payload.model,
          intent,
        );
        performanceFor(modelId, "messages");

        const resolution = await resolveUpstreamForModel(modelId);
        if (resolution.type === "not-found") {
          return {
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
          };
        }
        if (resolution.type === "upstream-error") {
          return modelLoadErrorResult(resolution.error, lastPerformance);
        }

        return await runOnUpstream(
          resolution.selection,
          modelId,
          async (upstream) => {
            const attemptPayload = structuredClone(ctx.payload);
            attemptPayload.model = modelId;
            const capabilities = await getModelCapabilities(
              modelId,
              upstream,
            );
            const plan = planMessagesRequest(
              attemptPayload,
              capabilities,
              rawBeta,
            );
            if (!plan) {
              const performance = performanceFor(
                attemptPayload.model,
                "messages",
              );
              return unsupportedMessagesModelResult(
                attemptPayload.model,
                performance,
              );
            }

            if (plan.target === "messages") {
              const performance = performanceFor(
                attemptPayload.model,
                "messages",
              );
              return withResultMetadata(
                await emitToMessages({
                  sourceApi: "messages",
                  payload: attemptPayload,
                  upstream,
                  apiKeyId,
                  clientStream: wantsStream,
                  runtimeLocation,
                  scheduleBackground,
                  fetchOptions: plan.fetchOptions,
                  downstreamAbortSignal: downstreamAbortController?.signal,
                  rawBeta: plan.rawBeta,
                }),
                attemptPayload.model,
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
                sourceApi: "messages",
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

            performanceFor(attemptPayload.model, "chat-completions");
            const targetPayload = buildChatTargetRequest(attemptPayload);
            const performance = performanceFor(
              targetPayload.model,
              "chat-completions",
            );
            const result = await emitToChatCompletions({
              sourceApi: "messages",
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
              withTranslatedEvents(result, translateChatToSourceEvents),
              targetPayload.model,
              performance,
            );
          },
        );
      },
    );

    return await respondMessages(
      c,
      result,
      wantsStream,
      downstreamAbortController,
    );
  } catch (error) {
    const upstreamError = thrownUpstreamErrorResult(error, lastPerformance);
    if (upstreamError) {
      return await respondMessages(
        c,
        upstreamError,
        false,
        downstreamAbortController,
      );
    }

    return await respondMessages(
      c,
      internalErrorResult(
        502,
        toInternalDebugError(error, "messages"),
        lastPerformance,
      ),
      false,
      downstreamAbortController,
    );
  }
};
