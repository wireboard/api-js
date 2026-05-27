import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WireBoardClient } from '../src/client.js';
import {
  PaidPlanRequiredError,
  PlanHistoryLimitExceededError,
  WireBoardApiError,
  WireBoardAuthError,
} from '../src/errors.js';

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function captureFetch(
  responder: (call: RecordedCall) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: RecordedCall = { url, init };
    calls.push(call);
    return Promise.resolve(responder(call));
  }) as typeof fetch;
  return { fetch: fn, calls };
}

function jsonResp(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function envelope<T>(data: T): { status: true; data: T } {
  return { status: true, data };
}

describe('WireBoardClient — envelope unwrap', () => {
  it('returns data on success', async () => {
    const { fetch } = captureFetch(() => jsonResp(envelope({ email: 'sam@example.com', name: 'Sam', abilities: ['analytics:read'] })));
    const wb = new WireBoardClient({ token: 't', fetch });
    const a = await wb.account();
    expect(a.email).toBe('sam@example.com');
    expect(a.abilities).toEqual(['analytics:read']);
  });

  it('throws WireBoardApiError on error envelope', async () => {
    const { fetch } = captureFetch(() =>
      jsonResp(
        {
          status: false,
          errors: [{ text: 'site not found' }],
          fieldErrors: { error_code: ['site_not_found'] },
        },
        404,
      ),
    );
    const wb = new WireBoardClient({ token: 't', fetch });
    await expect(
      wb.aggregate({ site_id: 'xK4mP2nT', from: '2026-05-01', to: '2026-05-22' }),
    ).rejects.toMatchObject({
      name: 'WireBoardApiError',
      code: 'site_not_found',
      httpStatus: 404,
      message: 'site not found',
    });
  });

  it('throws WireBoardAuthError on 401 bare body', async () => {
    const { fetch } = captureFetch(() => jsonResp({ message: 'Unauthenticated.' }, 401));
    const wb = new WireBoardClient({ token: 't', fetch });
    await expect(wb.account()).rejects.toBeInstanceOf(WireBoardAuthError);
    await expect(wb.account()).rejects.toMatchObject({ httpStatus: 401, message: 'Unauthenticated.' });
  });

  it('throws WireBoardAuthError on 403 bare body', async () => {
    const { fetch } = captureFetch(() => jsonResp({ message: 'Invalid ability provided.' }, 403));
    const wb = new WireBoardClient({ token: 't', fetch });
    await expect(wb.account()).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('throws PlanHistoryLimitExceededError on 422 with that error_code', async () => {
    const { fetch } = captureFetch(() => jsonResp({
      status: false,
      errors: [{ text: 'Your plan limits historical queries to the last 30 days. Upgrade for full history.' }],
      fieldErrors: {
        error_code: ['plan_history_limit_exceeded'],
        earliest_allowed: ['2026-04-24'],
      },
    }, 422));
    const wb = new WireBoardClient({ token: 't', fetch });

    const promise = wb.aggregate({ site_id: 'xK4mP2nT', from: '2020-01-01', to: '2026-05-23' });

    await expect(promise).rejects.toBeInstanceOf(PlanHistoryLimitExceededError);
    await expect(promise).rejects.toBeInstanceOf(WireBoardApiError); // subclass still matches the parent
    await expect(promise).rejects.toMatchObject({
      code: 'plan_history_limit_exceeded',
      httpStatus: 422,
      earliestAllowed: '2026-04-24',
    });
  });

  it('throws PaidPlanRequiredError on 403 with that error_code (NOT WireBoardAuthError)', async () => {
    const { fetch } = captureFetch(() => jsonResp({
      status: false,
      errors: [{ text: 'This endpoint requires a paid plan. Upgrade to access the Live API.' }],
      fieldErrors: { error_code: ['paid_plan_required'] },
    }, 403));
    const wb = new WireBoardClient({ token: 't', fetch });

    const promise = wb.liveToken({ sites: ['xK4mP2nT'] });

    await expect(promise).rejects.toBeInstanceOf(PaidPlanRequiredError);
    await expect(promise).rejects.toBeInstanceOf(WireBoardApiError);
    // Critically: this is NOT an auth error, even though the HTTP status is 403.
    await expect(promise).rejects.not.toBeInstanceOf(WireBoardAuthError);
    await expect(promise).rejects.toMatchObject({
      code: 'paid_plan_required',
      httpStatus: 403,
    });
  });
});

describe('WireBoardClient — headers', () => {
  it('sends Authorization, Accept, X-WireBoard-Client', async () => {
    const { fetch, calls } = captureFetch(() => jsonResp(envelope({})));
    const wb = new WireBoardClient({ token: 'abc-xyz', fetch });
    await wb.account();
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer abc-xyz');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['X-WireBoard-Client']).toMatch(/^@wireboard\/api\//);
  });
});

describe('WireBoardClient — rate limit', () => {
  it('retries once on 429 honoring Retry-After', async () => {
    let calls = 0;
    const { fetch } = captureFetch(() => {
      calls++;
      if (calls === 1) {
        return jsonResp({ message: 'too many' }, 429, { 'Retry-After': '0' });
      }
      return jsonResp(envelope({ email: 's', name: 'S', abilities: [] }));
    });
    const wb = new WireBoardClient({ token: 't', fetch });
    const a = await wb.account();
    expect(a.email).toBe('s');
    expect(calls).toBe(2);
  });

  it('does not retry when retryOn429=false', async () => {
    let calls = 0;
    const { fetch } = captureFetch(() => {
      calls++;
      return jsonResp({ message: 'too many' }, 429, { 'Retry-After': '0' });
    });
    const wb = new WireBoardClient({ token: 't', fetch, retryOn429: false });
    await expect(wb.account()).rejects.toMatchObject({ httpStatus: 429 });
    expect(calls).toBe(1);
  });

  it('attaches rateLimit info to thrown error after second 429', async () => {
    const { fetch } = captureFetch(() =>
      jsonResp({ message: 'too many' }, 429, {
        'Retry-After': '0',
        'X-RateLimit-Limit': '120',
        'X-RateLimit-Remaining': '0',
      }),
    );
    const wb = new WireBoardClient({ token: 't', fetch });
    try {
      await wb.account();
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WireBoardApiError);
      const apiErr = err as WireBoardApiError;
      expect(apiErr.rateLimit?.limit).toBe(120);
      expect(apiErr.rateLimit?.remaining).toBe(0);
      expect(apiErr.rateLimit?.retryAfter).toBe(0);
    }
  });

  it('caps Retry-After at 60s so a hostile or buggy server can\'t pin the client', async () => {
    // The transport reads Retry-After and waits that many seconds before
    // its single retry. If the server sends `Retry-After: 86400` we must
    // not actually sleep for a day — clamp to MAX_RETRY_AFTER_SECONDS=60.
    // Fake timers let us observe the requested sleep without waiting it out.
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { fetch } = captureFetch(() => {
        calls++;
        if (calls === 1) {
          return jsonResp({ message: 'too many' }, 429, { 'Retry-After': '86400' });
        }
        return jsonResp(envelope({ email: 's', name: 'S', abilities: [] }));
      });
      const wb = new WireBoardClient({ token: 't', fetch });
      const pending = wb.account();

      // Drain the first fetch + safeJson() microtasks.
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);

      // 59 999 ms in — must still be sleeping, not retried yet.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(calls).toBe(1);

      // Crossing 60 000 ms releases the retry; the server returns success.
      await vi.advanceTimersByTimeAsync(2);
      const a = await pending;
      expect(a.email).toBe('s');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats envelope-style 429 (concurrent_limit_reached) as WireBoardApiError with code', async () => {
    let calls = 0;
    const { fetch } = captureFetch(() => {
      calls++;
      return jsonResp(
        {
          status: false,
          errors: [{ text: 'Too many concurrent live subscriptions.' }],
          fieldErrors: { error_code: ['concurrent_limit_reached'] },
        },
        429,
        { 'Retry-After': '0' },
      );
    });
    const wb = new WireBoardClient({ token: 't', fetch });
    await expect(wb.liveToken()).rejects.toMatchObject({
      httpStatus: 429,
      code: 'concurrent_limit_reached',
    });
    expect(calls).toBe(2); // one retry
  });
});

describe('WireBoardClient — REST URLs', () => {
  it('encodes aggregate params correctly', async () => {
    const { fetch, calls } = captureFetch(() => jsonResp(envelope({ visitors: 0, pageviews: 0, bounce_rate: 0, visit_duration: 0 })));
    const wb = new WireBoardClient({ token: 't', fetch });
    await wb.aggregate({ site_id: 'xK4mP2nT', from: '2026-05-01', to: '2026-05-22' });
    expect(calls[0]?.url).toContain('/v1/analytics/aggregate?');
    expect(calls[0]?.url).toContain('site_id=xK4mP2nT');
    expect(calls[0]?.url).toContain('from=2026-05-01');
    expect(calls[0]?.url).toContain('to=2026-05-22');
  });

  it('serialises event filters', async () => {
    const { fetch, calls } = captureFetch(() => jsonResp(envelope({ rows: [], total: 0, group_by: ['category'], limit: 50, offset: 0 })));
    const wb = new WireBoardClient({ token: 't', fetch });
    await wb.events({
      site_id: 'xK4mP2nT',
      from: '2026-05-01',
      to: '2026-05-22',
      filter: { category: 'Purchase', props: { plan: 'pro' } },
      group_by: ['category', 'utm_source'],
    });
    const decoded = decodeURIComponent(calls[0]!.url);
    expect(decoded).toContain('filter[category]=Purchase');
    expect(decoded).toContain('filter[props.plan]=pro');
    expect(decoded).toContain('group_by=category,utm_source');
  });

  it('converts Date inputs to YYYY-MM-DD', async () => {
    const { fetch, calls } = captureFetch(() => jsonResp(envelope({ points: [] })));
    const wb = new WireBoardClient({ token: 't', fetch });
    await wb.history({
      site_id: 'xK4mP2nT',
      from: new Date(Date.UTC(2026, 4, 1)),
      to: new Date(Date.UTC(2026, 4, 22)),
    });
    expect(calls[0]?.url).toContain('from=2026-05-01');
    expect(calls[0]?.url).toContain('to=2026-05-22');
  });
});

describe('WireBoardClient — liveState normalization', () => {
  // The production server returns `live` as an array of {category, ts, data}
  // envelopes; the public spec documents it as a per-category map. The SDK
  // accepts either shape at the boundary and normalises to the documented
  // map shape. These tests cover both server behaviours.

  it('normalises the array-of-envelopes shape (current production server) to a map', async () => {
    const { fetch } = captureFetch(() =>
      jsonResp(envelope({
        site_id: 'xK4mP2nT',
        ts: '2026-05-23T01:02:37.519Z',
        live: [
          { category: 'visitors',  ts: '2026-05-23T01:02:37.519Z', data: { live: 5, returning: 2 } },
          { category: 'top_pages', ts: '2026-05-23T01:02:37.519Z', data: [{ url: '/a', title: 'A', count: 3 }] },
        ],
        max_30d: 12,
        max_30d_at: '2026-05-22',
      })),
    );
    const wb = new WireBoardClient({ token: 't', fetch });

    const snap = await wb.liveState({ site_id: 'xK4mP2nT', categories: ['visitors', 'top_pages'] });

    expect(snap.live).toEqual({
      visitors:  { live: 5, returning: 2 },
      top_pages: [{ url: '/a', title: 'A', count: 3 }],
    });
    expect(snap.max_30d).toBe(12);
  });

  it('passes through the map shape (spec-compliant server) unchanged', async () => {
    const { fetch } = captureFetch(() =>
      jsonResp(envelope({
        site_id: 'xK4mP2nT',
        ts: '2026-05-23T01:02:37.519Z',
        live: {
          visitors:  { live: 6, returning: 1 },
          top_pages: [{ url: '/b', title: 'B', count: 2 }],
        },
        max_30d: null,
        max_30d_at: null,
      })),
    );
    const wb = new WireBoardClient({ token: 't', fetch });

    const snap = await wb.liveState({ site_id: 'xK4mP2nT', categories: ['visitors', 'top_pages'] });

    expect(snap.live).toEqual({
      visitors:  { live: 6, returning: 1 },
      top_pages: [{ url: '/b', title: 'B', count: 2 }],
    });
  });

  it('normalises an empty array to an empty map', async () => {
    const { fetch } = captureFetch(() =>
      jsonResp(envelope({
        site_id: 'xK4mP2nT',
        ts: '2026-05-23T01:02:37.519Z',
        live: [],
        max_30d: null,
        max_30d_at: null,
      })),
    );
    const wb = new WireBoardClient({ token: 't', fetch });

    const snap = await wb.liveState({ site_id: 'xK4mP2nT' });

    expect(snap.live).toEqual({});
  });
});

describe('WireBoardClient — withMeta', () => {
  it('returns data and rate-limit headers', async () => {
    const { fetch } = captureFetch(() =>
      jsonResp(envelope({ email: 's', name: 'S', abilities: [] }), 200, {
        'X-RateLimit-Limit': '120',
        'X-RateLimit-Remaining': '117',
      }),
    );
    const wb = new WireBoardClient({ token: 't', fetch });
    const { data, rateLimit } = await wb.withMeta((c) => c.account());
    expect(data.email).toBe('s');
    expect(rateLimit?.limit).toBe(120);
    expect(rateLimit?.remaining).toBe(117);
  });

  it('captures only calls on the closure client, not the outer client', async () => {
    let remaining = 100;
    const { fetch } = captureFetch(() => {
      const r = remaining--;
      return jsonResp(envelope({ email: 's', name: 'S', abilities: [] }), 200, {
        'X-RateLimit-Remaining': String(r),
      });
    });
    const wb = new WireBoardClient({ token: 't', fetch });
    const { rateLimit } = await wb.withMeta(async (_c) => {
      await wb.account(); // outer — should NOT be captured
      return null;
    });
    expect(rateLimit).toBeUndefined();
  });

  it('concurrent withMeta calls do not interfere', async () => {
    let counter = 50;
    const { fetch } = captureFetch(() => {
      const r = counter++;
      return jsonResp(envelope({ email: 's', name: 'S', abilities: [] }), 200, {
        'X-RateLimit-Remaining': String(r),
      });
    });
    const wb = new WireBoardClient({ token: 't', fetch });
    const [a, b] = await Promise.all([
      wb.withMeta((c) => c.account()),
      wb.withMeta((c) => c.account()),
    ]);
    expect(a.rateLimit?.remaining).toBeTypeOf('number');
    expect(b.rateLimit?.remaining).toBeTypeOf('number');
    expect(a.rateLimit?.remaining).not.toBe(b.rateLimit?.remaining);
  });
});

describe('WireBoardClient — abort', () => {
  it('propagates AbortSignal to fetch', async () => {
    const fn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void input;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        });
      });
    }) as typeof fetch;
    const wb = new WireBoardClient({ token: 't', fetch: fn });
    const controller = new AbortController();
    const p = wb.account({ signal: controller.signal });
    controller.abort(new DOMException('user cancelled', 'AbortError'));
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('WireBoardClient — validation', () => {
  it('throws on invalid date string before issuing request', async () => {
    const { fetch, calls } = captureFetch(() => jsonResp(envelope({})));
    const wb = new WireBoardClient({ token: 't', fetch });
    await expect(
      wb.aggregate({ site_id: 'x', from: '2026/05/01', to: '2026-05-22' }),
    ).rejects.toThrow(TypeError);
    expect(calls.length).toBe(0);
  });

  it('throws on missing token', () => {
    expect(() => new WireBoardClient({ token: '' as string })).toThrow(TypeError);
  });
});
