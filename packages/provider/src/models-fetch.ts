export interface ProviderModelsFailureResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

const MAX_FAILURE_BODY_LENGTH = 12_288;

const displayFailureBody = (body: string): string => {
  let display = body;
  try {
    display = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // A non-JSON upstream error body is displayed as text.
  }
  return display.length > MAX_FAILURE_BODY_LENGTH
    ? `${display.slice(0, MAX_FAILURE_BODY_LENGTH)}…`
    : display;
};

export class ProviderModelsUnavailableError extends Error {
  readonly displayResponse: ProviderModelsFailureResponse | null;

  constructor(
    readonly httpResponse: { status: number; headers: Headers; body: string } | null,
    cause?: unknown,
    displayResponse?: ProviderModelsFailureResponse | null,
  ) {
    super('Provider model listing failed', cause !== undefined ? { cause } : undefined);
    this.name = 'ProviderModelsUnavailableError';
    this.displayResponse = displayResponse ?? (httpResponse === null ? null : {
      status: httpResponse.status,
      headers: [...httpResponse.headers],
      body: displayFailureBody(httpResponse.body),
    });
  }
}

export const PROVIDER_MODELS_TOTAL_TIMEOUT_MS = 30_000;
export const PROVIDER_MODELS_IDLE_TIMEOUT_MS = 10_000;

interface ProviderModelsFetchOptions {
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
}

const positiveTimeout = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
};

const timeoutError = (scope: 'idle' | 'total', timeoutMs: number): DOMException =>
  new DOMException(`Provider model listing ${scope} timeout after ${timeoutMs}ms`, 'TimeoutError');

const raceWithSignal = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

const runWithTotalTimeout = async <T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number | undefined,
): Promise<T> => {
  const controller = new AbortController();
  if (timeoutMs === undefined) return await task(controller.signal);
  const timer = setTimeout(() => controller.abort(timeoutError('total', timeoutMs)), timeoutMs);
  try {
    return await raceWithSignal(Promise.resolve().then(() => task(controller.signal)), controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const readWithIdleTimeout = async <T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
): Promise<T> => {
  if (signal.aborted) {
    void reader.cancel(signal.reason).catch(() => undefined);
    throw signal.reason;
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
      finish(() => reject(signal.reason));
    };
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      const error = timeoutError('idle', timeoutMs);
      void reader.cancel(error).catch(() => undefined);
      finish(() => reject(error));
    }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
};

const releaseReader = (reader: ReadableStreamDefaultReader<Uint8Array>): void => {
  try {
    reader.releaseLock();
  } catch {
    // A source may retain its pending read after cancellation; the timeout still wins.
  }
};

const readResponseText = async (
  response: Response,
  signal: AbortSignal,
  idleTimeoutMs: number | undefined,
): Promise<string> => {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout(reader, reader.read(), signal, idleTimeoutMs);
      if (done) return new TextDecoder().decode(concatBytes(chunks));
      chunks.push(value);
    }
  } finally {
    releaseReader(reader);
  }
};

const concatBytes = (chunks: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

// Reconstruct a Response from the captured upstream HTTP frame, or null
// when none was captured (e.g. network errors or malformed bodies) — that
// null lets callers choose their own fallback shape.
export const httpResponseToResponse = (httpResponse: ProviderModelsUnavailableError['httpResponse']): Response | null => {
  if (!httpResponse) return null;
  return new Response(httpResponse.body, {
    status: httpResponse.status,
    headers: new Headers(httpResponse.headers),
  });
};

// Shared scaffold for "fetch the upstream's /models, decode JSON, validate
// shape" — error envelope identical across providers (network / JSON-parse
// / shape-invalid ⇒ ProviderModelsUnavailableError(null, cause); non-2xx
// ⇒ status+headers+body).
export const fetchUpstreamModels = async <T>(
  doFetch: (signal: AbortSignal) => Promise<Response>,
  parse: (json: unknown) => T | null,
  options: ProviderModelsFetchOptions = {},
): Promise<T> => {
  const totalTimeoutMs = options.totalTimeoutMs === undefined
    ? undefined
    : positiveTimeout(options.totalTimeoutMs, 'totalTimeoutMs');
  const idleTimeoutMs = options.idleTimeoutMs === undefined
    ? undefined
    : positiveTimeout(options.idleTimeoutMs, 'idleTimeoutMs');
  try {
    return await runWithTotalTimeout(async signal => {
      let response: Response;
      try {
        response = await doFetch(signal);
      } catch (cause) {
        if (signal.aborted) throw new ProviderModelsUnavailableError(null, signal.reason);
        throw new ProviderModelsUnavailableError(null, cause);
      }
      if (!response.ok) {
        let body = '';
        try {
          body = await readResponseText(response, signal, idleTimeoutMs);
        } catch (cause) {
          throw new ProviderModelsUnavailableError({ status: response.status, headers: new Headers(response.headers), body }, cause);
        }
        throw new ProviderModelsUnavailableError({
          status: response.status,
          headers: new Headers(response.headers),
          body,
        });
      }
      let parsed: unknown;
      try {
        const body = await readResponseText(response, signal, idleTimeoutMs);
        parsed = JSON.parse(body) as unknown;
      } catch (cause) {
        throw new ProviderModelsUnavailableError(null, cause);
      }
      const result = parse(parsed);
      if (result === null) {
        throw new ProviderModelsUnavailableError(null, new Error('Invalid /models response shape'));
      }
      return result;
    }, totalTimeoutMs);
  } catch (cause) {
    if (cause instanceof ProviderModelsUnavailableError) throw cause;
    throw new ProviderModelsUnavailableError(null, cause);
  }
};
