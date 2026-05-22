/**
 * Managed Live mode in React.
 *
 * Drop-in component that subscribes to a site's Live stream and re-renders
 * as state changes. The managed client handles snapshot + merge + JWT
 * rotation; React just owns presentation.
 *
 * In production, the bearer token must never ship to the browser. Mint a
 * short-lived subscriber JWT on your server and proxy its lifecycle. For
 * brevity this example takes the bearer as a prop.
 */

import { useEffect, useState } from 'react';
import {
  WireBoardClient,
  type LiveCategory,
  type ManagedLiveState,
} from '@wireboard/api';

// Module-scope default keeps a stable reference across renders so the
// useEffect below doesn't tear down + re-create the subscription (which
// would mint a new JWT) every time the parent re-renders.
const DEFAULT_CATEGORIES: LiveCategory[] = ['visitors', 'top_pages'];

interface LiveVisitorsProps {
  token: string;
  siteId: string;
  categories?: LiveCategory[];
}

export function LiveVisitors({
  token,
  siteId,
  categories = DEFAULT_CATEGORIES,
}: LiveVisitorsProps) {
  const [state, setState] = useState<ManagedLiveState | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // categories is intentionally read once per mount. Callers that need to
  // change it should remount the component (e.g. via a `key` prop) — a
  // mid-flight reconfigure would otherwise mint a fresh JWT on every parent
  // re-render that passed a new array literal.
  const initialCategories = categories;

  useEffect(() => {
    const wb = new WireBoardClient({ token });
    const live = wb.live({
      siteId,
      categories: initialCategories,
      onChange: setState,
      onError: setError,
    });
    void live.start();
    return () => live.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, siteId]);

  if (error) return <p>Live unavailable: {error.message}</p>;
  if (!state) return <p>Loading…</p>;

  return (
    <section>
      <p>
        Live now: <b>{state.live.visitors?.live ?? 0}</b>
        {' · returning: '}
        <b>{state.live.visitors?.returning ?? 0}</b>
      </p>
      <ul>
        {state.live.top_pages.slice(0, 10).map((p) => (
          <li key={p.url}>
            {p.title ?? p.url} — {p.count}
          </li>
        ))}
      </ul>
    </section>
  );
}
