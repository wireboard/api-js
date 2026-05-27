/**
 * Init object accepted by the EventSource constructor. Includes the
 * optional `headers` property that Node's `eventsource` npm package
 * accepts (but the W3C-spec browser EventSource does not). Cast at the
 * call site when the constructor is known to ignore the extra field.
 */
export interface EventSourceInitLike {
  withCredentials?: boolean;
  headers?: Record<string, string>;
}

type EventSourceCtor = new (url: string, init?: EventSourceInitLike) => EventSource;

export interface RegisterOptions {
  /**
   * Whether the registered EventSource constructor accepts an init object
   * with a `headers` property. Node's `eventsource` npm package does;
   * the browser's native EventSource does NOT (W3C-spec limitation).
   *
   * When `true`, the SDK passes the Live JWT as an
   * `Authorization: Bearer <token>` header so it stays out of the URL
   * (and out of access logs, error reporters, request-tracing tools).
   * When `false`, the SDK falls back to `?authorization=<token>` as a
   * query parameter — the only option for W3C-spec EventSource.
   *
   * Default: `false` (most conservative — assumes a spec-compliant
   * EventSource that ignores `headers`).
   */
  supportsHeaders?: boolean;
}

let registered: EventSourceCtor | null = null;
let registeredSupportsHeaders = false;

export function registerEventSource(
  ctor: EventSourceCtor,
  opts?: RegisterOptions,
): void {
  registered = ctor;
  registeredSupportsHeaders = opts?.supportsHeaders ?? false;
}

export function getEventSource(): EventSourceCtor {
  if (registered) return registered;
  const g = globalThis as { EventSource?: unknown };
  if (typeof g.EventSource === 'function') {
    return g.EventSource as EventSourceCtor;
  }
  throw new Error(
    'No EventSource implementation available. In Node, ensure @wireboard/api is imported via its Node entry; in the browser, use a runtime that provides EventSource.',
  );
}

/**
 * Whether the currently-active EventSource constructor accepts headers
 * in its init. Returns `false` when no constructor has been registered
 * (i.e. the browser fallback to `globalThis.EventSource`, which by the
 * W3C spec doesn't support headers).
 */
export function eventSourceSupportsHeaders(): boolean {
  return registered !== null && registeredSupportsHeaders;
}
