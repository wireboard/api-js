import type { LiveCategory } from '../constants.js';
import type {
  LiveClientStatus,
  LiveEnvelope,
  LiveTokenResult,
} from '../types.js';
import { getEventSource } from './eventsource.js';

/**
 * Narrow interface the subscription uses to mint JWTs and fetch snapshots.
 * Implemented by {@link WireBoardClient}; kept narrow to avoid a runtime
 * circular import.
 */
export interface LiveMinter {
  liveToken(
    params?: { sites?: string[]; categories?: LiveCategory[] },
    opts?: { signal?: AbortSignal },
  ): Promise<LiveTokenResult>;
}

export interface SubscriptionOptions {
  sites: string[];
  categories: LiveCategory[];
  onEvent: (env: LiveEnvelope) => void;
  onError: ((err: Error) => void) | undefined;
  onRotate: (() => void) | undefined;
  /**
   * Fires once per successful hard-reconnect after the new connection's
   * `open` event. NOT fired for the initial connect (that's `start()`
   * resolving) or for rotation (that's `onRotate`). Useful for surfacing
   * silent reconnects in customer dashboards or test runners.
   */
  onReconnect: (() => void) | undefined;
  /**
   * Awaited before a hard reconnect's new connection opens. Used by the
   * managed client to refetch the snapshot. Receives an AbortSignal that
   * fires if the subscription is stopped while this is pending.
   */
  beforeHardReconnect: ((opts: { signal: AbortSignal }) => Promise<void>) | undefined;
}

const ROTATION_LEAD_SECONDS = 60;
const OVERLAP_MS = 1000;
const HARD_RECONNECT_BACKOFF_MS = 500;
const ROTATION_RETRY_MS = 5_000;
const ROTATION_MAX_RETRIES = 1;
const RECENT_IDS_LIMIT = 4_096;

/**
 * Internal SSE subscription engine. Handles JWT minting, Pattern B zero-gap
 * rotation with `lastEventId` dedupe, hard reconnect with snapshot refetch
 * hook, and lifecycle (start / stop / idempotent / fresh-restart).
 *
 * Used by both {@link LiveRawClient} and {@link LiveClient}.
 */
export class Subscription {
  status: LiveClientStatus = 'idle';

  private currentEs: EventSource | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Insertion-ordered set of recently-seen lastEventIds. Map preserves
   * insertion order natively, so first-key eviction is O(1).
   */
  private seenIds = new Map<string, true>();
  private abort: AbortController | null = null;
  private rotationRetries = 0;
  /**
   * True once any connection has successfully opened in this lifecycle.
   * Used to distinguish the initial open (which resolves `start()`) from
   * subsequent hard-reconnect opens (which fire `onReconnect`). Reset on
   * `stop()` so a restart-after-stop sequence behaves like a fresh start.
   */
  private hasOpenedBefore = false;

  private startPromise: Promise<void> | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((err: unknown) => void) | null = null;
  private startSettled = false;

  /**
   * Lifecycle generation. Incremented on every `start()` and `stop()`.
   * Each EventSource's handler closures capture the generation in effect
   * when they were registered and short-circuit if it no longer matches —
   * guards against the queued-handler-from-previous-lifecycle race when a
   * caller stops and restarts before an in-flight `'open'` or `'message'`
   * has run.
   */
  private generation = 0;

  constructor(
    private readonly minter: LiveMinter,
    private readonly opts: SubscriptionOptions,
  ) {}

  async start(): Promise<void> {
    if (this.status === 'open') return;
    if (this.status === 'connecting' && this.startPromise) return this.startPromise;

    this.generation++;
    this.status = 'connecting';
    this.abort = new AbortController();
    this.startSettled = false;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });

    try {
      await this.mintAndOpen(false);
    } catch (err) {
      this.rejectStart(err);
      this.status = 'closed';
      throw err;
    }
    return this.startPromise;
  }

  stop(): void {
    if (this.status === 'closed') return;
    this.generation++;
    const wasPending = this.status === 'connecting';
    this.status = 'closed';
    this.clearTimer('rotateTimer');
    this.clearTimer('reconnectTimer');
    if (this.abort) {
      this.abort.abort(new DOMException('Aborted', 'AbortError'));
      this.abort = null;
    }
    if (this.currentEs) {
      this.currentEs.close();
      this.currentEs = null;
    }
    this.hasOpenedBefore = false;
    if (wasPending) {
      this.rejectStart(new DOMException('Aborted', 'AbortError'));
    }
  }

  private isClosed(): boolean {
    return this.status === 'closed';
  }

  private clearTimer(name: 'rotateTimer' | 'reconnectTimer'): void {
    const t = this[name];
    if (t !== null) {
      clearTimeout(t);
      this[name] = null;
    }
  }

  private resolveStart(): void {
    if (this.startSettled) return;
    this.startSettled = true;
    this.startResolve?.();
  }

  private rejectStart(err: unknown): void {
    if (this.startSettled) return;
    this.startSettled = true;
    this.startReject?.(err);
  }

  private async mintAndOpen(isRotation: boolean): Promise<void> {
    if (this.isClosed()) return;
    const signal = this.abort?.signal;
    const token = await this.minter.liveToken(
      { sites: this.opts.sites, categories: this.opts.categories },
      signal ? { signal } : undefined,
    );
    if (this.isClosed()) return;
    this.openStream(token, isRotation);
  }

  private openStream(token: LiveTokenResult, isRotation: boolean): void {
    if (this.isClosed()) return;
    const url = buildStreamUrl(token);
    const ES = getEventSource();
    const es = new ES(url);
    const ownGeneration = this.generation;
    let promoted = false;
    let torndown = false;

    const isStale = (): boolean => ownGeneration !== this.generation;

    const handleMessage = (ev: MessageEvent): void => {
      if (isStale() || this.isClosed()) return;
      if (ev.lastEventId) {
        if (this.seenIds.has(ev.lastEventId)) return;
        this.recordSeenId(ev.lastEventId);
      }
      let envelope: LiveEnvelope;
      try {
        envelope = JSON.parse(ev.data) as LiveEnvelope;
      } catch (err) {
        this.emitError(err);
        return;
      }
      try {
        this.opts.onEvent(envelope);
      } catch (err) {
        this.emitError(err);
      }
    };

    const handleOpen = (): void => {
      if (isStale() || this.isClosed()) {
        es.close();
        return;
      }
      promoted = true;
      this.rotationRetries = 0;
      const old = this.currentEs;
      this.currentEs = es;
      this.status = 'open';
      if (old && old !== es) {
        setTimeout(() => old.close(), OVERLAP_MS);
      }
      if (isRotation) {
        this.opts.onRotate?.();
      } else if (this.hasOpenedBefore) {
        // A non-rotation open that isn't the first one is a hard-reconnect's
        // new connection coming up. Surface it so customers can see silent
        // recoveries (e.g. infra-imposed connection lifetime caps).
        this.opts.onReconnect?.();
      } else {
        this.resolveStart();
      }
      this.hasOpenedBefore = true;
      this.scheduleRotation(token.expires_in);
    };

    const handleError = (): void => {
      if (torndown) return;
      if (isStale()) {
        torndown = true;
        es.close();
        return;
      }
      if (this.isClosed()) return;
      // Take over reconnection from the underlying EventSource immediately:
      // its built-in retry would silently keep our state stale (drop signals
      // missed during the gap are unrecoverable without a snapshot refetch).
      // `torndown` dedupes subsequent error fires on this same instance.
      torndown = true;
      es.close();

      if (!promoted) {
        // This connection never opened.
        if (isRotation && this.currentEs && this.currentEs !== es) {
          // The previous connection is still alive — keep using it and
          // retry the rotation. The old JWT will expire on its own if we
          // can't recover before then; at that point the old will error and
          // we'll hard-reconnect.
          this.emitError(new Error('JWT rotation failed to open new connection; old still active'));
          this.scheduleRotationRetry();
          return;
        }
        // Either initial connect failed or we have no fallback connection.
        this.hardReconnect();
        return;
      }

      if (es !== this.currentEs) {
        // A successor has already replaced this one; let it die quietly.
        return;
      }

      // The current connection died.
      this.hardReconnect();
    };

    es.addEventListener('message', handleMessage as EventListener);
    es.addEventListener('open', handleOpen);
    es.addEventListener('error', handleError);
  }

  private recordSeenId(id: string): void {
    this.seenIds.set(id, true);
    if (this.seenIds.size > RECENT_IDS_LIMIT) {
      const oldest = this.seenIds.keys().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
  }

  private scheduleRotation(expiresInSeconds: number): void {
    this.clearTimer('rotateTimer');
    const leadMs = Math.max(0, (expiresInSeconds - ROTATION_LEAD_SECONDS) * 1000);
    this.rotateTimer = setTimeout(() => {
      this.rotateTimer = null;
      this.mintAndOpen(true).catch((err) => {
        this.emitError(err);
        // Mint failed (e.g. transient network). If the current connection
        // is still up, retry rotation; otherwise hard-reconnect.
        if (this.currentEs && !this.isClosed()) {
          this.scheduleRotationRetry();
        } else {
          this.hardReconnect();
        }
      });
    }, leadMs);
  }

  private scheduleRotationRetry(): void {
    if (this.isClosed()) return;
    if (this.rotationRetries >= ROTATION_MAX_RETRIES) {
      // Give up rotating; tear down and reconnect from scratch.
      this.hardReconnect();
      return;
    }
    this.rotationRetries++;
    this.clearTimer('rotateTimer');
    this.rotateTimer = setTimeout(() => {
      this.rotateTimer = null;
      this.mintAndOpen(true).catch((err) => {
        this.emitError(err);
        if (this.currentEs && !this.isClosed()) {
          this.scheduleRotationRetry();
        } else {
          this.hardReconnect();
        }
      });
    }, ROTATION_RETRY_MS);
  }

  private hardReconnect(): void {
    if (this.isClosed()) return;
    this.clearTimer('rotateTimer');
    if (this.currentEs) {
      this.currentEs.close();
      this.currentEs = null;
    }
    this.status = 'connecting';
    this.clearTimer('reconnectTimer');
    this.reconnectTimer = setTimeout(() => {
      void this.performHardReconnect();
    }, HARD_RECONNECT_BACKOFF_MS);
  }

  private async performHardReconnect(): Promise<void> {
    this.reconnectTimer = null;
    if (this.isClosed()) return;
    try {
      if (this.opts.beforeHardReconnect && this.abort) {
        await this.opts.beforeHardReconnect({ signal: this.abort.signal });
      }
      if (this.isClosed()) return;
      await this.mintAndOpen(false);
    } catch (err) {
      this.emitError(err);
      this.status = 'closed';
      this.rejectStart(err);
    }
  }

  private emitError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    try {
      this.opts.onError?.(error);
    } catch {
      // Listener errors must not break the subscription.
    }
  }
}

function buildStreamUrl(token: LiveTokenResult): string {
  const u = new URL(token.hub_url);
  for (const topic of token.topics) u.searchParams.append('topic', topic);
  u.searchParams.append('authorization', token.token);
  return u.toString();
}
