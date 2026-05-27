import EventSource from 'eventsource';
import { registerEventSource } from './live/eventsource.js';

// The npm `eventsource` package accepts `{ headers: {...} }` in init,
// so the SDK can send the live JWT as an `Authorization` header
// instead of putting it in the URL (where it would land in access
// logs, error reporters, and request-tracing tools).
registerEventSource(
  EventSource as unknown as new (url: string) => globalThis.EventSource,
  { supportsHeaders: true },
);

export * from './public.js';
