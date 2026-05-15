import type { BackgroundScheduler } from "../../../lib/background.ts";
import type { ExecuteResult } from "../shared/errors/result.ts";
import type { ProtocolFrame, StreamFrame } from "../shared/stream/types.ts";
import type { SourceApi } from "../shared/types/source-api.ts";
import type {
  Upstream,
  UpstreamFetchOptions,
} from "../../../lib/upstream/types.ts";

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
