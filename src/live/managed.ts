import { LIVE_CATEGORIES } from '../constants.js';
import type { LiveCategory } from '../constants.js';
import type {
  LiveClientStatus,
  LiveEnvelope,
  LiveOptions,
  LiveStateSnapshot,
  ManagedLiveState,
} from '../types.js';
import { applyEvent, emptyState, fromSnapshot } from './merge.js';
import { Subscription, type LiveMinter } from './subscription.js';

interface ManagedMinter extends LiveMinter {
  liveState(
    params: { site_id: string; categories?: LiveCategory[] },
    opts?: { signal?: AbortSignal },
  ): Promise<LiveStateSnapshot>;
}

/**
 * Managed Live client. Maintains merged state per category internally —
 * customers read state via {@link LiveClient.subscribe} or the
 * {@link LiveClient.state} getter and never see drop signals directly.
 *
 * Single-site only. For multi-site, instantiate one `LiveClient` per site or
 * use {@link LiveRawClient}.
 *
 * The SDK handles snapshot refetch on (re)connect, drop-signal merging per
 * category, JWT rotation (zero-gap overlap with `lastEventId` dedup), and
 * lifecycle.
 */
export class LiveClient {
  private readonly minter: ManagedMinter;
  private readonly siteId: string;
  private readonly categories: LiveCategory[];
  private readonly sub: Subscription;
  private readonly listeners = new Set<(state: ManagedLiveState) => void>();
  private readonly onEventHook: ((env: LiveEnvelope) => void) | undefined;
  private _state: ManagedLiveState;
  private startPromise: Promise<void> | null = null;
  private startAbort: AbortController | null = null;

  constructor(minter: ManagedMinter, options: LiveOptions) {
    if (!options.siteId) {
      throw new TypeError('LiveClient: `siteId` is required.');
    }
    this.minter = minter;
    this.siteId = options.siteId;
    this.categories = options.categories ?? Array.from(LIVE_CATEGORIES);
    this.onEventHook = options.onEvent;
    this._state = emptyState(this.siteId);

    this.sub = new Subscription(minter, {
      sites: [this.siteId],
      categories: this.categories,
      onEvent: (env: LiveEnvelope) => this.applyEnvelope(env),
      onError: options.onError,
      onRotate: options.onRotate,
      onReconnect: options.onReconnect,
      beforeHardReconnect: ({ signal }) => this.refetchSnapshot(signal),
    });

    if (options.onChange) this.listeners.add(options.onChange);
  }

  /**
   * Current merged state.
   *
   * A NEW object reference is produced on every update — `prev !== next` is
   * a sound change check. Sub-objects (e.g. `state.live.top_pages`) are
   * reused when unchanged.
   */
  get state(): ManagedLiveState {
    return this._state;
  }

  /** Current connection status. See {@link LiveRawClient.status}. */
  get status(): LiveClientStatus {
    return this.sub.status;
  }

  /**
   * Fetch the initial snapshot, mint a JWT, and open the stream.
   *
   * Idempotent: concurrent calls share the same in-flight promise. Calling
   * after `stop()` is a fresh start (full snapshot refetch + mint + open).
   */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.sub.status === 'open') return;

    this.startAbort = new AbortController();
    const signal = this.startAbort.signal;
    this.startPromise = this.performStart(signal);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
      this.startAbort = null;
    }
  }

  /**
   * Close the stream. Safe to call multiple times. If invoked mid-`start()`,
   * the in-flight snapshot fetch and JWT mint are aborted cleanly and the
   * `start()` promise rejects with an `AbortError`.
   */
  stop(): void {
    if (this.startAbort) {
      this.startAbort.abort(new DOMException('Aborted', 'AbortError'));
    }
    this.sub.stop();
  }

  /**
   * Listen for state updates. Returns an unsubscribe function. The listener
   * receives the new state object on every change.
   */
  subscribe(listener: (state: ManagedLiveState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async performStart(signal: AbortSignal): Promise<void> {
    await this.refetchSnapshot(signal);
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    await this.sub.start();
  }

  private async refetchSnapshot(signal?: AbortSignal): Promise<void> {
    const snapshot = await this.minter.liveState(
      { site_id: this.siteId, categories: this.categories },
      signal ? { signal } : undefined,
    );
    this._state = fromSnapshot(snapshot);
    this.notify();
  }

  private applyEnvelope(env: LiveEnvelope): void {
    if (env.site_id !== this.siteId) return;
    if (this.onEventHook) {
      try {
        this.onEventHook(env);
      } catch {
        // Instrumentation listener errors must not break the subscription.
      }
    }
    this._state = applyEvent(this._state, env);
    this.notify();
  }

  private notify(): void {
    const snapshot = this._state;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener errors must not break the subscription.
      }
    }
  }
}
