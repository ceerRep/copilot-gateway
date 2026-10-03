import { expect, test, vi } from 'vitest';

import { fetchUpstreamModels, ProviderModelsUnavailableError } from '../src/models-fetch.ts';

test('model-list failure parses JSON for display without changing the captured upstream response', () => {
  const body = '{"error":{"message":"token expired"}}';
  const failure = new ProviderModelsUnavailableError({
    status: 401,
    headers: new Headers({ 'content-type': 'application/json', 'retry-after': '5' }),
    body,
  });

  expect(failure.displayResponse).toEqual({
    status: 401,
    headers: [['content-type', 'application/json'], ['retry-after', '5']],
    body: JSON.stringify({ error: { message: 'token expired' } }, null, 2),
  });
  expect(failure.httpResponse?.body).toBe(body);
});

test('model-list failure shortens a long body only in its display projection', () => {
  const body = 'x'.repeat(20_000);
  const failure = new ProviderModelsUnavailableError({ status: 503, headers: new Headers(), body });

  expect(failure.displayResponse?.body).toBe(`${body.slice(0, 12_288)}…`);
  expect(failure.httpResponse?.body).toBe(body);
});

test('model listing total timeout wins even when the fetcher ignores cancellation', async () => {
  vi.useFakeTimers();
  try {
    const stalled = fetchUpstreamModels(
      () => new Promise<Response>(() => {}),
      value => value,
      { totalTimeoutMs: 40 },
    );
    const assertion = expect(stalled).rejects.toMatchObject({
      name: 'ProviderModelsUnavailableError',
      cause: expect.objectContaining({ name: 'TimeoutError' }),
    });
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

test('model listing aborts a stalled response body after its idle timeout', async () => {
  vi.useFakeTimers();
  try {
    let cancelReason: unknown;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
      },
      pull() {
        return new Promise<void>(() => {});
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const stalled = fetchUpstreamModels(
      () => Promise.resolve(new Response(body)),
      value => value,
      { idleTimeoutMs: 25, totalTimeoutMs: 1_000 },
    );
    const assertion = expect(stalled).rejects.toMatchObject({
      name: 'ProviderModelsUnavailableError',
      cause: expect.objectContaining({ name: 'TimeoutError' }),
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(cancelReason).toMatchObject({ name: 'TimeoutError' });
  } finally {
    vi.useRealTimers();
  }
});
