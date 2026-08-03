import type { GatewayCtx } from '../../shared/gateway-ctx.ts';
import { telemetryModelIdentity, upstreamPerformanceContext } from '../../shared/telemetry/attribution.ts';
import type { ProtocolFrame } from '@floway-dev/protocols/common';
import { eventResult, providerModelOf } from '@floway-dev/provider';
import type { ApiErrorResult, EventResult, EventResultMetadata, ExecuteResult, InternalErrorResult, ModelCandidate } from '@floway-dev/provider';

export const PREFILL_KEEPALIVE_TIMEOUT_MS = 60_000;

export interface PrefillKeepAliveFailure {
  readonly message: string;
  readonly openAIType: string;
  readonly openAICode: string | null;
  readonly openAIParam: string | null;
  readonly anthropicType: string;
  readonly responsesCode: string;
}

type PrefillKeepAliveEventResult<T> = EventResult<T> & {
  readonly prefillKeepAliveDeferred: true;
};

interface MaybeDeferPrefillKeepAliveArgs<TEvent> {
  readonly enabled: boolean;
  readonly ctx: GatewayCtx;
  readonly candidate: ModelCandidate;
  readonly attempt: Promise<ExecuteResult<ProtocolFrame<TEvent>>>;
  readonly failureFrames: (failure: PrefillKeepAliveFailure) => Iterable<ProtocolFrame<TEvent>>;
}

type SettleWithinResult<T> = { readonly settled: true; readonly value: T } | { readonly settled: false };

export const isPrefillKeepAliveDeferred = <T>(result: ExecuteResult<T>): result is PrefillKeepAliveEventResult<T> =>
  result.type === 'events' && (result as { readonly prefillKeepAliveDeferred?: unknown }).prefillKeepAliveDeferred === true;

export const maybeDeferPrefillKeepAlive = async <TEvent>({
  enabled,
  ctx,
  candidate,
  attempt,
  failureFrames,
}: MaybeDeferPrefillKeepAliveArgs<TEvent>): Promise<ExecuteResult<ProtocolFrame<TEvent>>> => {
  const providerModel = providerModelOf(candidate);
  if (!enabled || !ctx.wantsStream || !providerModel.enabledFlags.has('stream-prefill-keepalive')) {
    return await attempt;
  }

  const settled = await settleWithin(attempt, PREFILL_KEEPALIVE_TIMEOUT_MS);
  if (settled.settled) return settled.value;

  const provisionalMetadata: EventResultMetadata = {
    modelIdentity: telemetryModelIdentity(candidate, providerModel.id),
    performance: upstreamPerformanceContext(ctx, candidate, 'chat'),
  };
  return Object.assign(
    eventResult(
      deferredProtocolFrames(attempt, failureFrames),
      provisionalMetadata.modelIdentity,
      {
        performance: provisionalMetadata.performance,
        finalMetadata: finalMetadataFromPending(attempt, provisionalMetadata),
      },
    ),
    { prefillKeepAliveDeferred: true as const },
  );
};

const settleWithin = async <T>(promise: Promise<T>, timeoutMs: number): Promise<SettleWithinResult<T>> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<SettleWithinResult<T>>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        resolve({ settled: false });
      }, timeoutMs);
      promise.then(
        value => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          timeoutId = undefined;
          resolve({ settled: true, value });
        },
        error => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          timeoutId = undefined;
          reject(error);
        },
      );
    });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

const deferredProtocolFrames = async function* <TEvent>(
  pending: Promise<ExecuteResult<ProtocolFrame<TEvent>>>,
  failureFrames: (failure: PrefillKeepAliveFailure) => Iterable<ProtocolFrame<TEvent>>,
): AsyncIterable<ProtocolFrame<TEvent>> {
  let result: ExecuteResult<ProtocolFrame<TEvent>>;
  try {
    result = await pending;
  } catch (error) {
    yield* failureFrames(failureFromUnknown(error));
    return;
  }

  if (result.type === 'events') {
    yield* result.events;
    return;
  }

  yield* failureFrames(failureFromExecuteResult(result));
};

const finalMetadataFromPending = async <TEvent>(
  pending: Promise<ExecuteResult<ProtocolFrame<TEvent>>>,
  fallback: EventResultMetadata,
): Promise<EventResultMetadata> => {
  try {
    const result = await pending;
    if (result.type === 'events') {
      return await (result.finalMetadata ?? {
        modelIdentity: result.modelIdentity,
        ...(result.performance ? { performance: result.performance } : {}),
      });
    }
    if (result.performance) return { modelIdentity: fallback.modelIdentity, performance: result.performance };
    return fallback;
  } catch {
    return fallback;
  }
};

const failureFromExecuteResult = (result: ApiErrorResult | InternalErrorResult): PrefillKeepAliveFailure => {
  if (result.type === 'api-error') return failureFromApiError(result);
  return {
    message: result.error.message,
    openAIType: 'server_error',
    openAICode: null,
    openAIParam: null,
    anthropicType: 'api_error',
    responsesCode: 'server_error',
  };
};

const failureFromUnknown = (error: unknown): PrefillKeepAliveFailure => ({
  message: error instanceof Error ? error.message : String(error),
  openAIType: 'server_error',
  openAICode: null,
  openAIParam: null,
  anthropicType: 'api_error',
  responsesCode: 'server_error',
});

const failureFromApiError = (error: ApiErrorResult): PrefillKeepAliveFailure => {
  const body = new TextDecoder().decode(error.body).trim();
  const parsed = parseApiErrorBody(body);
  const defaults = defaultFailureForStatus(error.status, body);
  return {
    message: parsed.message ?? defaults.message,
    openAIType: parsed.openAIType ?? defaults.openAIType,
    openAICode: parsed.openAICode ?? defaults.openAICode,
    openAIParam: parsed.openAIParam ?? null,
    anthropicType: parsed.anthropicType ?? defaults.anthropicType,
    responsesCode: parsed.responsesCode ?? defaults.responsesCode,
  };
};

interface ParsedApiErrorBody {
  readonly message?: string;
  readonly openAIType?: string;
  readonly openAICode?: string | null;
  readonly openAIParam?: string | null;
  readonly anthropicType?: string;
  readonly responsesCode?: string;
}

const parseApiErrorBody = (body: string): ParsedApiErrorBody => {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isObjectLike(parsed)) return { message: truncate(body) };
    const error = isObjectLike(parsed.error) ? parsed.error : null;
    if (!error) return { message: stringField(parsed, 'message') ?? truncate(body) };
    const message = stringField(error, 'message') ?? truncate(JSON.stringify(error));
    const type = stringField(error, 'type');
    const code = stringField(error, 'code');
    const param = stringField(error, 'param');
    return {
      message,
      ...(type ? { openAIType: type, anthropicType: type } : {}),
      ...(code ? { openAICode: code, responsesCode: code } : {}),
      ...(param ? { openAIParam: param } : {}),
      ...(!code && type ? { responsesCode: type } : {}),
    };
  } catch {
    return { message: truncate(body) };
  }
};

const defaultFailureForStatus = (status: number, body: string): PrefillKeepAliveFailure => {
  if (status === 408 || status === 504) {
    return {
      message: 'upstream timeout during prefill',
      openAIType: 'server_error',
      openAICode: 'upstream_timeout',
      openAIParam: null,
      anthropicType: 'api_error',
      responsesCode: 'server_error',
    };
  }
  const serverSide = status >= 500;
  return {
    message: body ? truncate(body) : `Upstream returned HTTP ${status}`,
    openAIType: serverSide ? 'server_error' : 'invalid_request_error',
    openAICode: null,
    openAIParam: null,
    anthropicType: 'api_error',
    responsesCode: serverSide ? 'server_error' : 'invalid_request_error',
  };
};

const isObjectLike = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const stringField = (value: Record<string, unknown>, key: string): string | undefined => {
  const field = value[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
};

const truncate = (value: string): string => value.length > 2048 ? `${value.slice(0, 2048)}...` : value;
