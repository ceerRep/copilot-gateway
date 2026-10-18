// Node v24 exposes Event, MessageEvent, and CloseEvent but not ErrorEvent.
// @hono/node-server@2.0.4 constructs ErrorEvent when its ws adapter observes a
// socket error, so install the missing DOM constructor before registering the
// WebSocket upgrade handler.
// https://github.com/honojs/node-server/blob/v2.0.4/src/index.ts

interface ErrorEventInit extends EventInit {
  error?: unknown;
  message?: string;
}

export const installErrorEvent = (): void => {
  if (typeof globalThis.ErrorEvent === 'function') return;

  class NodeErrorEvent extends Event {
    readonly error: unknown;
    readonly message: string;

    constructor(type: string, init: ErrorEventInit = {}) {
      super(type, init);
      this.error = init.error;
      this.message = init.message ?? '';
    }
  }

  Object.defineProperty(globalThis, 'ErrorEvent', {
    configurable: true,
    writable: true,
    value: NodeErrorEvent,
  });
};
