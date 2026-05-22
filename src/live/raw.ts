import { LIVE_CATEGORIES } from '../constants.js';
import type { LiveCategory } from '../constants.js';
import type { LiveClientStatus, LiveRawOptions } from '../types.js';
import { Subscription, type LiveMinter } from './subscription.js';

/**
 * Low-level Live client. Delivers each raw SSE envelope to `onEvent`; merge
 * logic is the customer's responsibility.
 *
 * Use this for multi-site subscriptions, custom state shapes, or when you
 * want full control over how drop signals are applied. For single-site
 * managed state, use {@link LiveClient} instead.
 */
export class LiveRawClient {
  private readonly sub: Subscription;

  constructor(minter: LiveMinter, options: LiveRawOptions) {
    const sites = typeof options.sites === 'string' ? [options.sites] : options.sites;
    if (sites.length === 0) {
      throw new TypeError('LiveRawClient: at least one site is required.');
    }
    const categories: LiveCategory[] = options.categories ?? Array.from(LIVE_CATEGORIES);

    this.sub = new Subscription(minter, {
      sites,
      categories,
      onEvent: options.onEvent,
      onError: options.onError,
      onRotate: options.onRotate,
      onReconnect: options.onReconnect,
      beforeHardReconnect: undefined,
    });
  }

  /**
   * Current connection status.
   *
   * Lifecycle: `'idle'` → `'connecting'` → `'open'` ↔ `'connecting'` (on
   * reconnect) → `'closed'` (after `stop()`).
   */
  get status(): LiveClientStatus {
    return this.sub.status;
  }

  /**
   * Mint a JWT and open the SSE connection.
   *
   * Idempotent: calling while `'open'` resolves immediately; while
   * `'connecting'` returns the in-flight promise. Calling after `stop()` is
   * a fresh start.
   *
   * Rejects with the underlying error if the initial mint or open fails; the
   * client transitions to `'closed'` on failure.
   */
  start(): Promise<void> {
    return this.sub.start();
  }

  /**
   * Close the connection. Safe to call multiple times. If invoked
   * mid-`start()`, the pending `start()` promise rejects with an
   * `AbortError` and status transitions to `'closed'`.
   */
  stop(): void {
    this.sub.stop();
  }
}
