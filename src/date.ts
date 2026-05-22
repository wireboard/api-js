import type { DateInput } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toDateString(d: DateInput): string {
  if (typeof d === 'string') {
    if (!DATE_RE.test(d)) {
      throw new TypeError(`Invalid date string: "${d}". Expected YYYY-MM-DD.`);
    }
    return d;
  }
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) {
      throw new TypeError('Invalid Date passed as date input.');
    }
    return d.toISOString().slice(0, 10);
  }
  throw new TypeError(`Invalid date input: ${String(d)}`);
}
