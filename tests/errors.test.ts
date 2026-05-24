import { describe, expect, it } from 'vitest';
import {
  PaidPlanRequiredError,
  PlanHistoryLimitExceededError,
  WireBoardApiError,
  WireBoardAuthError,
} from '../src/errors.js';

describe('WireBoardApiError', () => {
  it('captures code, fieldErrors, httpStatus, rateLimit', () => {
    const err = new WireBoardApiError({
      message: 'site not found',
      code: 'site_not_found',
      fieldErrors: { error_code: ['site_not_found'] },
      httpStatus: 404,
      rateLimit: { limit: 120, remaining: 117, retryAfter: null },
    });
    expect(err.message).toBe('site not found');
    expect(err.code).toBe('site_not_found');
    expect(err.fieldErrors).toEqual({ error_code: ['site_not_found'] });
    expect(err.httpStatus).toBe(404);
    expect(err.rateLimit).toEqual({ limit: 120, remaining: 117, retryAfter: null });
    expect(err.name).toBe('WireBoardApiError');
    expect(err).toBeInstanceOf(Error);
  });

  it('allows null code for plain validation errors', () => {
    const err = new WireBoardApiError({
      message: 'invalid',
      code: null,
      fieldErrors: { site_id: ['required'] },
      httpStatus: 422,
      rateLimit: undefined,
    });
    expect(err.code).toBeNull();
    expect(err.fieldErrors?.['site_id']).toEqual(['required']);
  });
});

describe('WireBoardAuthError', () => {
  it('captures httpStatus 401', () => {
    const err = new WireBoardAuthError('Unauthenticated.', 401);
    expect(err.httpStatus).toBe(401);
    expect(err.name).toBe('WireBoardAuthError');
  });

  it('captures httpStatus 403', () => {
    const err = new WireBoardAuthError('Invalid ability provided.', 403);
    expect(err.httpStatus).toBe(403);
  });
});

describe('PlanHistoryLimitExceededError', () => {
  it('is a subclass of WireBoardApiError, code is locked, earliestAllowed parses fieldErrors', () => {
    const err = new PlanHistoryLimitExceededError({
      message: 'Your plan limits historical queries to the last 30 days.',
      fieldErrors: {
        error_code: ['plan_history_limit_exceeded'],
        earliest_allowed: ['2026-04-24'],
      },
      httpStatus: 422,
      rateLimit: undefined,
    });
    expect(err).toBeInstanceOf(WireBoardApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('plan_history_limit_exceeded');
    expect(err.earliestAllowed).toBe('2026-04-24');
    expect(err.httpStatus).toBe(422);
    expect(err.name).toBe('PlanHistoryLimitExceededError');
  });

  it('earliestAllowed is null when the server omits the field', () => {
    const err = new PlanHistoryLimitExceededError({
      message: 'plan limit',
      fieldErrors: { error_code: ['plan_history_limit_exceeded'] },
      httpStatus: 422,
      rateLimit: undefined,
    });
    expect(err.earliestAllowed).toBeNull();
  });
});

describe('PaidPlanRequiredError', () => {
  it('is a subclass of WireBoardApiError (NOT WireBoardAuthError) with locked code', () => {
    const err = new PaidPlanRequiredError({
      message: 'This endpoint requires a paid plan. Upgrade to access the Live API.',
      fieldErrors: { error_code: ['paid_plan_required'] },
      httpStatus: 403,
      rateLimit: undefined,
    });
    expect(err).toBeInstanceOf(WireBoardApiError);
    expect(err).not.toBeInstanceOf(WireBoardAuthError);
    expect(err.code).toBe('paid_plan_required');
    expect(err.httpStatus).toBe(403);
    expect(err.name).toBe('PaidPlanRequiredError');
  });
});
