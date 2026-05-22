import EventSource from 'eventsource';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WireBoardClient } from '../src/client.js';
import { registerEventSource } from '../src/live/eventsource.js';
import type { ManagedLiveState } from '../src/types.js';
import { makeStubServer, type StubServer } from './_stub/sse-server.js';

registerEventSource(EventSource as unknown as new (url: string) => globalThis.EventSource);

const SITE = 'xK4mP2nT';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('LiveClient — snapshot + stream', () => {
  let stub: StubServer;

  beforeEach(async () => {
    stub = await makeStubServer();
  });

  afterEach(async () => {
    await stub.close();
  });

  it('fetches snapshot on start and exposes it as state', async () => {
    stub.snapshot.live = { visitors: { live: 5, returning: 2 } };

    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const updates: ManagedLiveState[] = [];
    const live = wb.live({
      siteId: SITE,
      categories: ['visitors'],
      onChange: (s) => updates.push(s),
    });
    await live.start();
    await stub.waitForConnections(1);

    expect(live.state.live.visitors).toEqual({ live: 5, returning: 2 });
    expect(updates.length).toBeGreaterThanOrEqual(1);

    live.stop();
  });

  it('applies stream events to state', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const live = wb.live({ siteId: SITE, categories: ['visitors'] });
    await live.start();
    await stub.waitForConnections(1);

    stub.sendAll(
      {
        site_id: SITE,
        category: 'visitors',
        ts: '2026-05-22T13:00:00.000Z',
        data: { live: 7, returning: 1 },
      },
      'e1',
    );
    await sleep(150);

    expect(live.state.live.visitors).toEqual({ live: 7, returning: 1 });
    live.stop();
  });

  it('applies a top-N drop signal (count=0)', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const live = wb.live({ siteId: SITE, categories: ['top_pages'] });
    await live.start();
    await stub.waitForConnections(1);

    stub.sendAll(
      {
        site_id: SITE,
        category: 'top_pages',
        ts: 't1',
        data: [{ url: 'https://example.com/a', title: 'A', count: 3 }],
      },
      'p1',
    );
    await sleep(100);
    expect(live.state.live.top_pages).toHaveLength(1);

    stub.sendAll(
      {
        site_id: SITE,
        category: 'top_pages',
        ts: 't2',
        data: [{ url: 'https://example.com/a', title: 'A', count: 0 }],
      },
      'p2',
    );
    await sleep(100);
    expect(live.state.live.top_pages).toHaveLength(0);

    live.stop();
  });

  it('refetches snapshot and replaces state on hard reconnect', async () => {
    stub.snapshot.live = { visitors: { live: 5, returning: 2 } };
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const live = wb.live({ siteId: SITE, categories: ['visitors'] });
    await live.start();
    await stub.waitForConnections(1);

    const initialSnapshots = stub.snapshotCount();
    expect(initialSnapshots).toBe(1);

    stub.snapshot.live = { visitors: { live: 99, returning: 11 } };
    stub.killAll();

    // wait for 500ms backoff + reconnect
    await sleep(1200);
    await stub.waitForConnections(1, 3000);

    expect(stub.snapshotCount()).toBeGreaterThanOrEqual(2);
    expect(live.state.live.visitors?.live).toBe(99);

    live.stop();
  });

  it('fires onReconnect on hard reconnect but not on initial open', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    let reconnects = 0;
    const live = wb.live({
      siteId: SITE,
      categories: ['visitors'],
      onReconnect: () => { reconnects++; },
    });
    await live.start();
    await stub.waitForConnections(1);

    // Initial open should NOT fire onReconnect.
    expect(reconnects).toBe(0);

    // Drop the connection — the SDK should hardReconnect.
    stub.killAll();
    await sleep(1200);
    await stub.waitForConnections(1, 3000);

    expect(reconnects).toBe(1);

    // Drop again — second reconnect should also fire.
    stub.killAll();
    await sleep(1200);
    await stub.waitForConnections(1, 3000);

    expect(reconnects).toBe(2);

    live.stop();
  });

  it('reports malformed envelope via onError without breaking the subscription', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const errors: Error[] = [];
    const live = wb.live({
      siteId: SITE,
      categories: ['visitors'],
      onError: (err) => errors.push(err),
    });
    await live.start();
    await stub.waitForConnections(1);

    for (const c of stub.connections) {
      if (c.open) c.res.write('data: not-json\n\n');
    }
    await sleep(100);
    expect(errors.length).toBeGreaterThanOrEqual(1);

    stub.sendAll(
      {
        site_id: SITE,
        category: 'visitors',
        ts: 't2',
        data: { live: 3, returning: 0 },
      },
      'after-bad',
    );
    await sleep(100);
    expect(live.state.live.visitors?.live).toBe(3);

    live.stop();
  });

  it('keeps the old connection alive when a rotation attempt fails to open', async () => {
    // Initial JWT lives 65s → rotation lead = (65-60)*1000 = 5000ms,
    // giving us a window between `start()` returning and the rotation
    // firing in which to arm `failNextStream`.
    stub.tokenExpiresIn = 65;
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const errors: Error[] = [];
    let rotateCount = 0;
    const live = wb.live({
      siteId: SITE,
      categories: ['visitors'],
      onError: (err) => errors.push(err),
      onRotate: () => rotateCount++,
    });
    await live.start();
    await stub.waitForConnections(1);
    const originalConn = stub.connections.find((c) => c.open);
    expect(originalConn).toBeTruthy();
    const initialTokenMints = stub.tokenCount();

    // Arm: the very next stream connection (the rotation's new ES) will 404.
    stub.failNextStream = true;

    // Wait past the rotation lead (5s) for the rotation to fire + fail.
    await sleep(5500);

    expect(rotateCount).toBe(0); // no successful rotation
    expect(errors.some((e) => /rotation/i.test(e.message))).toBe(true);
    expect(originalConn?.open).toBe(true); // old connection preserved
    expect(stub.tokenCount()).toBeGreaterThan(initialTokenMints); // mint did happen
    expect(stub.failNextStream).toBe(false); // 404 was consumed

    live.stop();
  }, 15_000);

  it('dedups events that arrive on overlapping connections via lastEventId', async () => {
    stub.tokenExpiresIn = 2; // rotation lead = 60s; clamps to 0 → fires immediately
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    let rotateCount = 0;
    const visitorSeen: number[] = [];
    const live = wb.live({
      siteId: SITE,
      categories: ['visitors'],
      onRotate: () => rotateCount++,
      onChange: (s) => {
        if (s.live.visitors) visitorSeen.push(s.live.visitors.live);
      },
    });
    await live.start();
    await stub.waitForConnections(1);

    // Wait long enough for the rotation timer (lead clamps to 0)
    // to fire and the new connection to open alongside the old.
    await sleep(400);
    await stub.waitForConnections(2, 2000);

    stub.sendAll(
      {
        site_id: SITE,
        category: 'visitors',
        ts: 't1',
        data: { live: 42, returning: 0 },
      },
      'shared-id',
    );
    await sleep(150);

    const fortyTwos = visitorSeen.filter((v) => v === 42).length;
    expect(fortyTwos).toBe(1);
    expect(rotateCount).toBeGreaterThanOrEqual(1);

    live.stop();
  });
});

describe('LiveClient — lifecycle', () => {
  let stub: StubServer;
  beforeEach(async () => {
    stub = await makeStubServer();
  });
  afterEach(async () => {
    await stub.close();
  });

  it('start() is idempotent under concurrent invocation', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const live = wb.live({ siteId: SITE, categories: ['visitors'] });
    await Promise.all([live.start(), live.start()]);
    await stub.waitForConnections(1);
    expect(stub.tokenCount()).toBe(1);
    expect(stub.snapshotCount()).toBe(1);
    live.stop();
  });

  it('start() after stop() performs a fresh start', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const live = wb.live({ siteId: SITE, categories: ['visitors'] });
    await live.start();
    live.stop();
    await sleep(50);
    await live.start();
    await stub.waitForConnections(1);
    expect(stub.tokenCount()).toBe(2);
    expect(stub.snapshotCount()).toBe(2);
    live.stop();
  });

  it('stop() mid-start rejects the start promise and transitions to closed', async () => {
    const wb = new WireBoardClient({ token: 't', baseUrl: stub.url });
    const live = wb.live({ siteId: SITE, categories: ['visitors'] });
    const p = live.start();
    live.stop();
    await expect(p).rejects.toBeDefined();
    expect(live.status).toBe('closed');
  });
});
