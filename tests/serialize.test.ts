import { describe, expect, it } from 'vitest';
import { serializeParams } from '../src/serialize.js';

describe('serializeParams', () => {
  it('serialises scalar fields', () => {
    const out = serializeParams({ site_id: 'xK4mP2nT', limit: 50 });
    expect(out).toBe('site_id=xK4mP2nT&limit=50');
  });

  it('normalises Date in from/to to YYYY-MM-DD', () => {
    const out = serializeParams({
      site_id: 'xK4mP2nT',
      from: new Date(Date.UTC(2026, 4, 1)),
      to: '2026-05-22',
    });
    expect(out).toContain('from=2026-05-01');
    expect(out).toContain('to=2026-05-22');
  });

  it('serialises arrays as comma-separated', () => {
    const out = serializeParams({ group_by: ['category', 'utm_source'] });
    expect(out).toBe('group_by=category%2Cutm_source');
  });

  it('serialises event filter columns as filter[<key>]', () => {
    const out = serializeParams({
      filter: { category: 'Purchase', utm_source: 'newsletter' },
    });
    expect(decodeURIComponent(out)).toContain('filter[category]=Purchase');
    expect(decodeURIComponent(out)).toContain('filter[utm_source]=newsletter');
  });

  it('serialises event prop filters as filter[props.<key>]', () => {
    const out = serializeParams({
      filter: { props: { plan: 'pro', tier: 'gold' } },
    });
    expect(decodeURIComponent(out)).toContain('filter[props.plan]=pro');
    expect(decodeURIComponent(out)).toContain('filter[props.tier]=gold');
  });

  it('skips undefined and null', () => {
    const out = serializeParams({ a: 'x', b: undefined, c: null, d: 1 });
    expect(out).toBe('a=x&d=1');
  });

  it('encodes special characters in values', () => {
    const out = serializeParams({ filter: { category: 'a&b=c' } });
    expect(decodeURIComponent(out)).toContain('filter[category]=a&b=c');
  });
});
