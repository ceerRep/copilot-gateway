import type { ChatCompletionsPayload } from "../../../lib/chat-completions-types.ts";
import type { MessagesPayload } from "../../../lib/messages-types.ts";
import type { ResponsesPayload } from "../../../lib/responses-types.ts";

// Messages tool_choice: "tool" forces a specific tool; "any" forces some
// tool. "auto" and "none" do not.
export const messagesHasForcedToolChoice = (
  payload: MessagesPayload,
): boolean => {
  const t = payload.tool_choice?.type;
  return t === "tool" || t === "any";
};

// Responses tool_choice: "required" forces some tool; any object form
// (function / custom / hosted-tool) forces a specific tool.
export const responsesHasForcedToolChoice = (
  payload: ResponsesPayload,
): boolean => {
  const tc = payload.tool_choice;
  if (tc === undefined || tc === null) return false;
  if (typeof tc === "string") return tc === "required";
  return true;
};

// Chat Completions tool_choice: "required" forces some tool; the object
// form forces a specific function.
export const chatHasForcedToolChoice = (
  payload: ChatCompletionsPayload,
): boolean => {
  const tc = payload.tool_choice;
  if (tc === undefined || tc === null) return false;
  if (typeof tc === "string") return tc === "required";
  return true;
};
