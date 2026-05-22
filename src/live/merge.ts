import type {
  ActiveSessionEntry,
  GeoEntry,
  LiveCategoriesData,
  LiveEnvelope,
  LiveStateSnapshot,
  ManagedLiveState,
} from '../types.js';

export function emptyCategoriesData(): LiveCategoriesData {
  return {
    visitors: null,
    top_pages: [],
    top_referrers: [],
    top_mediums: [],
    top_sources: [],
    top_search: [],
    top_social: [],
    top_countries: [],
    top_devices: [],
    top_browsers: [],
    top_oses: [],
    top_languages: [],
    top_screens: [],
    time_spent: null,
    pages_per_session: null,
    performance: null,
    life_events: null,
    events: [],
    geo: [],
    active_sessions: [],
  };
}

export function emptyState(siteId: string): ManagedLiveState {
  return {
    site_id: siteId,
    ts: new Date(0).toISOString(),
    live: emptyCategoriesData(),
    max_30d: null,
    max_30d_at: null,
  };
}

export function fromSnapshot(snapshot: LiveStateSnapshot): ManagedLiveState {
  const base = emptyCategoriesData();
  const live: LiveCategoriesData = { ...base, ...snapshot.live };
  return {
    site_id: snapshot.site_id,
    ts: snapshot.ts,
    live,
    max_30d: snapshot.max_30d,
    max_30d_at: snapshot.max_30d_at,
  };
}

function mergeTopN<T extends { count: number }>(
  prev: readonly T[],
  delta: readonly T[],
  keyOf: (entry: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const item of prev) map.set(keyOf(item), item);
  for (const item of delta) {
    if (item.count === 0) map.delete(keyOf(item));
    else map.set(keyOf(item), item);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function mergeSessions(
  prev: readonly ActiveSessionEntry[],
  delta: readonly ActiveSessionEntry[],
): ActiveSessionEntry[] {
  const map = new Map<string, ActiveSessionEntry>();
  for (const s of prev) map.set(s.session_id, s);
  for (const s of delta) {
    if (s.step_count === 0) map.delete(s.session_id);
    else map.set(s.session_id, s);
  }
  return Array.from(map.values());
}

function geoKey(g: GeoEntry): string {
  return `${g.lat},${g.lng}`;
}

export function applyEvent(state: ManagedLiveState, env: LiveEnvelope): ManagedLiveState {
  const live: LiveCategoriesData = { ...state.live };

  switch (env.category) {
    case 'visitors':
      live.visitors = env.data;
      break;
    case 'top_pages':
      live.top_pages = mergeTopN(state.live.top_pages, env.data, (p) => p.url);
      break;
    case 'top_referrers':
      live.top_referrers = mergeTopN(state.live.top_referrers, env.data, (e) => e.url);
      break;
    case 'top_mediums':
      live.top_mediums = mergeTopN(state.live.top_mediums, env.data, (e) => e.medium);
      break;
    case 'top_sources':
      live.top_sources = mergeTopN(state.live.top_sources, env.data, (e) => e.source);
      break;
    case 'top_search':
      live.top_search = mergeTopN(state.live.top_search, env.data, (e) => e.term);
      break;
    case 'top_social':
      live.top_social = mergeTopN(state.live.top_social, env.data, (e) => e.network);
      break;
    case 'top_countries':
      live.top_countries = mergeTopN(state.live.top_countries, env.data, (e) => e.country);
      break;
    case 'top_devices':
      live.top_devices = mergeTopN(state.live.top_devices, env.data, (e) => e.device);
      break;
    case 'top_browsers':
      live.top_browsers = mergeTopN(state.live.top_browsers, env.data, (e) => e.browser);
      break;
    case 'top_oses':
      live.top_oses = mergeTopN(state.live.top_oses, env.data, (e) => e.os);
      break;
    case 'top_languages':
      live.top_languages = mergeTopN(state.live.top_languages, env.data, (e) => e.language);
      break;
    case 'top_screens':
      live.top_screens = mergeTopN(state.live.top_screens, env.data, (e) => e.resolution);
      break;
    case 'time_spent':
      live.time_spent = env.data;
      break;
    case 'pages_per_session':
      live.pages_per_session = env.data;
      break;
    case 'performance':
      live.performance = env.data;
      break;
    case 'life_events':
      live.life_events = env.data;
      break;
    case 'events':
      live.events = env.data;
      break;
    case 'geo':
      live.geo = mergeTopN(state.live.geo, env.data, geoKey);
      break;
    case 'active_sessions':
      live.active_sessions = mergeSessions(state.live.active_sessions, env.data);
      break;
  }

  return {
    site_id: state.site_id,
    ts: env.ts,
    live,
    max_30d: state.max_30d,
    max_30d_at: state.max_30d_at,
  };
}
