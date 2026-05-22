import EventSource from 'eventsource';
import { registerEventSource } from './live/eventsource.js';

registerEventSource(EventSource as unknown as new (url: string) => globalThis.EventSource);

export * from './public.js';
