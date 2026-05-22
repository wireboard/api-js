/**
 * The 20 Live API categories, in their canonical order.
 *
 * Use this when you want to subscribe to "everything" without hard-coding the
 * list. The {@link LiveCategory} type is derived from this array, so the
 * SDK guarantees the two stay in sync.
 */
export const LIVE_CATEGORIES = [
  'visitors',
  'top_pages',
  'top_referrers',
  'top_mediums',
  'top_sources',
  'top_search',
  'top_social',
  'top_countries',
  'top_devices',
  'top_browsers',
  'top_oses',
  'top_languages',
  'top_screens',
  'time_spent',
  'pages_per_session',
  'performance',
  'life_events',
  'events',
  'geo',
  'active_sessions',
] as const;

export type LiveCategory = (typeof LIVE_CATEGORIES)[number];

/**
 * Maps a breakdown dimension key to the field name returned per row.
 *
 * `ref_url` / `entry_url` / `exit_url` all return rows with a `url` field;
 * `ref_medium` returns `medium`; etc. See `BreakdownRow<D>` for the typed
 * row shape per dimension.
 */
export const BREAKDOWN_FIELDS = {
  country: 'country',
  device: 'device',
  browser: 'browser',
  os: 'os',
  language: 'language',
  url: 'url',
  ref_url: 'url',
  ref_medium: 'medium',
  ref_source: 'source',
  ref_search: 'term',
  ref_social: 'network',
  entry_url: 'url',
  exit_url: 'url',
} as const;

export type BreakdownDimension = keyof typeof BREAKDOWN_FIELDS;
export type BreakdownFieldFor<D extends BreakdownDimension> = (typeof BREAKDOWN_FIELDS)[D];

/**
 * Server-side limits exposed as a typed constant so customer code doesn't
 * need magic numbers. These mirror the API's documented caps; the API itself
 * is the source of truth and may tighten further.
 */
export const LIMITS = {
  breakdown: { default: 50, max: 500 },
  urls: { default: 50, max: 500, offset_max: 10_000 },
  events: { default: 50, max: 1_000, offset_max: 10_000 },
  range_days: 366,
  rate_per_minute: { default: 120, live_token: 120 },
  live: {
    concurrent_subscriptions: 10,
    jwt_lifetime_seconds: 900,
  },
  tokens_per_team: 10,
} as const;

/** Abilities a token can carry. */
export type Ability = 'analytics:read' | 'live:read';

/** Default API base URL. */
export const DEFAULT_BASE_URL = 'https://api.wireboard.io';
