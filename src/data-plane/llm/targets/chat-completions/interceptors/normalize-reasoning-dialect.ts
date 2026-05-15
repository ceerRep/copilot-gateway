import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
} from "../../../../../lib/chat-completions-types.ts";
import { jsonFrame, sseFrame } from "../../../shared/stream/types.ts";
import type { Upstream } from "../../../../../lib/upstream/types.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";

/**
 * DeepSeek's reasoner endpoints predate OpenAI's `reasoning_text` / opaque
 * split — they keep the legacy `reasoning_content` scalar both in responses
 * and in the assistant messages a client must replay during multi-turn tool
 * calls. The gateway's internal protocol is the OpenAI shape, so when an
 * upstream is configured with `reasoningDialect: "deepseek"` we rename
 * fields on the way out (`reasoning_text` → `reasoning_content`) and on the
 * way back in (`reasoning_content` → `reasoning_text`).
 *
 * This is required for correctness, not just aesthetics: DeepSeek 400s if
 * the assistant message that produced a tool call is replayed without its
 * `reasoning_content`, since the model's tool-call rationale lives there.
 *
 * References:
 * - https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 */

type AnyRecord = Record<string, unknown>;

const rewriteOutboundMessage = (message: Message): Message => {
  if (typeof message.reasoning_text !== "string") return message;
  // DeepSeek does not understand reasoning_opaque or reasoning_items; drop
  // them rather than ship unknown fields. The OpenAI-shape opaque chain
  // cannot survive a hop through a dialect that has no concept of it.
  const {
    reasoning_text,
    reasoning_opaque: _opaque,
    reasoning_items: _items,
    ...rest
  } = message;
  return { ...rest, reasoning_content: reasoning_text } as Message;
};

const rewriteOutboundPayload = (
  payload: ChatCompletionsPayload,
): ChatCompletionsPayload => ({
  ...payload,
  messages: payload.messages.map(rewriteOutboundMessage),
});

const renameReasoningContentToText = (record: AnyRecord): boolean => {
  if (typeof record.reasoning_content !== "string") return false;
  if (record.reasoning_text === undefined) {
    record.reasoning_text = record.reasoning_content;
  }
  delete record.reasoning_content;
  return true;
};

const rewriteInboundChunkJson = (data: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return data;
  }
  if (!parsed || typeof parsed !== "object") return data;

  const root = parsed as AnyRecord;
  let changed = false;

  const choices = root.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const choiceRecord = choice as AnyRecord;
      const delta = choiceRecord.delta;
      if (delta && typeof delta === "object") {
        if (renameReasoningContentToText(delta as AnyRecord)) changed = true;
      }
      const message = choiceRecord.message;
      if (message && typeof message === "object") {
        if (renameReasoningContentToText(message as AnyRecord)) changed = true;
      }
    }
  }

  return changed ? JSON.stringify(root) : data;
};

const rewriteInboundResponse = (
  response: ChatCompletionResponse,
): ChatCompletionResponse => {
  let changed = false;
  const choices = response.choices.map((choice) => {
    const message = choice.message as unknown as AnyRecord;
    if (renameReasoningContentToText(message)) {
      changed = true;
      return { ...choice, message: message as typeof choice.message };
    }
    return choice;
  });
  return changed ? { ...response, choices } : response;
};

export const withDeepseekReasoningDialect: TargetInterceptor<
  { payload: ChatCompletionsPayload; upstream: Upstream },
  ChatCompletionResponse
> = async (ctx, run) => {
  if (ctx.upstream.reasoningDialect !== "deepseek") return await run();

  ctx.payload = rewriteOutboundPayload(ctx.payload);

  const result = await run();
  if (result.type !== "events") return result;

  return {
    type: "events",
    events: (async function* () {
      for await (const frame of result.events) {
        if (frame.type === "sse") {
          yield sseFrame(rewriteInboundChunkJson(frame.data), frame.event);
          continue;
        }
        yield jsonFrame(rewriteInboundResponse(frame.data));
      }
    })(),
  };
};
