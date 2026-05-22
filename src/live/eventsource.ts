type EventSourceCtor = new (url: string) => EventSource;

let registered: EventSourceCtor | null = null;

export function registerEventSource(ctor: EventSourceCtor): void {
  registered = ctor;
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
