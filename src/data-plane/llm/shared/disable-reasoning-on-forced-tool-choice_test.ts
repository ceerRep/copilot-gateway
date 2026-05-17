// One flag (`disable-reasoning-on-forced-tool-choice`) drives three
// per-target interceptors. Vendor-style flags on the upstream
// (`vendor-deepseek` / `vendor-qwen`) add vendor-specific
// explicit-disable signals on top of the OpenAI strip; with no vendor
// flag, behavior is OpenAI standard (strip only).

import { assertEquals } from "@std/assert";
import type { ChatCompletionsPayload } from "../../../lib/chat-completions-types.ts";
import type { MessagesPayload } from "../../../lib/messages-types.ts";
import type { ResponsesPayload } from "../../../lib/responses-types.ts";
import { eventResult } from "./errors/result.ts";
import type { EmitInput } from "../targets/emit-types.ts";
import type { EmitToChatCompletionsInput } from "../targets/chat-completions/emit.ts";
import type { EmitToMessagesInput } from "../targets/messages/emit.ts";
import { withReasoningDisabledOnForcedToolChoice as messagesFix } from "../targets/messages/interceptors/disable-reasoning-on-forced-tool-choice.ts";
import { withReasoningDisabledOnForcedToolChoice as responsesFix } from "../targets/responses/interceptors/disable-reasoning-on-forced-tool-choice.ts";
import { withReasoningDisabledOnForcedToolChoice as chatFix } from "../targets/chat-completions/interceptors/disable-reasoning-on-forced-tool-choice.ts";

const upstreamWith = (enabledFixes: ReadonlySet<string>) => ({
  id: "u",
  name: "U",
  kind: "openai" as const,
  supportedEndpoints: [],
  enabledFixes,
  fetch: () => Promise.resolve(new Response()),
});

const noVendor = new Set<string>();

const okEvents = () =>
  Promise.resolve(eventResult((async function* () {})()));

// ── Messages: vendor flags don't apply; always thinking: disabled ──
Deno.test("messages: forced tool_choice → thinking disabled, output_config stripped", async () => {
  const payload: MessagesPayload = {
    model: "m",
    messages: [],
    max_tokens: 1,
    thinking: { type: "enabled", budget_tokens: 1024 },
    output_config: { effort: "high" },
    tool_choice: { type: "tool", name: "x" },
  };
  const input: EmitToMessagesInput = {
    sourceApi: "messages",
    payload,
    upstream: upstreamWith(noVendor),
  };
  await messagesFix(input, okEvents);
  assertEquals(input.payload.thinking, { type: "disabled" });
  assertEquals(input.payload.output_config, undefined);
});

Deno.test("messages: tool_choice auto leaves payload untouched", async () => {
  const payload: MessagesPayload = {
    model: "m",
    messages: [],
    max_tokens: 1,
    thinking: { type: "enabled", budget_tokens: 1024 },
    tool_choice: { type: "auto" },
  };
  const input: EmitToMessagesInput = {
    sourceApi: "messages",
    payload,
    upstream: upstreamWith(noVendor),
  };
  await messagesFix(input, okEvents);
  assertEquals(input.payload.thinking, {
    type: "enabled",
    budget_tokens: 1024,
  });
});

// ── Responses: vendor flags dispatch on top of strip ──
Deno.test("responses: no vendor flag → strip reasoning only", async () => {
  const payload: ResponsesPayload = {
    model: "m",
    input: "hi",
    reasoning: { effort: "high" },
    tool_choice: "required",
  };
  const input: EmitInput<ResponsesPayload> = {
    sourceApi: "responses",
    payload,
    upstream: upstreamWith(noVendor),
  };
  await responsesFix(input, okEvents);
  assertEquals(input.payload.reasoning, undefined);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, undefined);
  assertEquals(out.enable_thinking, undefined);
});

Deno.test("responses: vendor-deepseek → strip + thinking disabled", async () => {
  const payload: ResponsesPayload = {
    model: "m",
    input: "hi",
    reasoning: { effort: "high" },
    tool_choice: "required",
  };
  const input: EmitInput<ResponsesPayload> = {
    sourceApi: "responses",
    payload,
    upstream: upstreamWith(new Set(["vendor-deepseek"])),
  };
  await responsesFix(input, okEvents);
  assertEquals(input.payload.reasoning, undefined);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, { type: "disabled" });
});

Deno.test("responses: vendor-qwen → strip + enable_thinking: false", async () => {
  const payload: ResponsesPayload = {
    model: "m",
    input: "hi",
    reasoning: { effort: "high" },
    tool_choice: "required",
  };
  const input: EmitInput<ResponsesPayload> = {
    sourceApi: "responses",
    payload,
    upstream: upstreamWith(new Set(["vendor-qwen"])),
  };
  await responsesFix(input, okEvents);
  assertEquals(input.payload.reasoning, undefined);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.enable_thinking, false);
});

Deno.test("responses: vendor-deepseek + vendor-qwen → both fields stack", async () => {
  const payload: ResponsesPayload = {
    model: "m",
    input: "hi",
    reasoning: { effort: "high" },
    tool_choice: "required",
  };
  const input: EmitInput<ResponsesPayload> = {
    sourceApi: "responses",
    payload,
    upstream: upstreamWith(new Set(["vendor-deepseek", "vendor-qwen"])),
  };
  await responsesFix(input, okEvents);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, { type: "disabled" });
  assertEquals(out.enable_thinking, false);
});

Deno.test("responses: tool_choice 'auto' leaves payload untouched", async () => {
  const payload: ResponsesPayload = {
    model: "m",
    input: "hi",
    reasoning: { effort: "high" },
    tool_choice: "auto",
  };
  const input: EmitInput<ResponsesPayload> = {
    sourceApi: "responses",
    payload,
    upstream: upstreamWith(new Set(["vendor-deepseek"])),
  };
  await responsesFix(input, okEvents);
  assertEquals(input.payload.reasoning, { effort: "high" });
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, undefined);
});

// ── Chat Completions: same vendor dispatch as Responses ──
Deno.test("chat-completions: no vendor flag → strip reasoning_effort only", async () => {
  const payload: ChatCompletionsPayload = {
    model: "m",
    messages: [],
    reasoning_effort: "high",
    tool_choice: "required",
  };
  const input: EmitToChatCompletionsInput = {
    sourceApi: "chat-completions",
    payload,
    upstream: upstreamWith(noVendor),
  };
  await chatFix(input, okEvents);
  assertEquals(input.payload.reasoning_effort, undefined);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, undefined);
  assertEquals(out.enable_thinking, undefined);
});

Deno.test("chat-completions: vendor-deepseek → strip + thinking disabled", async () => {
  const payload: ChatCompletionsPayload = {
    model: "m",
    messages: [],
    reasoning_effort: "high",
    tool_choice: { type: "function", function: { name: "x" } },
  };
  const input: EmitToChatCompletionsInput = {
    sourceApi: "chat-completions",
    payload,
    upstream: upstreamWith(new Set(["vendor-deepseek"])),
  };
  await chatFix(input, okEvents);
  assertEquals(input.payload.reasoning_effort, undefined);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, { type: "disabled" });
});

Deno.test("chat-completions: vendor-qwen → strip + enable_thinking: false", async () => {
  const payload: ChatCompletionsPayload = {
    model: "m",
    messages: [],
    reasoning_effort: "high",
    tool_choice: "required",
  };
  const input: EmitToChatCompletionsInput = {
    sourceApi: "chat-completions",
    payload,
    upstream: upstreamWith(new Set(["vendor-qwen"])),
  };
  await chatFix(input, okEvents);
  assertEquals(input.payload.reasoning_effort, undefined);
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.enable_thinking, false);
});

Deno.test("chat-completions: tool_choice 'auto' leaves payload untouched", async () => {
  const payload: ChatCompletionsPayload = {
    model: "m",
    messages: [],
    reasoning_effort: "high",
    tool_choice: "auto",
  };
  const input: EmitToChatCompletionsInput = {
    sourceApi: "chat-completions",
    payload,
    upstream: upstreamWith(new Set(["vendor-deepseek"])),
  };
  await chatFix(input, okEvents);
  assertEquals(input.payload.reasoning_effort, "high");
  const out = input.payload as unknown as Record<string, unknown>;
  assertEquals(out.thinking, undefined);
});
