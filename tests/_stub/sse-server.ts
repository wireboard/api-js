import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Connection {
  id: number;
  topics: string[];
  authorization: string;
  res: ServerResponse;
  open: boolean;
}

export interface StubServer {
  url: string;
  close(): Promise<void>;
  connections: Connection[];
  /** Send an SSE data event to all open connections. */
  sendAll(envelope: unknown, id?: string): void;
  /** Forcefully drop all open connections (simulates network failure or JWT expiry). */
  killAll(): void;
  /** Snapshot data returned by /v1/live/state. Mutate before/between calls to vary results. */
  snapshot: { live: Record<string, unknown>; max_30d: number | null; max_30d_at: string | null };
  /** Override the `expires_in` value returned by /v1/live/token. */
  tokenExpiresIn: number;
  /**
   * When `true`, the very next `/v1/live/stream` request returns a 404 instead
   * of opening an SSE stream. Self-clears after one use. Useful for testing
   * rotation-failure paths.
   */
  failNextStream: boolean;
  /** How many times /v1/live/token has been called. */
  tokenCount(): number;
  /** How many times /v1/live/state has been called. */
  snapshotCount(): number;
  /** Resolve when at least N connections are currently open. Times out after `timeout` ms. */
  waitForConnections(n: number, timeout?: number): Promise<void>;
}

export async function makeStubServer(): Promise<StubServer> {
  const connections: Connection[] = [];
  let nextConnId = 1;
  let nextTokenId = 1;
  let snapshotCalls = 0;
  let tokenCalls = 0;

  const stub: {
    url: string;
    connections: Connection[];
    snapshot: StubServer['snapshot'];
    tokenExpiresIn: number;
    failNextStream: boolean;
  } = {
    url: '',
    connections,
    snapshot: { live: {}, max_30d: null, max_30d_at: null },
    tokenExpiresIn: 900,
    failNextStream: false,
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const auth = req.headers['authorization'];

    if (url.pathname === '/v1/live/token') {
      tokenCalls++;
      if (!auth?.startsWith('Bearer ')) {
        sendJson(res, 401, { message: 'Unauthenticated.' });
        return;
      }
      const sites = url.searchParams.get('sites')?.split(',') ?? ['xK4mP2nT'];
      const categories = url.searchParams.get('categories')?.split(',') ?? [];
      const tokenStr = `jwt-${nextTokenId++}`;
      const addr = server.address() as AddressInfo;
      const hub = `http://127.0.0.1:${addr.port}/v1/live/stream`;
      const topics = sites.flatMap((s) =>
        categories.map((c) => `https://wireboard.io/sites/${s}/live/${c}`),
      );
      sendJson(res, 200, {
        status: true,
        data: {
          hub_url: hub,
          token: tokenStr,
          topics,
          sites,
          categories,
          expires_in: stub.tokenExpiresIn,
        },
      });
      return;
    }

    if (url.pathname === '/v1/live/state') {
      snapshotCalls++;
      if (!auth?.startsWith('Bearer ')) {
        sendJson(res, 401, { message: 'Unauthenticated.' });
        return;
      }
      const siteId = url.searchParams.get('site_id') ?? 'xK4mP2nT';
      // Match the production server: `live` is emitted as an array of
      // `{category, ts, data}` envelopes, not the map shape the public
      // spec documents. The SDK normalises this at the client boundary.
      const ts = new Date().toISOString();
      const liveArray = Object.entries(stub.snapshot.live).map(([category, data]) => ({
        category,
        ts,
        data,
      }));
      sendJson(res, 200, {
        status: true,
        data: {
          site_id: siteId,
          ts,
          live: liveArray,
          max_30d: stub.snapshot.max_30d,
          max_30d_at: stub.snapshot.max_30d_at,
        },
      });
      return;
    }

    if (url.pathname === '/v1/live/stream') {
      if (stub.failNextStream) {
        stub.failNextStream = false;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: false, errors: [{ text: 'simulated failure' }] }));
        return;
      }
      const topics = url.searchParams.getAll('topic');
      const authorization = url.searchParams.get('authorization') ?? '';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const conn: Connection = {
        id: nextConnId++,
        topics,
        authorization,
        res,
        open: true,
      };
      connections.push(conn);
      req.on('close', () => {
        conn.open = false;
      });
      return;
    }

    sendJson(res, 404, {
      status: false,
      errors: [{ text: 'route not found' }],
      fieldErrors: { error_code: ['route_not_found'] },
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  stub.url = `http://127.0.0.1:${addr.port}`;

  const out: StubServer = {
    get url() {
      return stub.url;
    },
    connections,
    snapshot: stub.snapshot,
    get tokenExpiresIn() {
      return stub.tokenExpiresIn;
    },
    set tokenExpiresIn(v: number) {
      stub.tokenExpiresIn = v;
    },
    get failNextStream() {
      return stub.failNextStream;
    },
    set failNextStream(v: boolean) {
      stub.failNextStream = v;
    },
    tokenCount: () => tokenCalls,
    snapshotCount: () => snapshotCalls,
    sendAll: (envelope: unknown, id?: string) => {
      const idLine = id ? `id: ${id}\n` : '';
      const line = `${idLine}data: ${JSON.stringify(envelope)}\n\n`;
      for (const c of connections) {
        if (!c.open) continue;
        try {
          c.res.write(line);
        } catch {
          c.open = false;
        }
      }
    },
    killAll: () => {
      for (const c of connections) {
        if (!c.open) continue;
        try {
          c.res.destroy();
        } catch {
          // intentional
        }
        c.open = false;
      }
    },
    waitForConnections: (n: number, timeout = 3000) =>
      new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const tick = (): void => {
          const open = connections.filter((c) => c.open).length;
          if (open >= n) {
            resolve();
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error(`timeout: have ${open} connections, want ${n}`));
            return;
          }
          setTimeout(tick, 20);
        };
        tick();
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of connections) {
          try {
            c.res.destroy();
          } catch {
            // intentional
          }
        }
        server.close(() => resolve());
      }),
  };

  return out;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
