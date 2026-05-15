import type { UpstreamFetchOptions } from "../../../../lib/upstream/types.ts";

export type MessagesPlan =
  | {
    source: "messages";
    target: "messages";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
    rawBeta?: string;
  }
  | {
    source: "messages";
    target: "responses";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "messages";
    target: "chat-completions";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  };

export type ResponsesPlan =
  | {
    source: "responses";
    target: "responses";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "responses";
    target: "messages";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "responses";
    target: "chat-completions";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  };

export type ChatPlan =
  | {
    source: "chat-completions";
    target: "messages";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "chat-completions";
    target: "responses";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "chat-completions";
    target: "chat-completions";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  };

export type GeminiPlan =
  | {
    source: "gemini";
    target: "messages";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "gemini";
    target: "responses";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  }
  | {
    source: "gemini";
    target: "chat-completions";
    wantsStream: boolean;
    fetchOptions: UpstreamFetchOptions;
  };
