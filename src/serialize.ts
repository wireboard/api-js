import { toDateString } from './date.js';
import type { DateInput, EventFilter } from './types.js';

const DATE_KEYS = new Set(['from', 'to']);

/**
 * Serialise a request params object to a URL query string. Handles:
 * - `from` / `to` date-or-string normalisation,
 * - array params (comma-joined),
 * - the `filter` event-filter shape (`filter[<col>]=...` and `filter[props.<key>]=...`),
 * - skipping undefined/null values.
 */
export function serializeParams(params: object): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (key === 'filter' && typeof value === 'object' && !Array.isArray(value)) {
      serializeEventFilter(value as EventFilter, out);
      continue;
    }

    if (DATE_KEYS.has(key)) {
      out.set(key, toDateString(value as DateInput));
      continue;
    }

    if (Array.isArray(value)) {
      out.set(key, value.join(','));
      continue;
    }

    out.set(key, String(value));
  }
  return out.toString();
}

function serializeEventFilter(filter: EventFilter, out: URLSearchParams): void {
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null) continue;
    if (k === 'props' && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v as Record<string, string>)) {
        if (pv === undefined || pv === null) continue;
        out.set(`filter[props.${pk}]`, String(pv));
      }
      continue;
    }
    out.set(`filter[${k}]`, String(v));
  }
}
