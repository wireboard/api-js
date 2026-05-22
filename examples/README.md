# Examples

Single-purpose, copy-pasteable snippets demonstrating `@wireboard/api` in
each runtime. Each file is self-contained and uses only the SDK's public
surface — no helpers, no internal imports.

```
examples/
├── browser/                       Zero-build HTML pages
│   ├── account.html                 REST · account + sites
│   ├── historical.html              REST · aggregate, breakdown, history
│   ├── live-managed.html            Live · managed mode (single site)
│   └── live-raw-multi.html          Live · raw mode (multi-site)
├── quickstart-node.ts             Node · smallest useful example
├── raw-multi-site-node.ts         Node · liveRaw with per-site routing
└── managed-live-react.tsx         React · drop-in <LiveVisitors /> component
```

## Browser

Open any file in a modern browser — no bundler, no install. Each page
imports the SDK from `esm.sh`. Before the first page load, open devtools
and run:

```js
localStorage.WIREBOARD_TOKEN = 'your_token';
// Optional — pin a specific site instead of using sites[0]:
localStorage.WIREBOARD_SITE_ID = 'xK4mP2nT';
```

| File | What it shows |
| --- | --- |
| [`browser/account.html`](./browser/account.html) | `wb.account()` + `wb.sites()` rendered to a table |
| [`browser/historical.html`](./browser/historical.html) | 7-day `aggregate` + `breakdown(country)` + daily `history` for one site |
| [`browser/live-managed.html`](./browser/live-managed.html) | Managed-mode live counter, top pages, and top countries — SDK handles state, drop signals, and JWT rotation |
| [`browser/live-raw-multi.html`](./browser/live-raw-multi.html) | One SSE connection across up to 5 sites with `liveRaw`, per-site envelope counters, and a rolling 50-event log |

## Node

Run any example with [`tsx`](https://github.com/privatenumber/tsx) (or
compile first with `tsc` and run with `node`):

```sh
WIREBOARD_TOKEN=… npx tsx examples/quickstart-node.ts
WIREBOARD_TOKEN=… npx tsx examples/raw-multi-site-node.ts
```

| File | What it shows |
| --- | --- |
| [`quickstart-node.ts`](./quickstart-node.ts) | The smallest useful example — authenticate, print account + sites |
| [`raw-multi-site-node.ts`](./raw-multi-site-node.ts) | `liveRaw` across the first 3 sites in your account, with per-site envelope counts |

## React

| File | What it shows |
| --- | --- |
| [`managed-live-react.tsx`](./managed-live-react.tsx) | Drop-in `<LiveVisitors />` component using `useEffect` + `useState` |

Import the component into any React 18+ app and pass `token` + `siteId`
as props. The SDK starts the live subscription in `useEffect` and stops
it in the cleanup, so unmounting the component closes the SSE connection
cleanly.

## Token safety

For brevity these examples accept the bearer token directly. In any real
deployment, **the bearer token must never ship to the browser** —
anyone with it has full read access to your analytics for as long as it
exists.

The correct pattern for browser apps:

1. Your server holds the long-lived bearer token.
2. When a browser session needs Live data, your server calls
   [`liveToken()`](https://wireboard.io/docs/api-live#mint-jwt) and
   returns the short-lived (15 min) JWT to the browser.
3. The browser passes that JWT to a `WireBoardClient` instance.
4. When the JWT expires, the browser asks your server for a fresh one.

The Node and React examples here use a direct bearer for clarity; swap
that for a server-proxied JWT before going to production.

## More

- [Main README](../README.md) — install, full quickstart, API reference table
- [API overview](https://wireboard.io/docs/api-overview)
- [REST reference](https://wireboard.io/docs/api-rest)
- [Live API](https://wireboard.io/docs/api-live)
- [Authentication](https://wireboard.io/docs/api-authentication)
- [Errors & limits](https://wireboard.io/docs/api-errors)
