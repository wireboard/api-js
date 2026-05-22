/**
 * Raw Live mode across multiple sites.
 *
 * Opens one SSE connection that streams events for up to 3 of your sites.
 * Each envelope carries `site_id`, so you can route it to per-site state in
 * your own store. Use raw mode when you have your own reactive layer or
 * when a single managed (single-site) client doesn't fit.
 *
 * Run:  WIREBOARD_TOKEN=… npx tsx examples/raw-multi-site-node.ts
 */

import { WireBoardClient, type LiveEnvelope } from '@wireboard/api';

async function main(): Promise<void> {
  const token = process.env['WIREBOARD_TOKEN'];
  if (!token) throw new Error('WIREBOARD_TOKEN env var is required.');

  const wb = new WireBoardClient({ token });

  const { sites } = await wb.sites();
  const siteIds = sites.slice(0, 3).map((s) => s.id);
  if (siteIds.length === 0) throw new Error('no sites in this account');

  console.log(`Subscribing to ${siteIds.length} site(s): ${siteIds.join(', ')}`);

  const perSiteCounts = new Map<string, number>();
  const perSiteLatest = new Map<string, string>();

  const raw = wb.liveRaw({
    sites: siteIds,
    categories: ['visitors', 'top_pages', 'active_sessions'],
    onEvent: (env: LiveEnvelope) => {
      perSiteCounts.set(env.site_id, (perSiteCounts.get(env.site_id) ?? 0) + 1);
      perSiteLatest.set(env.site_id, env.category);
    },
    onError: (err) => console.error('raw error:', err.message),
  });

  await raw.start();
  console.log('Listening for 30s…');
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  raw.stop();

  console.log('\nPer-site activity:');
  for (const siteId of siteIds) {
    const n = perSiteCounts.get(siteId) ?? 0;
    const latest = perSiteLatest.get(siteId) ?? '—';
    console.log(`  ${siteId.padEnd(10)} ${String(n).padStart(4)} envelope(s)  latest: ${latest}`);
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
