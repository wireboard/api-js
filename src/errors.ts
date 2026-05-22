import type { RateLimitInfo } from './types.js';

/**
 * Thrown when the WireBoard API returns an envelope error (`status: false`),
 * a non-envelope 429 (rate-limit cap), or any non-401/403 HTTP failure.
 *
 * Branch on `code` for known stable identifiers (`'site_not_found'`,
 * `'unknown_categories'`, `'concurrent_limit_reached'`, ...). For plain
 * validation errors (`fieldErrors` present without `error_code`), branch on
 * `httpStatus === 422` and inspect `fieldErrors`.
 *
 * Bare-body auth failures (401/403) throw {@link WireBoardAuthError}
 * instead — they don't carry the envelope.
 */
export class WireBoardApiError extends Error {
  override name = 'WireBoardApiError';

  /**
   * Stable machine-readable code from `fieldErrors.error_code[0]` when
   * present. Examples: `'site_not_found'`, `'unknown_categories'`,
   * `'unknown_filter'`, `'unknown_group_by'`, `'concurrent_limit_reached'`,
   * `'route_not_found'`. `null` for plain validation errors and bare-body
   * 429s.
   */
  code: string | null;

  /** Per-field validation messages and the `error_code` map. */
  fieldErrors: Record<string, string[]> | undefined;

  /** HTTP status code of the failing response. */
  httpStatus: number;

  /** Rate-limit headers parsed from the failing response, when present. */
  rateLimit: RateLimitInfo | undefined;

  constructor(opts: {
    message: string;
    code: string | null;
    fieldErrors: Record<string, string[]> | undefined;
    httpStatus: number;
    rateLimit: RateLimitInfo | undefined;
  }) {
    super(opts.message);
    this.code = opts.code;
    this.fieldErrors = opts.fieldErrors;
    this.httpStatus = opts.httpStatus;
    this.rateLimit = opts.rateLimit;
  }
}

/**
 * Thrown when the API returns 401 (unauthenticated) or 403 (forbidden /
 * missing ability). These responses carry a bare `{ message: string }` body,
 * not the standard envelope, so there is no `code` or `fieldErrors`.
 *
 * Handle as "401 → re-auth; 403 → re-mint a token with the right
 * abilities."
 */
export class WireBoardAuthError extends Error {
  override name = 'WireBoardAuthError';
  httpStatus: 401 | 403;

  constructor(message: string, httpStatus: 401 | 403) {
    super(message);
    this.httpStatus = httpStatus;
  }
}
