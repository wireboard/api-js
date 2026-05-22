import type { BreakdownDimension, LiveCategory } from './constants.js';
import { DEFAULT_BASE_URL } from './constants.js';
import { LiveClient } from './live/managed.js';
import { LiveRawClient } from './live/raw.js';
import { Transport, type TransportOptions } from './transport.js';
import type {
  Account,
  AggregateParams,
  AggregateResult,
  BreakdownParams,
  BreakdownResult,
  DefaultEventGroupBy,
  Dimensions,
  EventGroupByKey,
  EventsParams,
  EventsResult,
  HistoryParams,
  HistoryResult,
  LiveOptions,
  LiveRawOptions,
  LiveStateSnapshot,
  LiveTokenResult,
  RateLimitInfo,
  SitesResult,
  TimeseriesParams,
  TimeseriesResult,
  UrlsParams,
  UrlsResult,
  WireBoardClientOptions,
} from './types.js';

interface CallOpts {
  signal?: AbortSignal;
}

/**
 * The WireBoard API client.
 *
 * Holds a bearer token in memory and exposes one method per REST endpoint,
 * plus factories for the Live (SSE) clients. Methods return the unwrapped
 * `data` payload from the API envelope and throw {@link WireBoardApiError}
 * or {@link WireBoardAuthError} on failure.
 *
 * @example
 * ```ts
 * const wb = new WireBoardClient({ token: process.env.WIREBOARD_TOKEN! });
 * const { sites } = await wb.sites();
 * const summary = await wb.aggregate({
 *   site_id: sites[0]!.id,
 *   from: '2026-05-01',
 *   to:   '2026-05-22',
 * });
 * ```
 */
export class WireBoardClient {
  private readonly resolved: TransportOptions;
  private readonly transport: Transport;

  constructor(options: WireBoardClientOptions) {
    this.resolved = resolveOptions(options);
    this.transport = new Transport(this.resolved);
  }

  // ─── REST ──────────────────────────────────────────────────────────────

  /** `GET /v1/account` — team-owner identity and the abilities of this token. */
  account(opts?: CallOpts): Promise<Account> {
    return this.transport.get<Account>('/v1/account', undefined, opts);
  }

  /** `GET /v1/sites` — every site owned by the team. */
  sites(opts?: CallOpts): Promise<SitesResult> {
    return this.transport.get<SitesResult>('/v1/sites', undefined, opts);
  }

  /** `GET /v1/analytics/aggregate` — period totals (visitors, pageviews, bounce, duration). */
  aggregate(params: AggregateParams, opts?: CallOpts): Promise<AggregateResult> {
    return this.transport.get<AggregateResult>('/v1/analytics/aggregate', params, opts);
  }

  /** `GET /v1/analytics/timeseries` — one metric bucketed over time. */
  timeseries(params: TimeseriesParams, opts?: CallOpts): Promise<TimeseriesResult> {
    return this.transport.get<TimeseriesResult>('/v1/analytics/timeseries', params, opts);
  }

  /** `GET /v1/analytics/history` — visitors/returning/pageviews/bounce/duration per UTC day. */
  history(params: HistoryParams, opts?: CallOpts): Promise<HistoryResult> {
    return this.transport.get<HistoryResult>('/v1/analytics/history', params, opts);
  }

  /**
   * `GET /v1/analytics/breakdown` — top-N rows by a single dimension.
   *
   * Generic over the dimension: the returned row type carries the
   * dimension-specific field, e.g. `dimension: 'country'` produces rows of
   * `{ country: string; visitors: number }`.
   */
  breakdown<D extends BreakdownDimension>(
    params: BreakdownParams<D>,
    opts?: CallOpts,
  ): Promise<BreakdownResult<D>> {
    return this.transport.get<BreakdownResult<D>>('/v1/analytics/breakdown', params, opts);
  }

  /** `GET /v1/analytics/urls` — per-URL rich metrics with prefix/contains/exact match. */
  urls(params: UrlsParams, opts?: CallOpts): Promise<UrlsResult> {
    return this.transport.get<UrlsResult>('/v1/analytics/urls', params, opts);
  }

  /**
   * `GET /v1/analytics/events` — custom events report.
   *
   * Generic over `group_by`: cast `group_by` with `as const` for the
   * strictest row typing, e.g.
   * `group_by: ['category', 'utm_source'] as const` yields rows of
   * `{ category: string|null; utm_source: string|null; count: number; value: number }`.
   */
  events<G extends readonly EventGroupByKey[] = DefaultEventGroupBy>(
    params: EventsParams<G>,
    opts?: CallOpts,
  ): Promise<EventsResult<G>> {
    return this.transport.get<EventsResult<G>>('/v1/analytics/events', params, opts);
  }

  /** `GET /v1/analytics/dimensions` — meta endpoint: lists the SDK doesn't need to hard-code. */
  dimensions(opts?: CallOpts): Promise<Dimensions> {
    return this.transport.get<Dimensions>('/v1/analytics/dimensions', undefined, opts);
  }

  // ─── Live (low-level) ──────────────────────────────────────────────────

  /**
   * `GET /v1/live/state` — current per-category snapshot for one site.
   *
   * Useful on first load (paint UI before subscribing) and after any hard
   * reconnect to recover from missed drop signals. Categories not in the
   * request are omitted from `live`.
   */
  liveState(
    params: { site_id: string; categories?: LiveCategory[] },
    opts?: CallOpts,
  ): Promise<LiveStateSnapshot> {
    return this.transport.get<LiveStateSnapshot>('/v1/live/state', params, opts);
  }

  /**
   * `GET /v1/live/token` — mint a short-lived (15 min) subscriber JWT scoped
   * to a set of sites + categories. Pass the returned `token` as the
   * `?authorization=` query param on the SSE EventSource URL.
   */
  liveToken(
    params?: { sites?: string[]; categories?: LiveCategory[] },
    opts?: CallOpts,
  ): Promise<LiveTokenResult> {
    return this.transport.get<LiveTokenResult>('/v1/live/token', params, opts);
  }

  // ─── Live (factories) ──────────────────────────────────────────────────

  /**
   * Create a managed Live client for a single site. The SDK fetches the
   * snapshot, opens the stream, merges drop signals, rotates JWTs every 15
   * minutes with a zero-gap overlap, and refetches the snapshot on hard
   * reconnect. Customers read merged state via `subscribe`/`state`.
   *
   * @example
   * ```ts
   * const live = wb.live({ siteId, categories: ['visitors', 'top_pages'] });
   * live.subscribe(state => render(state.live));
   * await live.start();
   * ```
   */
  live(options: LiveOptions): LiveClient {
    return new LiveClient(this, options);
  }

  /**
   * Create a raw Live client. Delivers each envelope to `onEvent`; merge
   * logic is the customer's responsibility. Supports multi-site
   * subscriptions on a single connection.
   *
   * Use this when you need full control over how drop signals apply, or
   * when running multi-site state.
   */
  liveRaw(options: LiveRawOptions): LiveRawClient {
    return new LiveRawClient(this, options);
  }

  // ─── Instrumentation ────────────────────────────────────────────────────

  /**
   * Run a callback against an instrumented client and return its result plus
   * the rate-limit headers from the **last** response observed inside the
   * callback.
   *
   * Call methods on the closure's `client` argument, not the outer client.
   * Calls on the outer client are NOT instrumented (they bypass the
   * capture).
   *
   * Concurrent `withMeta` calls each get their own captured slot and do not
   * interfere — safe to use inside `Promise.all`. Nesting is allowed; the
   * inner call wins for its own scope and does not pollute the outer.
   *
   * @example
   * ```ts
   * const { data, rateLimit } = await wb.withMeta(c => c.aggregate({
   *   site_id, from, to,
   * }));
   * console.log(`requests left this minute: ${rateLimit?.remaining}`);
   * ```
   */
  async withMeta<T>(
    fn: (client: WireBoardClient) => Promise<T>,
  ): Promise<{ data: T; rateLimit: RateLimitInfo | undefined }> {
    let captured: RateLimitInfo | undefined;
    const child = new WireBoardClient(this.resolved);
    child.transport.setResponseHook((info) => {
      captured = info;
    });
    try {
      const data = await fn(child);
      return { data, rateLimit: captured };
    } finally {
      // Detach the hook so any LiveClient or long-lived reference created
      // inside `fn` doesn't keep updating the captured slot forever (and
      // doesn't pin the closure for GC).
      child.transport.setResponseHook(null);
    }
  }
}

function resolveOptions(options: WireBoardClientOptions): TransportOptions {
  if (typeof options.token !== 'string' || options.token.length === 0) {
    throw new TypeError('WireBoardClient: `token` is required.');
  }
  return {
    token: options.token,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    fetch: options.fetch ?? defaultFetch(),
    retryOn429: options.retryOn429 ?? true,
  };
}

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch === 'undefined') {
    throw new Error(
      'No global fetch available. Pass a fetch implementation via the `fetch` option.',
    );
  }
  return globalThis.fetch.bind(globalThis);
}
