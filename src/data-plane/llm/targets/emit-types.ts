import type { BackgroundScheduler } from "../../../runtime/background.ts";
import type { ExecuteResult } from "../shared/errors/result.ts";
import type { ProtocolFrame, StreamFrame } from "../shared/stream/types.ts";
import type {
  Upstream,
  UpstreamFetchOptions,
} from "../../../shared/upstream/types.ts";

type SourceApi = "messages" | "responses" | "chat-completions" | "gemini";

export interface EmitInput<TPayload extends { model: string }> {
  sourceApi: SourceApi;
  payload: TPayload;
  upstream: Upstream;
  apiKeyId?: string;
  clientStream?: boolean;
  runtimeLocation?: string;
  scheduleBackground?: BackgroundScheduler;
  fetchOptions?: UpstreamFetchOptions;
  downstreamAbortSignal?: AbortSignal;
}

export type RawEmitResult<TJson> = ExecuteResult<StreamFrame<TJson>>;

export type EmitResult<TEvent> = ExecuteResult<ProtocolFrame<TEvent>>;
