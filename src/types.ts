import type {
  Ability,
  BreakdownDimension,
  BreakdownFieldFor,
  LiveCategory,
} from './constants.js';

/**
 * YYYY-MM-DD UTC date string, or a JS Date.
 *
 * Dates are normalised to their UTC calendar day. Note: `new Date()` at 23:00
 * local in a UTC-5 zone normalises to the NEXT UTC day. If you want "today in
 * the user's timezone", construct the `YYYY-MM-DD` string yourself.
 */
export type DateInput = string | Date;

/** Identity + ability set of the team owner whose token is in use. */
export interface Account {
  email: string;
  name: string;
  abilities: Ability[];
}

/** A site owned by the team. */
export interface Site {
  id: string;
  domain: string;
  /** Highest concurrent live visitor count over the last 30 days. `null` if no traffic. */
  max_30d: number | null;
  /** UTC timestamp of when `max_30d` was last reached. `null` if `max_30d` is null. */
  max_30d_at: string | null;
}

export interface SitesResult {
  sites: Site[];
}

export interface AggregateParams {
  site_id: string;
  from: DateInput;
  to: DateInput;
}

export interface AggregateResult {
  visitors: number;
  pageviews: number;
  /** Percentage (0–100), one decimal place. */
  bounce_rate: number;
  /** Average session duration in seconds. */
  visit_duration: number;
}

export interface TimeseriesParams {
  site_id: string;
  from: DateInput;
  to: DateInput;
  metric: 'visitors' | 'pageviews';
  interval: 'hour' | 'day';
}

export interface TimeseriesPoint {
  /** Bucket start as an ISO 8601 timestamp. */
  time: string;
  value: number;
}

export interface TimeseriesResult {
  points: TimeseriesPoint[];
}

export type HistoryMetric =
  | 'visitors'
  | 'returning_visitors'
  | 'pageviews'
  | 'bounce_rate'
  | 'avg_duration';

export interface HistoryParams {
  site_id: string;
  from: DateInput;
  to: DateInput;
}

export interface HistoryPoint {
  /** YYYY-MM-DD UTC calendar day. */
  date: string;
  visitors: number;
  returning_visitors: number;
  pageviews: number;
  /** Percentage (0–100), one decimal place. */
  bounce_rate: number;
  /** Average session duration in seconds. */
  avg_duration: number;
}

export interface HistoryResult {
  points: HistoryPoint[];
}

export interface BreakdownParams<D extends BreakdownDimension> {
  site_id: string;
  from: DateInput;
  to: DateInput;
  dimension: D;
  /** Default 50, max 500. */
  limit?: number;
}

/**
 * Row shape derived from the breakdown dimension. The per-row dimension field
 * key is looked up via {@link BREAKDOWN_FIELDS}.
 *
 * @example
 *   BreakdownRow<'country'>    // { country: string; visitors: number }
 *   BreakdownRow<'ref_medium'> // { medium:  string; visitors: number }
 */
export type BreakdownRow<D extends BreakdownDimension> = { [K in BreakdownFieldFor<D>]: string } & {
  visitors: number;
};

export interface BreakdownResult<D extends BreakdownDimension> {
  dimension: D;
  metric: 'visitors';
  rows: BreakdownRow<D>[];
}

export interface UrlsParams {
  site_id: string;
  from: DateInput;
  to: DateInput;
  /** Match URLs starting with this string. */
  prefix?: string;
  /** Match URLs containing this substring. */
  contains?: string;
  /** Match URLs that equal this string exactly. */
  exact?: string;
  /** Default 50, max 500. */
  limit?: number;
  /** Default 0, max 10000. */
  offset?: number;
}

export interface UrlRow {
  url: string;
  visitors: number;
  pageviews: number;
  bounce_rate: number;
  avg_duration: number;
}

export interface UrlsResult {
  rows: UrlRow[];
  total: number;
  limit: number;
  offset: number;
}

export type EventFilterKey =
  | 'category'
  | 'action'
  | 'label'
  | 'utm_campaign'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_content'
  | 'utm_term';

export type EventGroupByKey = EventFilterKey;

/** Exact-match filters for the events endpoint. */
export interface EventFilter {
  category?: string;
  action?: string;
  label?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
  /** Filter by event props. Serialised as `filter[props.<key>]=<value>`. */
  props?: Record<string, string>;
}

export type DefaultEventGroupBy = readonly ['category', 'action', 'label'];

export interface EventsParams<G extends readonly EventGroupByKey[]> {
  site_id: string;
  from: DateInput;
  to: DateInput;
  /**
   * Group rows by these keys. Cast with `as const` for stricter row typing,
   * e.g. `group_by: ['category', 'utm_source'] as const`.
   *
   * Default: `['category', 'action', 'label']`.
   */
  group_by?: G;
  filter?: EventFilter;
  /** Default 50, max 1000. */
  limit?: number;
  /** Default 0, max 10000. */
  offset?: number;
}

export type EventRow<G extends readonly EventGroupByKey[]> = {
  [K in G[number]]: string | null;
} & {
  count: number;
  /** Sum of the event's `value` field. */
  value: number;
};

export interface EventsResult<G extends readonly EventGroupByKey[]> {
  rows: EventRow<G>[];
  total: number;
  group_by: [...G];
  limit: number;
  offset: number;
}

/** Meta endpoint result: the lists the SDK doesn't need to hard-code. */
export interface Dimensions {
  breakdown_dimensions: { key: BreakdownDimension; field: string }[];
  event_filter_fields: EventFilterKey[];
  event_group_by_fields: EventGroupByKey[];
  history_metrics: HistoryMetric[];
  max_range_days: number;
}

// ─── Live API payload shapes (one per category) ──────────────────────────────

export interface VisitorsData {
  /** Currently active sessions. */
  live: number;
  /** Of the live sessions, how many have visited before. */
  returning: number;
}

export interface TopPagesEntry {
  url: string;
  /** Page `<title>` as seen by the tracker; `null` until collected. */
  title: string | null;
  count: number;
}

export interface TopReferrerEntry {
  url: string;
  count: number;
}
export interface TopMediumEntry {
  medium: string;
  count: number;
}
export interface TopSourceEntry {
  source: string;
  count: number;
}
export interface TopSearchEntry {
  term: string;
  count: number;
}
export interface TopSocialEntry {
  network: string;
  count: number;
}
export interface TopCountryEntry {
  country: string;
  count: number;
}
export interface TopDeviceEntry {
  device: string;
  count: number;
}
export interface TopBrowserEntry {
  browser: string;
  count: number;
}
export interface TopOsEntry {
  os: string;
  count: number;
}
export interface TopLanguageEntry {
  language: string;
  count: number;
}
export interface TopScreenEntry {
  resolution: string;
  count: number;
}

export interface TimeSpentData {
  lt_1m: number;
  '1_3m': number;
  '3_5m': number;
  '5_10m': number;
  '10_20m': number;
  gt_20m: number;
}

export interface PagesPerSessionData {
  '1': number;
  '2': number;
  '3_5': number;
  '6_10': number;
  '11_20': number;
  '21_plus': number;
}

export interface PerformanceData {
  excellent: number;
  good: number;
  average: number;
  below_average: number;
  poor: number;
}

export interface LifeEventsData {
  arrived: number;
  navigated: number;
  departed: number;
  /** UTC ISO 8601 timestamp of the delivery window. */
  ts: string;
}

/**
 * A single custom-event row delivered over the Live API stream.
 *
 * Distinct from REST `/v1/analytics/events` rows (which are aggregated by
 * `group_by` and don't carry per-event timestamps).
 */
export interface EventsEntry {
  category: string;
  action: string;
  label: string | null;
  /** Number of times this (category, action, label) fired in the delivery window. */
  count: number;
  /** Sum of the event's `value` field across the window. */
  value: number;
  /** UTC ISO 8601 timestamp of when this event most recently fired. */
  time: string;
}

export interface GeoEntry {
  /** Hex-aggregated centroid, not exact visitor position. */
  lat: number;
  lng: number;
  count: number;
}

export interface ActiveSessionEntry {
  session_id: string;
  current_page: string | null;
  entry_url: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  source: string | null;
  /**
   * Steps taken so far in this session. A session-end signal arrives once as
   * `step_count: 0` with every metadata field set to `null` — treat that as
   * "remove this session from local state."
   */
  step_count: number;
  last_activity: string | null;
}

/**
 * Internal map from a Live category name to its data payload shape.
 *
 * This is the single source of truth for category typing. Both the public
 * `LiveDataFor<C>` and `LiveEnvelope` types derive from it, and the
 * `LiveCategoriesData` (merged-state) type mirrors it (with arrays where the
 * payload is an array and `T | null` where the payload is a single object).
 */
interface LiveDataMap {
  visitors: VisitorsData;
  top_pages: TopPagesEntry[];
  top_referrers: TopReferrerEntry[];
  top_mediums: TopMediumEntry[];
  top_sources: TopSourceEntry[];
  top_search: TopSearchEntry[];
  top_social: TopSocialEntry[];
  top_countries: TopCountryEntry[];
  top_devices: TopDeviceEntry[];
  top_browsers: TopBrowserEntry[];
  top_oses: TopOsEntry[];
  top_languages: TopLanguageEntry[];
  top_screens: TopScreenEntry[];
  time_spent: TimeSpentData;
  pages_per_session: PagesPerSessionData;
  performance: PerformanceData;
  life_events: LifeEventsData;
  events: EventsEntry[];
  geo: GeoEntry[];
  active_sessions: ActiveSessionEntry[];
}

/** Payload shape for category `C` as delivered over the Live stream. */
export type LiveDataFor<C extends LiveCategory> = LiveDataMap[C];

/** Discriminated envelope delivered over the Live SSE stream. */
export type LiveEnvelope = {
  [C in LiveCategory]: {
    site_id: string;
    category: C;
    ts: string;
    data: LiveDataMap[C];
  };
}[LiveCategory];

/** Merged state per category. Single-object payloads become `T | null`. */
export interface LiveCategoriesData {
  visitors: VisitorsData | null;
  top_pages: TopPagesEntry[];
  top_referrers: TopReferrerEntry[];
  top_mediums: TopMediumEntry[];
  top_sources: TopSourceEntry[];
  top_search: TopSearchEntry[];
  top_social: TopSocialEntry[];
  top_countries: TopCountryEntry[];
  top_devices: TopDeviceEntry[];
  top_browsers: TopBrowserEntry[];
  top_oses: TopOsEntry[];
  top_languages: TopLanguageEntry[];
  top_screens: TopScreenEntry[];
  time_spent: TimeSpentData | null;
  pages_per_session: PagesPerSessionData | null;
  performance: PerformanceData | null;
  /**
   * EPHEMERAL. Replaced on every delivery; not cumulative. `null` until the
   * first delivery. Empty windows produce no delta — treat each delivery as
   * "events that fired since the last delivery", not "events in a fixed
   * window".
   */
  life_events: LifeEventsData | null;
  /**
   * EPHEMERAL. Replaced on every delivery; not cumulative. Empty windows
   * produce no delta. See `life_events` above for the contract.
   */
  events: EventsEntry[];
  geo: GeoEntry[];
  active_sessions: ActiveSessionEntry[];
}

/** Result of `GET /v1/live/state`. */
export interface LiveStateSnapshot {
  site_id: string;
  /** UTC ISO timestamp of when the snapshot was assembled. */
  ts: string;
  /**
   * Per-category state for the categories included in the request. The server
   * omits categories with no current data, so this is a partial map.
   */
  live: Partial<LiveCategoriesData>;
  max_30d: number | null;
  max_30d_at: string | null;
}

/** Result of `GET /v1/live/token`. */
export interface LiveTokenResult {
  /** SSE endpoint URL. */
  hub_url: string;
  /** Short-lived JWT authorising the subscription. */
  token: string;
  /** Opaque per-(site, category) topic identifiers; pass as `?topic=` query params on the EventSource URL. */
  topics: string[];
  sites: string[];
  categories: LiveCategory[];
  /** JWT lifetime in seconds. */
  expires_in: number;
}

/** Rate-limit headers parsed from a response. */
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Seconds. Present on 429 responses; `null` otherwise. */
  retryAfter: number | null;
}

export type LiveClientStatus = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * The state object emitted by the managed Live client.
 *
 * A NEW object is produced on every update so React/Vue/Svelte equality checks
 * (`prev !== next`) work as expected. Sub-objects are reused when unchanged.
 */
export interface ManagedLiveState {
  site_id: string;
  ts: string;
  live: LiveCategoriesData;
  max_30d: number | null;
  max_30d_at: string | null;
}

/** Options for {@link WireBoardClient.liveRaw}. */
export interface LiveRawOptions {
  /** One site or many. The SDK opens a single SSE connection regardless. */
  sites: string | string[];
  /** Default: all 20 categories. */
  categories?: LiveCategory[];
  /** Called once per envelope. Customer applies merge logic themselves. */
  onEvent: (env: LiveEnvelope) => void;
  /** Called when an error is recovered (not a fatal connection drop). */
  onError?: (err: Error) => void;
  /** Called once per completed JWT rotation. */
  onRotate?: () => void;
  /**
   * Called once per successful hard-reconnect (the SDK transparently
   * re-established the stream after a connection drop). NOT fired for the
   * initial connect or for JWT rotation. Use this to surface silent
   * recoveries in your dashboard / observability.
   */
  onReconnect?: () => void;
}

/** Options for {@link WireBoardClient.live} (managed mode). */
export interface LiveOptions {
  /** Single site. For multi-site, use `liveRaw` or one managed client per site. */
  siteId: string;
  /** Default: all 20 categories. */
  categories?: LiveCategory[];
  /**
   * Called every time the merged state changes. Receives the new state
   * object (reference changes per update). Same listener can also be attached
   * via {@link LiveClient.subscribe}.
   */
  onChange?: (state: ManagedLiveState) => void;
  /**
   * Optional instrumentation hook. Fires once per raw envelope BEFORE merge.
   * Customers should read state via `subscribe`/`state`; `onEvent` is for
   * counting, logging, or external bookkeeping.
   */
  onEvent?: (env: LiveEnvelope) => void;
  onError?: (err: Error) => void;
  /** Called once per completed JWT rotation. */
  onRotate?: () => void;
  /**
   * Called once per successful hard-reconnect (the SDK transparently
   * re-established the stream after a connection drop). NOT fired for the
   * initial connect or for JWT rotation. Use this to surface silent
   * recoveries in your dashboard / observability.
   */
  onReconnect?: () => void;
}

/** Constructor options for {@link WireBoardClient}. */
export interface WireBoardClientOptions {
  /** Bearer token from Settings → API. In-memory only; the SDK never persists it. */
  token: string;
  /** Override the API host. Defaults to `https://api.wireboard.io`. */
  baseUrl?: string;
  /**
   * Custom fetch implementation (testing, proxying, instrumentation).
   * Defaults to `globalThis.fetch`.
   */
  fetch?: typeof fetch;
  /**
   * Auto-retry once on 429 honouring `Retry-After`. Default: `true`. Set to
   * `false` to handle 429s yourself.
   */
  retryOn429?: boolean;
}
