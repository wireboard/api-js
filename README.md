<p align="center">
  <a href="https://wireboard.io">
    <img src="https://wireboard.io/img/logo-blue.png" alt="WireBoard" height="64">
  </a>
</p>

<h1 align="center"><code>@wireboard/api</code></h1>

<p align="center">
  Official TypeScript SDK for the <a href="https://wireboard.io">WireBoard</a> REST and Live APIs.
</p>

<p align="center">
  Pull historical analytics, subscribe to real-time visitor activity, and integrate WireBoard with anything you can write code against.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@wireboard/api"><img src="https://img.shields.io/npm/v/@wireboard/api.svg" alt="npm version"></a>
  <a href="https://bundlephobia.com/package/@wireboard/api"><img src="https://img.shields.io/bundlephobia/minzip/@wireboard/api?label=bundle%20size" alt="bundle size (minified + gzipped)"></a>
  <a href="https://www.npmjs.com/package/@wireboard/api"><img src="https://img.shields.io/npm/types/@wireboard/api.svg" alt="types: TypeScript"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@wireboard/api.svg" alt="license: MIT"></a>
</p>

---

- Works in modern browsers and Node 18+
- ESM and CJS dual-published, separate tree-shakeable browser bundle
- Browser bundle under 15 KB gzipped, zero runtime dependencies in the browser
- Strict TypeScript types end-to-end, including discriminated unions for Live events and per-dimension typing for breakdowns

## Install

```sh
npm install @wireboard/api
```

## Quickstart

Mint a token in **Settings → API** on your WireBoard dashboard (needs the
`analytics:read` ability for REST, `live:read` for the Live API). Then:

```ts
import { WireBoardClient } from '@wireboard/api';

const wb = new WireBoardClient({ token: process.env.WIREBOARD_TOKEN! });

// Historical
const { sites } = await wb.sites();
const site = sites[0]!;

const summary = await wb.aggregate({
  site_id: site.id,
  from: '2026-05-01',
  to:   '2026-05-22',
});
console.log(`${summary.visitors} visitors, ${summary.pageviews} pageviews`);

// Real-time (managed mode — SDK handles state, drop signals, JWT rotation)
const live = wb.live({
  siteId:     site.id,
  categories: ['visitors', 'top_pages'],
});

live.subscribe(state => {
  console.log(
    'now:', state.live.visitors?.live ?? 0,
    'top:', state.live.top_pages[0]?.url,
  );
});

await live.start();
// later:
// live.stop();
```

The SDK handles snapshot rebuild on reconnect, drop signals, and short-lived
JWT rotation for you. A NEW state object is emitted on every update, so
`prev !== next` works as a change check in React, Vue, or Svelte.

## API at a glance

Every method returns the unwrapped `data` payload from the API envelope and
throws `WireBoardApiError` / `WireBoardAuthError` on failure (see
[Errors](#errors)). Every method accepts an optional `{ signal?: AbortSignal }`
as a final argument.

| Method | Returns | What it does |
| --- | --- | --- |
| `account()` | `Account` | Team-owner identity + the abilities of this token |
| `sites()` | `SitesResult` | Every site owned by the team |
| `aggregate(params)` | `AggregateResult` | Period totals (visitors, pageviews, bounce, duration) |
| `timeseries(params)` | `TimeseriesResult` | One metric, bucketed by `hour` or `day` |
| `history(params)` | `HistoryResult` | Visitors / returning / pageviews / bounce / duration per day |
| `breakdown<D>(params)` | `BreakdownResult<D>` | Top-N rows by dimension; row type is narrowed by `D` |
| `urls(params)` | `UrlsResult` | Per-URL metrics with `prefix` / `contains` / `exact` filters |
| `events<G>(params)` | `EventsResult<G>` | Custom events report; row type is narrowed by `group_by` |
| `dimensions()` | `Dimensions` | Meta: supported dimensions, metrics, limits |
| `liveState(params)` | `LiveStateSnapshot` | Current per-category snapshot for one site |
| `liveToken(params?)` | `LiveTokenResult` | Mint a 15-min subscriber JWT for the SSE stream |
| `live(options)` | `LiveClient` | Managed Live client (handles snapshot + merge + rotation) |
| `liveRaw(options)` | `LiveRawClient` | Raw Live client (multi-site, custom merge) |
| `withMeta(fn)` | `{ data, rateLimit }` | Run a call and capture its rate-limit headers |

Full reference: [REST](https://wireboard.io/docs/api-rest) · [Live](https://wireboard.io/docs/api-live) · [Errors](https://wireboard.io/docs/api-errors).

## Live API: two modes

The SDK exposes both a managed and a raw client over the same SSE protocol.
Pick based on what your UI needs.

### Managed mode — single site, SDK owns the state

```ts
const live = wb.live({
  siteId:      'xK4mP2nT',
  categories:  ['visitors', 'top_pages', 'active_sessions'],
  onChange:    state => render(state.live),
  onError:     err   => console.error(err),
  onRotate:    ()    => log('jwt rotated'),     // optional, observability
  onReconnect: ()    => log('reconnected'),     // optional, observability
});

await live.start();
// state available at `live.state`; subscribe(...) returns an unsubscribe fn
```

The managed client fetches `/v1/live/state` on connect, merges drop signals
per category (`count: 0` → remove from top-N, `step_count: 0` → remove from
`active_sessions`), rotates the JWT 60 s before expiry with a zero-gap
overlap, dedupes events by `lastEventId`, and refetches the snapshot on
hard reconnect. `onRotate` and `onReconnect` are optional observability
hooks for tracking transparent recoveries.

### Raw mode — multi-site, you own the state

```ts
const raw = wb.liveRaw({
  sites:      ['xK4mP2nT', 'aB3cD4fG'],
  categories: ['visitors', 'top_pages'],
  onEvent: env => {
    // env is a discriminated union — TS narrows env.data by env.category
    if (env.category === 'top_pages') {
      for (const row of env.data) {
        // row.count === 0 means "remove from local state"
      }
    }
  },
});

await raw.start();
```

Use raw mode for multi-site dashboards, when you already have your own
reactive store, or when you want full control over how drop signals apply.

## TypeScript: precise types per request

The generic methods narrow row shapes based on the request.

```ts
// Dimension narrows the row's per-dimension field:
const c = await wb.breakdown({ site_id, from, to, dimension: 'country' });
c.rows[0]; // { country: string; visitors: number }

const m = await wb.breakdown({ site_id, from, to, dimension: 'ref_medium' });
m.rows[0]; // { medium:  string; visitors: number }

// group_by narrows event row keys (cast with `as const` for the tightest types):
const r = await wb.events({
  site_id, from, to,
  group_by: ['category', 'utm_source'] as const,
});
r.rows[0]; // { category: string | null; utm_source: string | null; count: number; value: number }
```

The Live envelope is a discriminated union: `switch (env.category)` narrows
`env.data` to the right shape automatically — no casts needed.

## Browser usage

Bundlers (Vite, Webpack, esbuild, Rollup) pick the browser-targeted ESM
build automatically via the package's conditional exports — no config
needed:

```ts
// React / Vue / Svelte / vanilla — same import, browser ESM build resolved
import { WireBoardClient } from '@wireboard/api';

const wb = new WireBoardClient({ token: yourShortLivedTokenFromYourServer });
```

For production, do **not** ship your long-lived bearer token to the
browser. Mint short-lived subscriber JWTs server-side via
[`liveToken()`](https://wireboard.io/docs/api-live#mint-jwt) and pass
those to the browser.

Working browser demos live in [`examples/browser/`](./examples/browser/) —
four zero-build pages covering REST, historical analytics, and both Live
modes. See [`examples/`](./examples/) for the full set.

## Errors

Two error classes, both extend `Error`:

```ts
import { WireBoardApiError, WireBoardAuthError } from '@wireboard/api';

try {
  await wb.aggregate({ site_id, from, to });
} catch (err) {
  if (err instanceof WireBoardAuthError) {
    // 401 → re-auth; 403 → re-mint a token with the right abilities
  } else if (err instanceof WireBoardApiError) {
    switch (err.code) {
      case 'site_not_found':           /* unknown site or wrong team */ break;
      case 'concurrent_limit_reached': /* too many live subscriptions */ break;
      case 'unknown_filter':           /* events filter not whitelisted */ break;
      // ...
    }
    // err.fieldErrors, err.httpStatus, err.rateLimit are all on the error
  }
  throw err;
}
```

The SDK auto-retries **once** on a 429 (honouring `Retry-After`). Opt out
with `new WireBoardClient({ token, retryOn429: false })`. There are no
retries on 5xx or network errors — your code decides.

## Cancellation

Every REST call accepts an `AbortSignal` via a `{ signal }` second argument
(standard `fetch` idiom):

```ts
const controller = new AbortController();

const promise = wb.urls(
  { site_id, from, to, prefix: '/checkout' },
  { signal: controller.signal },
);

// elsewhere — e.g. component unmount, route change, user cancel
controller.abort();
```

The Live clients are cancelled via `.stop()` instead — it also aborts any
in-flight snapshot fetch or JWT mint.

## Rate-limit visibility

Every successful response carries `X-RateLimit-*` headers. To read them
without an extra HTTP call, wrap the request in `withMeta`:

```ts
const { data, rateLimit } = await wb.withMeta(c => c.aggregate({
  site_id, from, to,
}));

console.log(`${rateLimit?.remaining}/${rateLimit?.limit} requests left this minute`);
```

`withMeta` is safe under `Promise.all`; each call captures its own slot.
Calls on the outer client (not the closure's `c`) are NOT instrumented.

## Verify your setup

The package ships a CLI that exercises every endpoint against your real
account:

```sh
WIREBOARD_TOKEN=… npx @wireboard/api verify
```

It hits every REST surface for a 7-day window, opens a 45-second managed
Live subscription, and prints a pass/fail summary table. Exit code `0` on
full pass, `1` on any failure, `2` on usage error. Use `--no-color` for CI
logs and `--duration=920` to also observe a full JWT rotation cycle.

## Runtime targets

| Runtime | Build picked | Notes |
| --- | --- | --- |
| Bundler (Vite, Webpack, esbuild, Rollup) | `dist/index.browser.js` (ESM) | Uses global `EventSource`; no `eventsource` polyfill bundled |
| Node ESM (`"type": "module"`) | `dist/index.js` (ESM) | Pulls in `eventsource` for SSE |
| Node CJS (`require(...)`) | `dist/index.cjs` (CJS) | Same as Node ESM |
| TypeScript | `dist/index.d.ts` / `.d.cts` | Resolution matches the runtime build |

You don't configure anything — `import { WireBoardClient } from '@wireboard/api'`
just works in every environment.

## Contributing

```sh
git clone https://github.com/wireboard/api-js
cd api-js
npm install
npm run build && npm test
```

To exercise the browser examples against the *packed* tarball (the same
shape users get from `npm install`), put a token in `.env` at the repo
root and run:

```sh
WIREBOARD_TOKEN=… ./scripts/test-examples.sh
```

The script builds, runs `npm pack`, installs the tarball into a scratch
directory, transforms each `examples/browser/*.html` to import the local
bundle, and serves everything on a free port in `8080–8089`. Ctrl+C cleans
up. This is the closest you can get to a customer install without
publishing — use it before sending a PR that touches the build, the
public API surface, or any browser example.

## More

- [API overview](https://wireboard.io/docs/api-overview)
- [REST reference](https://wireboard.io/docs/api-rest)
- [Live API](https://wireboard.io/docs/api-live)
- [Authentication](https://wireboard.io/docs/api-authentication)
- [Errors & limits](https://wireboard.io/docs/api-errors)

## License

[MIT](./LICENSE).
