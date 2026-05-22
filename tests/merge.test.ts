import { describe, expect, it } from 'vitest';
import { applyEvent, emptyState, fromSnapshot } from '../src/live/merge.js';
import type { LiveEnvelope, LiveStateSnapshot, ManagedLiveState } from '../src/types.js';

const SITE = 'xK4mP2nT';

function freshState(): ManagedLiveState {
  return emptyState(SITE);
}

describe('emptyState', () => {
  it('returns a fully-populated empty state', () => {
    const s = emptyState(SITE);
    expect(s.site_id).toBe(SITE);
    expect(s.live.visitors).toBeNull();
    expect(s.live.top_pages).toEqual([]);
    expect(s.live.active_sessions).toEqual([]);
    expect(s.live.events).toEqual([]);
    expect(s.live.life_events).toBeNull();
  });
});

describe('fromSnapshot', () => {
  it('fills missing categories with empty defaults', () => {
    const snap: LiveStateSnapshot = {
      site_id: SITE,
      ts: '2026-05-22T13:00:00.000Z',
      live: {
        visitors: { live: 5, returning: 2 },
        top_pages: [{ url: 'https://example.com/', title: 'Home', count: 5 }],
      },
      max_30d: 127,
      max_30d_at: '2026-04-15T11:32:00Z',
    };
    const state = fromSnapshot(snap);
    expect(state.live.visitors).toEqual({ live: 5, returning: 2 });
    expect(state.live.top_pages).toHaveLength(1);
    expect(state.live.top_countries).toEqual([]);
    expect(state.max_30d).toBe(127);
  });
});

describe('applyEvent — visitors', () => {
  it('replaces visitors data', () => {
    const s0 = freshState();
    const env: LiveEnvelope = {
      site_id: SITE,
      category: 'visitors',
      ts: '2026-05-22T13:00:00.000Z',
      data: { live: 7, returning: 1 },
    };
    const s1 = applyEvent(s0, env);
    expect(s1.live.visitors).toEqual({ live: 7, returning: 1 });
    expect(s1).not.toBe(s0);
    expect(s1.live).not.toBe(s0.live);
  });
});

describe('applyEvent — top_pages with drops', () => {
  it('upserts and removes by url', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'top_pages',
      ts: 't1',
      data: [
        { url: 'https://example.com/a', title: 'A', count: 3 },
        { url: 'https://example.com/b', title: 'B', count: 2 },
      ],
    });
    expect(s.live.top_pages).toHaveLength(2);
    expect(s.live.top_pages[0]?.url).toBe('https://example.com/a');

    s = applyEvent(s, {
      site_id: SITE,
      category: 'top_pages',
      ts: 't2',
      data: [
        { url: 'https://example.com/a', title: 'A', count: 0 },
        { url: 'https://example.com/c', title: 'C', count: 5 },
      ],
    });
    expect(s.live.top_pages).toHaveLength(2);
    expect(s.live.top_pages.map((p) => p.url)).toEqual([
      'https://example.com/c',
      'https://example.com/b',
    ]);
  });
});

describe('applyEvent — mixed live + drop in same delta', () => {
  it('processes the whole array', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'top_countries',
      ts: 't1',
      data: [
        { country: 'US', count: 5 },
        { country: 'DE', count: 3 },
        { country: 'IT', count: 1 },
      ],
    });
    s = applyEvent(s, {
      site_id: SITE,
      category: 'top_countries',
      ts: 't2',
      data: [
        { country: 'IT', count: 0 }, // drop
        { country: 'US', count: 6 }, // upsert
        { country: 'FR', count: 2 }, // insert
      ],
    });
    expect(s.live.top_countries.map((r) => r.country)).toEqual(['US', 'DE', 'FR']);
  });
});

describe('applyEvent — active_sessions drop', () => {
  it('removes a session when step_count is 0', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'active_sessions',
      ts: 't1',
      data: [
        {
          session_id: 'abc',
          current_page: '/x',
          entry_url: '/x',
          country: 'CH',
          device: 'desktop',
          browser: 'Chrome',
          os: 'Linux',
          source: 'organic',
          step_count: 3,
          last_activity: 't1',
        },
      ],
    });
    expect(s.live.active_sessions).toHaveLength(1);

    s = applyEvent(s, {
      site_id: SITE,
      category: 'active_sessions',
      ts: 't2',
      data: [
        {
          session_id: 'abc',
          current_page: null,
          entry_url: null,
          country: null,
          device: null,
          browser: null,
          os: null,
          source: null,
          step_count: 0,
          last_activity: null,
        },
      ],
    });
    expect(s.live.active_sessions).toHaveLength(0);
  });
});

describe('applyEvent — geo composite key', () => {
  it('keys on lat+lng', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'geo',
      ts: 't1',
      data: [
        { lat: 45.1, lng: 10.3, count: 2 },
        { lat: 43.4, lng: 11.4, count: 1 },
      ],
    });
    s = applyEvent(s, {
      site_id: SITE,
      category: 'geo',
      ts: 't2',
      data: [{ lat: 45.1, lng: 10.3, count: 0 }],
    });
    expect(s.live.geo).toHaveLength(1);
    expect(s.live.geo[0]?.lat).toBe(43.4);
  });
});

describe('applyEvent — ephemeral categories', () => {
  it('replaces life_events outright', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'life_events',
      ts: 't1',
      data: { arrived: 3, navigated: 0, departed: 0, ts: 't1' },
    });
    expect(s.live.life_events).toEqual({ arrived: 3, navigated: 0, departed: 0, ts: 't1' });

    s = applyEvent(s, {
      site_id: SITE,
      category: 'life_events',
      ts: 't2',
      data: { arrived: 0, navigated: 1, departed: 2, ts: 't2' },
    });
    expect(s.live.life_events?.arrived).toBe(0);
    expect(s.live.life_events?.navigated).toBe(1);
  });

  it('replaces events outright (empty deliveries reset)', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'events',
      ts: 't1',
      data: [
        {
          category: 'Purchase',
          action: 'Completed',
          label: 'pro',
          count: 1,
          value: 99,
          time: '2026-05-22T18:55:56Z',
        },
      ],
    });
    expect(s.live.events).toHaveLength(1);
    expect(s.live.events[0]?.time).toBe('2026-05-22T18:55:56Z');
    s = applyEvent(s, {
      site_id: SITE,
      category: 'events',
      ts: 't2',
      data: [],
    });
    expect(s.live.events).toHaveLength(0);
  });
});

describe('applyEvent — reference stability', () => {
  it('produces a new state object on every update', () => {
    const s0 = freshState();
    const s1 = applyEvent(s0, {
      site_id: SITE,
      category: 'visitors',
      ts: 't1',
      data: { live: 1, returning: 0 },
    });
    expect(s1).not.toBe(s0);
    expect(s1.live).not.toBe(s0.live);
  });

  it('reuses sub-objects for untouched categories', () => {
    let s = freshState();
    s = applyEvent(s, {
      site_id: SITE,
      category: 'top_pages',
      ts: 't1',
      data: [{ url: 'https://x.com/', title: null, count: 1 }],
    });
    const topPagesRef = s.live.top_pages;
    const s2 = applyEvent(s, {
      site_id: SITE,
      category: 'visitors',
      ts: 't2',
      data: { live: 1, returning: 0 },
    });
    expect(s2.live.top_pages).toBe(topPagesRef);
  });
});
