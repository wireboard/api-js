import { describe, expect, it } from 'vitest';
import { WireBoardApiError, WireBoardAuthError } from '../src/errors.js';

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
