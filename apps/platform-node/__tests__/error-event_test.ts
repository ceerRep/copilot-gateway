import { afterEach, describe, expect, it } from 'vitest';

import { installErrorEvent } from '../src/error-event.ts';

const originalErrorEvent = globalThis.ErrorEvent;

afterEach(() => {
  if (originalErrorEvent === undefined) delete (globalThis as { ErrorEvent?: unknown }).ErrorEvent;
  else globalThis.ErrorEvent = originalErrorEvent;
});

describe('installErrorEvent', () => {
  it('installs the DOM ErrorEvent fields missing from Node', () => {
    delete (globalThis as { ErrorEvent?: unknown }).ErrorEvent;

    installErrorEvent();

    const cause = new Error('socket reset');
    const event = new ErrorEvent('error', { error: cause, message: cause.message, cancelable: true });
    expect(event).toBeInstanceOf(Event);
    expect(event.type).toBe('error');
    expect(event.error).toBe(cause);
    expect(event.message).toBe('socket reset');
    expect(event.cancelable).toBe(true);
  });

  it('does not replace a runtime-provided ErrorEvent', () => {
    class RuntimeErrorEvent extends Event {}
    globalThis.ErrorEvent = RuntimeErrorEvent as unknown as typeof ErrorEvent;

    installErrorEvent();

    expect(globalThis.ErrorEvent).toBe(RuntimeErrorEvent);
  });
});
