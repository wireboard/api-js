# Changelog

All notable changes to `@wireboard/api` will be documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] — 2026-05-24

### Added
- Two typed error subclasses for plan-gating responses introduced by
  the backend on 2026-05-24:
  - `PlanHistoryLimitExceededError` (extends `WireBoardApiError`,
    `httpStatus: 422`). Thrown on `/v1/analytics/*` endpoints when a
    free-plan caller passes a `from` older than 30 days. Exposes
    `earliestAllowed: string | null` (parsed from
    `fieldErrors.earliest_allowed`) so callers can auto-correct the
    range or prompt for an upgrade.
  - `PaidPlanRequiredError` (extends `WireBoardApiError`,
    `httpStatus: 403`). Thrown on the entire Live API
    (`/v1/live/token`, `/v1/live/state`) for free-plan callers.

### Changed
- Transport now classifies 403 responses by their `error_code` before
  falling back to the generic auth-vs-api decision. Previously, any
  `403` produced a `WireBoardAuthError`, which stripped the
  `error_code` and `fieldErrors`, leaving plan-gating errors
  indistinguishable from genuine auth failures. The new
  `PaidPlanRequiredError` preserves both fields and is explicitly
  NOT a subclass of `WireBoardAuthError`, so customers won't push
  affected users through a re-login flow when an upgrade prompt is
  the correct response.
- Both new subclasses extend `WireBoardApiError`, so existing
  `instanceof WireBoardApiError` checks continue to match. Order your
  `instanceof` checks specific-to-general to leverage the new types.

## [1.0.4] — 2026-05-23

### Changed
- README's "Browser usage" section now splits the recommendation along
  an audience boundary: SDK-in-browser + two-token flow for internal /
  bounded-audience pages, SDK-on-backend (cached snapshot or fan-out)
  for public-facing pages. The previous text implied the two-token
  flow was universal, which would push customers toward tying every
  public visitor's browser to the streaming hub. No code changes.

## [1.0.3] — 2026-05-23

### Fixed
- `liveState()` / `wb.live()` snapshot parsing: the production server
  returns `live` as an array of `{category, ts, data}` envelopes (same
  shape as the SSE stream messages), not the per-category map the public
  spec documents. The SDK was assuming the map shape, so the initial
  snapshot of the managed Live client was effectively empty (customers
  read `state.live.visitors` and got `undefined` until the first SSE
  message arrived and overwrote the broken state). The SDK now accepts
  both shapes at the boundary and normalises to the documented map
  shape, so customer code and downstream merge logic always see the
  correct contract — whether the server is fixed to match the spec or
  not.

  No public type changes. Affects everyone using `wb.live(...)` or
  calling `liveState()` directly; upgrade is recommended.

## [1.0.2] — 2026-05-23

### Changed
- README now includes npm version, bundle size, types, and license badges
  in the header. No code changes.

## [1.0.1] — 2026-05-23

### Fixed
- `bin` entry now explicitly names the executable `wireboard-api` (was
  installing as `api` due to npm auto-normalising a bare-string `bin`
  field on scoped packages). Matches what the CLI's `--help` banner
  already advertises (`wireboard-api verify`).

## [1.0.0] — 2026-05-23

Initial release.
