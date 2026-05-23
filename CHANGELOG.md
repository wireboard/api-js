# Changelog

All notable changes to `@wireboard/api` will be documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
