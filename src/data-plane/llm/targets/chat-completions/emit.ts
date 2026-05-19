import { isCopilotTokenFetchError } from "../../../../shared/copilot.ts";
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "../../shared/protocol/chat-completions.ts";
import { readUpstreamError } from "../../shared/errors/upstream-error.ts";
import {
  eventResult,
  internalErrorResult,
} from "../../shared/errors/result.ts";
import { toInternalDebugError } from "../../shared/errors/internal-debug-error.ts";
import { parseSSEStream } from "../../shared/stream/parse-sse.ts";
import { jsonFrame } from "../../shared/stream/types.ts";
import { runTargetInterceptors } from "../run-interceptors.ts";
import type { EmitInput, EmitResult, RawEmitResult } from "../emit-types.ts";
import {
  recordUpstreamHttpFailure,
  withUpstreamTelemetry,
} from "../telemetry.ts";
import { chatCompletionsStreamFramesToEvents } from "./events/from-stream.ts";
import { interceptorsForChatCompletions } from "./interceptors/index.ts";

const isSSEResponse = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").includes("text/event-stream");

export interface EmitToChatCompletionsInput
  extends EmitInput<ChatCompletionsPayload> {}

const chatCompletionsRawResultToProtocolResult = (
  result: RawEmitResult<ChatCompletionResponse>,
): EmitResult<ChatCompletionChunk> =>
  result.type === "events"
    ? eventResult(chatCompletionsStreamFramesToEvents(result.events))
    : result;

export const emitToChatCompletions = async (
  input: EmitToChatCompletionsInput,
): Promise<EmitResult<ChatCompletionChunk>> => {
  try {
    const result = await runTargetInterceptors<
      EmitToChatCompletionsInput,
      ChatCompletionResponse
    >(
      input,
      interceptorsForChatCompletions(input.upstream),
      async () => {
        const upstreamStartedAt = performance.now();
        const response = await input.upstream.fetch(
          "chat_completions",
          {
            method: "POST",
            body: JSON.stringify(input.payload),
            signal: input.downstreamAbortSignal,
          },
          input.fetchOptions,
        );

        if (!response.ok) {
          recordUpstreamHttpFailure(input, "chat-completions");
          return await readUpstreamError(response);
        }
        if (!response.body) {
          return internalErrorResult(
            502,
            toInternalDebugError(
              new Error("No response body from upstream"),
              input.sourceApi,
              "chat-completions",
            ),
          );
        }

        if (isSSEResponse(response)) {
          return eventResult(withUpstreamTelemetry(
            parseSSEStream(response.body, {
              signal: input.downstreamAbortSignal,
            }),
            input,
            "chat-completions",
            upstreamStartedAt,
          ));
        }

        return eventResult(withUpstreamTelemetry(
          (async function* () {
            yield jsonFrame(await response.json() as ChatCompletionResponse);
          })(),
          input,
          "chat-completions",
          upstreamStartedAt,
        ));
      },
    );

    return chatCompletionsRawResultToProtocolResult(result);
  } catch (error) {
    if (isCopilotTokenFetchError(error)) {
      return {
        type: "upstream-error",
        status: error.status,
        headers: new Headers(error.headers),
        body: new TextEncoder().encode(error.body),
      };
    }

    return internalErrorResult(
      502,
      toInternalDebugError(error, input.sourceApi, "chat-completions"),
    );
  }
};
