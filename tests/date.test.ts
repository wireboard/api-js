import { describe, expect, it } from 'vitest';
import { toDateString } from '../src/date.js';

describe('toDateString', () => {
  it('accepts a YYYY-MM-DD string', () => {
    expect(toDateString('2026-05-22')).toBe('2026-05-22');
  });

  it('rejects malformed strings', () => {
    expect(() => toDateString('2026-5-22')).toThrow(TypeError);
    expect(() => toDateString('22/05/2026')).toThrow(TypeError);
    expect(() => toDateString('')).toThrow(TypeError);
  });

  it('converts a Date to UTC YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2026, 4, 22, 13, 26, 27));
    expect(toDateString(d)).toBe('2026-05-22');
  });

  it('uses UTC, not local — a high-hour Date can land on the next UTC day', () => {
    const d = new Date('2026-05-22T23:30:00-05:00'); // == 2026-05-23 04:30 UTC
    expect(toDateString(d)).toBe('2026-05-23');
  });

  it('rejects invalid Date', () => {
    expect(() => toDateString(new Date('not a date'))).toThrow(TypeError);
  });

  it('rejects non-string non-Date input', () => {
    expect(() => toDateString(42 as unknown as string)).toThrow(TypeError);
    expect(() => toDateString(null as unknown as string)).toThrow(TypeError);
  });
});
