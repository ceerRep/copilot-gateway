import { assertEquals } from "@std/assert";
import type { ChatCompletionsPayload } from "../../../lib/chat-completions-types.ts";
import type { MessagesPayload } from "../../../lib/messages-types.ts";
import type { ResponsesPayload } from "../../../lib/responses-types.ts";
import {
  chatHasForcedToolChoice,
  messagesHasForcedToolChoice,
  responsesHasForcedToolChoice,
} from "./forced-tool-choice.ts";

const baseMessages: MessagesPayload = {
  model: "m",
  messages: [],
  max_tokens: 1,
};
const baseResponses: ResponsesPayload = { model: "m", input: [] };
const baseChat: ChatCompletionsPayload = { model: "m", messages: [] };

Deno.test("messagesHasForcedToolChoice: undefined / auto / none → false", () => {
  assertEquals(messagesHasForcedToolChoice(baseMessages), false);
  assertEquals(
    messagesHasForcedToolChoice({
      ...baseMessages,
      tool_choice: { type: "auto" },
    }),
    false,
  );
  assertEquals(
    messagesHasForcedToolChoice({
      ...baseMessages,
      tool_choice: { type: "none" },
    }),
    false,
  );
});

Deno.test("messagesHasForcedToolChoice: any / tool → true", () => {
  assertEquals(
    messagesHasForcedToolChoice({
      ...baseMessages,
      tool_choice: { type: "any" },
    }),
    true,
  );
  assertEquals(
    messagesHasForcedToolChoice({
      ...baseMessages,
      tool_choice: { type: "tool", name: "x" },
    }),
    true,
  );
});

Deno.test("responsesHasForcedToolChoice: undefined / null / auto / none → false", () => {
  assertEquals(responsesHasForcedToolChoice(baseResponses), false);
  assertEquals(
    responsesHasForcedToolChoice({ ...baseResponses, tool_choice: "auto" }),
    false,
  );
  assertEquals(
    responsesHasForcedToolChoice({ ...baseResponses, tool_choice: "none" }),
    false,
  );
});

Deno.test("responsesHasForcedToolChoice: required / function object / custom object / hosted-tool object → true", () => {
  assertEquals(
    responsesHasForcedToolChoice({
      ...baseResponses,
      tool_choice: "required",
    }),
    true,
  );
  assertEquals(
    responsesHasForcedToolChoice({
      ...baseResponses,
      tool_choice: { type: "function", name: "x" },
    }),
    true,
  );
  assertEquals(
    responsesHasForcedToolChoice({
      ...baseResponses,
      tool_choice: { type: "custom", name: "x" },
    }),
    true,
  );
  assertEquals(
    responsesHasForcedToolChoice({
      ...baseResponses,
      tool_choice: { type: "web_search" },
    }),
    true,
  );
});

Deno.test("chatHasForcedToolChoice: undefined / null / auto / none → false", () => {
  assertEquals(chatHasForcedToolChoice(baseChat), false);
  assertEquals(
    chatHasForcedToolChoice({ ...baseChat, tool_choice: "auto" }),
    false,
  );
  assertEquals(
    chatHasForcedToolChoice({ ...baseChat, tool_choice: "none" }),
    false,
  );
  assertEquals(
    chatHasForcedToolChoice({ ...baseChat, tool_choice: null }),
    false,
  );
});

Deno.test("chatHasForcedToolChoice: required / function object → true", () => {
  assertEquals(
    chatHasForcedToolChoice({ ...baseChat, tool_choice: "required" }),
    true,
  );
  assertEquals(
    chatHasForcedToolChoice({
      ...baseChat,
      tool_choice: { type: "function", function: { name: "x" } },
    }),
    true,
  );
});
