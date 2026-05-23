# Changelog

All notable changes to `@wireboard/api` will be documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-05-23

### Fixed
- `bin` entry now explicitly names the executable `wireboard-api` (was
  installing as `api` due to npm auto-normalising a bare-string `bin`
  field on scoped packages). Matches what the CLI's `--help` banner
  already advertises (`wireboard-api verify`).

## [1.0.0] — 2026-05-23

Initial release.
