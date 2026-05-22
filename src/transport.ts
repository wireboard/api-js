import { WireBoardApiError, WireBoardAuthError } from './errors.js';
import { serializeParams } from './serialize.js';
import type { RateLimitInfo } from './types.js';
import { VERSION } from './version.js';

export interface TransportOptions {
  token: string;
  baseUrl: string;
  fetch: typeof fetch;
  retryOn429: boolean;
}

export type ResponseHook = (info: RateLimitInfo) => void;

interface SuccessEnvelope<T> {
  status: true;
  data: T;
}

interface ErrorEnvelope {
  status?: false;
  errors?: { text?: string }[];
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

export class Transport {
  private responseHook: ResponseHook | null = null;

  constructor(private readonly opts: TransportOptions) {}

  setResponseHook(hook: ResponseHook | null): void {
    this.responseHook = hook;
  }

  async get<T>(
    path: string,
    params?: object,
    opts?: { signal?: AbortSignal },
  ): Promise<T> {
    return this.request<T>(path, params, opts, false);
  }

  private async request<T>(
    path: string,
    params: object | undefined,
    opts: { signal?: AbortSignal } | undefined,
    didRetry: boolean,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.token}`,
      Accept: 'application/json',
      'X-WireBoard-Client': `@wireboard/api/${VERSION}`,
    };

    const fetchInit: RequestInit = { headers };
    if (opts?.signal) fetchInit.signal = opts.signal;

    const res = await this.opts.fetch(url, fetchInit);
    const rateLimit = parseRateLimit(res);

    if (res.status === 429 && this.opts.retryOn429 && !didRetry) {
      const wait = (rateLimit.retryAfter ?? 5) * 1000;
      await drain(res);
      await sleep(wait, opts?.signal);
      return this.request<T>(path, params, opts, true);
    }

    if (res.status === 401 || res.status === 403) {
      const body = (await safeJson(res)) as { message?: string };
      throw new WireBoardAuthError(body?.message ?? `HTTP ${res.status}`, res.status);
    }

    const body = await safeJson(res);
    if (body === undefined) {
      throw new WireBoardApiError({
        message: `HTTP ${res.status}: invalid JSON response`,
        code: null,
        fieldErrors: undefined,
        httpStatus: res.status,
        rateLimit,
      });
    }

    const success = body as Partial<SuccessEnvelope<T>>;
    if (success.status === true) {
      this.responseHook?.(rateLimit);
      return success.data as T;
    }

    const err = body as ErrorEnvelope;
    const code = err.fieldErrors?.['error_code']?.[0] ?? null;
    const message =
      err.errors?.[0]?.text ?? err.message ?? `HTTP ${res.status}`;
    throw new WireBoardApiError({
      message,
      code,
      fieldErrors: err.fieldErrors,
      httpStatus: res.status,
      rateLimit,
    });
  }

  private buildUrl(path: string, params?: object): string {
    const base = this.opts.baseUrl.replace(/\/$/, '');
    if (!params) return `${base}${path}`;
    const query = serializeParams(params);
    return query ? `${base}${path}?${query}` : `${base}${path}`;
  }
}

function parseRateLimit(res: Response): RateLimitInfo {
  return {
    limit: numOrNull(res.headers.get('X-RateLimit-Limit')),
    remaining: numOrNull(res.headers.get('X-RateLimit-Remaining')),
    retryAfter: numOrNull(res.headers.get('Retry-After')),
  };
}

function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function drain(res: Response): Promise<void> {
  try {
    await res.text();
  } catch {
    // intentional
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
