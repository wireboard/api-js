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
 * missing ability) for an *authentication* reason — i.e. the token itself
 * is invalid, expired, or lacks the required ability. These responses
 * carry a bare `{ message: string }` body, so there is no `code` or
 * `fieldErrors`.
 *
 * Handle as "401 → re-auth; 403 → re-mint a token with the right
 * abilities."
 *
 * NOTE: a 403 that comes from a *plan limit* (not an auth issue) throws
 * {@link PaidPlanRequiredError} instead — the user's auth is fine, they
 * just need a paid plan.
 */
export class WireBoardAuthError extends Error {
  override name = 'WireBoardAuthError';
  httpStatus: 401 | 403;

  constructor(message: string, httpStatus: 401 | 403) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

/**
 * Thrown when a free-plan caller requests historical analytics with a
 * `from` date older than 30 days ago (UTC). Applies to every
 * `/v1/analytics/*` endpoint (`aggregate`, `timeseries`, `history`,
 * `breakdown`, `urls`, `events`). HTTP 422.
 *
 * Inspect {@link earliestAllowed} for the earliest `from` date the
 * server would accept; re-issue with that date, or surface an upgrade
 * prompt to the user.
 *
 * Subclass of {@link WireBoardApiError}, so `instanceof WireBoardApiError`
 * still matches; catch the more specific class first when both apply.
 */
export class PlanHistoryLimitExceededError extends WireBoardApiError {
  override name = 'PlanHistoryLimitExceededError';

  constructor(opts: {
    message: string;
    fieldErrors: Record<string, string[]> | undefined;
    httpStatus: number;
    rateLimit: RateLimitInfo | undefined;
  }) {
    super({ ...opts, code: 'plan_history_limit_exceeded' });
  }

  /**
   * Earliest `from` date the server would accept for this caller, formatted
   * `YYYY-MM-DD`. `null` if the server didn't include it (shouldn't happen
   * in practice; the contract guarantees the field).
   */
  get earliestAllowed(): string | null {
    return this.fieldErrors?.['earliest_allowed']?.[0] ?? null;
  }
}

/**
 * Thrown when a free-plan caller hits an endpoint that requires a paid
 * plan. Currently applies to the entire Live API (`/v1/live/token`,
 * `/v1/live/state`). HTTP 403.
 *
 * The user's authentication is fine — they need to upgrade. Don't push
 * them through a re-login flow; surface an upgrade prompt
 * (`/account/billing` or your equivalent).
 *
 * Subclass of {@link WireBoardApiError}; NOT a {@link WireBoardAuthError},
 * because this is a business-logic refusal, not an auth refusal.
 */
export class PaidPlanRequiredError extends WireBoardApiError {
  override name = 'PaidPlanRequiredError';

  constructor(opts: {
    message: string;
    fieldErrors: Record<string, string[]> | undefined;
    httpStatus: number;
    rateLimit: RateLimitInfo | undefined;
  }) {
    super({ ...opts, code: 'paid_plan_required' });
  }
}
