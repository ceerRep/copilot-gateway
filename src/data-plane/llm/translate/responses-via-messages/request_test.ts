import { assertEquals, assertFalse } from "@std/assert";
import {
  MESSAGES_FALLBACK_MAX_TOKENS,
  type MessagesMessage,
} from "../../shared/protocol/messages.ts";
import { translateResponsesToMessagesResponse } from "../messages-via-responses/result.ts";
import { translateResponsesToMessages } from "./request.ts";

const stubRemoteImageLoader = (
  result: { mediaType: string | null; data: Uint8Array } | null,
) =>
() => Promise.resolve(result);

Deno.test("translateResponsesToMessages maps reasoning.effort none to thinking.disabled", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
    reasoning: { effort: "none", summary: "detailed" },
  });

  assertEquals(result.thinking, { type: "disabled" });
  assertFalse("output_config" in result);
});

Deno.test("translateResponsesToMessages maps reasoning.effort directly to output_config.effort", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
    reasoning: { effort: "minimal", summary: "detailed" },
  });

  assertEquals(result.output_config, { effort: "minimal" });
  assertFalse("thinking" in result);
});

Deno.test("translateResponsesToMessages defaults max_tokens to MESSAGES_FALLBACK_MAX_TOKENS when neither source nor fallbackMaxOutputTokens supplies one", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: null,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  assertEquals(result.max_tokens, MESSAGES_FALLBACK_MAX_TOKENS);
});

Deno.test("translateResponsesToMessages uses fallbackMaxOutputTokens over the gateway const when the source omitted max_output_tokens", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: null,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  }, { fallbackMaxOutputTokens: 4096 });

  assertEquals(result.max_tokens, 4096);
});

Deno.test("translateResponsesToMessages packs reasoning id into the Anthropic signature", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{
      type: "reasoning",
      id: "rs_42",
      summary: [{ type: "summary_text", text: "trace" }],
      encrypted_content: "enc_abc",
    }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  const assistant = result.messages[0];
  if (assistant.role !== "assistant" || !Array.isArray(assistant.content)) {
    throw new Error("expected assistant message with content blocks");
  }

  assertEquals(assistant.content[0], {
    type: "thinking",
    thinking: "trace",
    signature: "enc_abc@rs_42",
  });
});

Deno.test("translateResponsesToMessagesResponse omits signature for text-only reasoning", () => {
  const result = translateResponsesToMessagesResponse({
    id: "resp_123",
    object: "response",
    model: "gpt-test",
    output: [{
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "trace" }],
    }],
    output_text: "",
    status: "completed",
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
    },
  });

  const block = result.content[0];
  assertEquals(block, { type: "thinking", thinking: "trace" });
  assertFalse("signature" in block);
});

Deno.test("translateResponsesToMessages omits generic metadata instead of coercing it to metadata.user_id", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: { trace_id: "trace_123" },
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  assertFalse("metadata" in result);
});

Deno.test("translateResponsesToMessages resolves remote input images through the shared loader", async () => {
  const result = await translateResponsesToMessages(
    {
      model: "claude-test",
      input: [{
        type: "message",
        role: "user",
        content: [{
          type: "input_image",
          image_url: "https://example.com/image.png",
          detail: "auto",
        }],
      }],
      instructions: null,
      temperature: null,
      top_p: null,
      max_output_tokens: 256,
      tools: null,
      tool_choice: "auto",
      metadata: null,
      stream: null,
      store: false,
      parallel_tool_calls: true,
    },
    {
      loadRemoteImage: stubRemoteImageLoader({
        mediaType: "image/png",
        data: new Uint8Array([1, 2, 3]),
      }),
    },
  );

  const message = result.messages[0];
  if (message.role !== "user" || !Array.isArray(message.content)) {
    throw new Error("expected user message with content blocks");
  }

  assertEquals(message.content, [{
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: "AQID",
    },
  }]);
});

Deno.test("translateResponsesToMessagesResponse packs reasoning id into opaque-only redacted_thinking data", () => {
  const result = translateResponsesToMessagesResponse({
    id: "resp_123",
    object: "response",
    model: "gpt-test",
    output: [{
      type: "reasoning",
      id: "rs_1",
      summary: [],
      encrypted_content: "opaque_sig",
    }],
    output_text: "",
    status: "completed",
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
    },
  });

  assertEquals(result.content, [{
    type: "redacted_thinking",
    data: "opaque_sig@rs_1",
  }]);
});

Deno.test("translateResponsesToMessagesResponse drops reasoning with neither summary nor encrypted_content", () => {
  const result = translateResponsesToMessagesResponse({
    id: "resp_drop",
    object: "response",
    model: "gpt-test",
    output: [
      { type: "reasoning", id: "rs_empty", summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
      },
    ],
    output_text: "hello",
    status: "completed",
    usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
  });

  assertEquals(result.content, [{ type: "text", text: "hello" }]);
});

Deno.test("translateResponsesToMessagesResponse drops reasoning with explicit undefined encrypted_content", () => {
  const result = translateResponsesToMessagesResponse({
    id: "resp_undef",
    object: "response",
    model: "gpt-test",
    output: [{
      type: "reasoning",
      id: "rs_undef",
      summary: [],
      encrypted_content: undefined,
    }],
    output_text: "",
    status: "completed",
    usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
  });

  assertEquals(result.content, []);
});

Deno.test("translateResponsesToMessagesResponse treats whitespace-only summary as opaque-only reasoning and packs id", () => {
  const result = translateResponsesToMessagesResponse({
    id: "resp_ws",
    object: "response",
    model: "gpt-test",
    output: [{
      type: "reasoning",
      id: "rs_ws",
      summary: [{ type: "summary_text", text: "   \n  " }],
      encrypted_content: "opaque_sig",
    }],
    output_text: "",
    status: "completed",
    usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
  });

  assertEquals(result.content, [{
    type: "redacted_thinking",
    data: "opaque_sig@rs_ws",
  }]);
});

Deno.test("translateResponsesToMessages drops opaque-only reasoning input with explicit undefined encrypted_content", async () => {
  const result = await translateResponsesToMessages({
    model: "gpt-test",
    input: [
      { type: "message", role: "user", content: "hi" },
      {
        type: "reasoning",
        id: "rs_undef",
        summary: [],
        encrypted_content: undefined,
      },
      { type: "message", role: "user", content: "follow up" },
    ],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  // The undefined-encrypted_content reasoning item is dropped, so the two
  // adjacent user messages remain side-by-side without an injected assistant
  // turn. The last user message's content carries the ephemeral cache
  // breakpoint we inject for prompt caching; ignore that here and compare
  // text content only.
  const collectText = (content: MessagesMessage["content"]): string =>
    typeof content === "string"
      ? content
      : content.map((b) => "text" in b ? b.text : "").join("");
  assertEquals(
    result.messages.map((m) => ({ role: m.role, text: collectText(m.content) })),
    [
      { role: "user", text: "hi" },
      { role: "user", text: "follow up" },
    ],
  );
});

Deno.test("translateResponsesToMessages emits the system as a block array with an ephemeral cache breakpoint", async () => {
  // Anthropic requires explicit cache_control to opt into prompt caching;
  // codex (Responses wire) never sends one, so we inject on the way out. The
  // system block is the most stable prefix and the easiest place to attach.
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: "you are helpful",
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  assertEquals(result.system, [{
    type: "text",
    text: "you are helpful",
    cache_control: { type: "ephemeral" },
  }]);
});

Deno.test("translateResponsesToMessages omits system entirely when instructions and system messages are empty", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  assertFalse("system" in result);
});

Deno.test("translateResponsesToMessages attaches an ephemeral cache breakpoint to the last tool definition", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: [
      {
        type: "function",
        name: "first",
        description: "first tool",
        parameters: { type: "object" },
        strict: true,
      },
      {
        type: "function",
        name: "second",
        description: "second tool",
        parameters: { type: "object" },
        strict: true,
      },
    ],
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  // Only the last tool gets the breakpoint — earlier tools share the cached
  // prefix that ends at the last entry.
  assertEquals(result.tools?.[0], {
    name: "first",
    description: "first tool",
    input_schema: { type: "object" },
    strict: true,
  });
  assertEquals(result.tools?.[1], {
    name: "second",
    description: "second tool",
    input_schema: { type: "object" },
    strict: true,
    cache_control: { type: "ephemeral" },
  });
});

Deno.test("translateResponsesToMessages attaches an ephemeral cache breakpoint to the last block of the last user message", async () => {
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [
      { type: "message", role: "user", content: "earlier turn" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "ack" }],
      },
      { type: "message", role: "user", content: "latest turn" },
    ],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  const last = result.messages[result.messages.length - 1];
  if (last.role !== "user" || !Array.isArray(last.content)) {
    throw new Error("expected last user message with content blocks");
  }
  // String-content user message is converted to a single text block carrying
  // the breakpoint, so cache_control can attach (Anthropic requires it on a
  // block, not on a message).
  assertEquals(last.content, [{
    type: "text",
    text: "latest turn",
    cache_control: { type: "ephemeral" },
  }]);

  // Earlier user message remains plain string — only the last message owns
  // the conversation-history breakpoint.
  assertEquals(result.messages[0], {
    role: "user",
    content: "earlier turn",
  });
});

Deno.test("translateResponsesToMessages attaches an ephemeral cache breakpoint to a tool_result block when that's the last user content", async () => {
  // Mid-conversation requests from codex end on a function_call_output,
  // which the translator appends as a tool_result block on a user message.
  // The breakpoint should land on that tool_result so the cache prefix
  // covers the latest tool exchange.
  const result = await translateResponsesToMessages({
    model: "claude-test",
    input: [
      { type: "message", role: "user", content: "do thing" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "noop",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "done",
        status: "completed",
      },
    ],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  const last = result.messages[result.messages.length - 1];
  if (last.role !== "user" || !Array.isArray(last.content)) {
    throw new Error("expected last user message with content blocks");
  }
  assertEquals(last.content[last.content.length - 1], {
    type: "tool_result",
    tool_use_id: "call_1",
    content: "done",
    is_error: undefined,
    cache_control: { type: "ephemeral" },
  });
});
