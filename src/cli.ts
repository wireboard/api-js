import process from 'node:process';
import EventSource from 'eventsource';
import { WireBoardClient } from './client.js';
import { LIVE_CATEGORIES } from './constants.js';
import { WireBoardApiError, WireBoardAuthError } from './errors.js';
import { registerEventSource } from './live/eventsource.js';
import type { LiveCategory, LiveEnvelope } from './public.js';
import { VERSION } from './version.js';

registerEventSource(EventSource as unknown as new (url: string) => globalThis.EventSource);

interface ParsedArgs {
  subcommand: string | undefined;
  token: string | undefined;
  site: string | undefined;
  duration: number;
  noColor: boolean;
  help: boolean;
}

const KNOWN_VALUE_FLAGS = new Set(['token', 'site', 'duration']);

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (
        KNOWN_VALUE_FLAGS.has(body) &&
        i + 1 < argv.length &&
        !argv[i + 1]!.startsWith('-')
      ) {
        flags[body] = argv[++i]!;
      } else {
        flags[body] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Short flags (boolean only): -h, -v, etc.
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }
  const duration = flags['duration'];
  return {
    subcommand: positional[0],
    token: typeof flags['token'] === 'string' ? flags['token'] : undefined,
    site: typeof flags['site'] === 'string' ? flags['site'] : undefined,
    duration: typeof duration === 'string' ? Number(duration) : 45,
    noColor: flags['no-color'] === true,
    help: flags['help'] === true || flags['h'] === true,
  };
}

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

class Printer {
  constructor(private readonly useColor: boolean) {}
  paint(text: string, c: keyof typeof COLORS): string {
    return this.useColor ? `${COLORS[c]}${text}${COLORS.reset}` : text;
  }
  line(s = ''): void {
    process.stdout.write(`${s}\n`);
  }
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
  sublines?: string[];
}

const USAGE = `wireboard-api verify — exercise the SDK against a real account

Usage:
  npx @wireboard/api verify [--token=TOKEN] [--site=SITE_ID] [--duration=SECONDS] [--no-color]

Options:
  --token=TOKEN       API bearer token. Falls back to WIREBOARD_TOKEN env var.
                      Flag wins over env.
  --site=SITE_ID      Specific site to test against. Defaults to the first site
                      from /v1/sites.
  --duration=SECONDS  How long to keep the Live subscription open. Default: 45.
                      Pass >=920 to observe a full JWT rotation cycle.
  --no-color          Strip ANSI escapes (recommended for CI logs).
  --help, -h          Show this help.

Exit code: 0 on full pass, 1 on any failure, 2 on usage error.
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (args.subcommand !== 'verify') {
    process.stderr.write(USAGE);
    return 2;
  }

  const token = args.token ?? process.env['WIREBOARD_TOKEN'];
  const useColor = !args.noColor && process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true;
  const p = new Printer(useColor);

  if (!token) {
    p.line(p.paint('error:', 'red') + ' no token provided. Pass --token=TOKEN or set WIREBOARD_TOKEN.');
    return 1;
  }

  if (!Number.isFinite(args.duration) || args.duration < 1) {
    p.line(p.paint('error:', 'red') + ` invalid --duration=${args.duration}; must be a positive number.`);
    return 1;
  }

  const tokenSuffix = token.slice(-4);
  p.line(p.paint(`WireBoard SDK verify — token …${tokenSuffix}`, 'bold') + p.paint(`  (sdk v${VERSION})`, 'dim'));

  const wb = new WireBoardClient({ token });
  const results: CheckResult[] = [];

  // 1. account()
  let abilities: string[] = [];
  try {
    const account = await wb.account();
    abilities = account.abilities;
    results.push({
      name: 'account()',
      status: 'pass',
      detail: `team-owner: ${account.email}  abilities: ${account.abilities.join(',')}`,
    });
  } catch (err) {
    results.push({ name: 'account()', status: 'fail', detail: errorDetail(err) });
    printResults(p, results);
    return 1;
  }

  // 2. sites()
  let siteId: string | undefined;
  let domain = '';
  try {
    const { sites } = await wb.sites();
    if (sites.length === 0) {
      results.push({ name: 'sites()', status: 'fail', detail: 'account has no sites' });
      printResults(p, results);
      return 1;
    }
    let picked = sites[0]!;
    if (args.site) {
      const match = sites.find((s) => s.id === args.site);
      if (!match) {
        results.push({
          name: 'sites()',
          status: 'fail',
          detail: `site ${args.site} not in account (have ${sites.length})`,
        });
        printResults(p, results);
        return 1;
      }
      picked = match;
    }
    siteId = picked.id;
    domain = picked.domain;
    results.push({
      name: 'sites()',
      status: 'pass',
      detail: `${sites.length} site(s); picked ${picked.id} (${picked.domain})`,
    });
  } catch (err) {
    results.push({ name: 'sites()', status: 'fail', detail: errorDetail(err) });
    printResults(p, results);
    return 1;
  }

  if (!siteId) {
    printResults(p, results);
    return 1;
  }

  // 7-day range ending today (UTC)
  const today = new Date();
  const to = formatUtcDate(today);
  const from = formatUtcDate(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));

  // 3. aggregate
  await runRest(results, 'aggregate()', async () => {
    const r = await wb.aggregate({ site_id: siteId!, from, to });
    return `visitors=${r.visitors}  pageviews=${r.pageviews}  bounce=${r.bounce_rate}  dur=${r.visit_duration}s`;
  });

  // 4. timeseries
  await runRest(results, 'timeseries(visitors,day)', async () => {
    const r = await wb.timeseries({ site_id: siteId!, from, to, metric: 'visitors', interval: 'day' });
    return `${r.points.length} points`;
  });

  // 5. history
  await runRest(results, 'history()', async () => {
    const r = await wb.history({ site_id: siteId!, from, to });
    return `${r.points.length} points`;
  });

  // 6. breakdown(country)
  await runRest(results, 'breakdown(country)', async () => {
    const r = await wb.breakdown({ site_id: siteId!, from, to, dimension: 'country' });
    const top = r.rows[0];
    return top
      ? `${r.rows.length} rows; top: ${top.country} (${top.visitors})`
      : `0 rows (no traffic in window)`;
  });

  // 7. urls
  await runRest(results, 'urls()', async () => {
    const r = await wb.urls({ site_id: siteId!, from, to });
    return `${r.total} total, ${r.rows.length} returned`;
  });

  // 8. events
  await runRest(results, 'events()', async () => {
    const r = await wb.events({ site_id: siteId!, from, to });
    return `${r.rows.length} rows`;
  });

  // 9. dimensions
  await runRest(results, 'dimensions()', async () => {
    const r = await wb.dimensions();
    return `${r.breakdown_dimensions.length} breakdown dims, ${r.max_range_days} max_range_days`;
  });

  // Live API only if token has ability
  const hasLive = abilities.includes('live:read');
  if (!hasLive) {
    results.push({
      name: 'live: snapshot',
      status: 'fail',
      detail: 'token does not have live:read ability — skipping live checks',
    });
    printResults(p, results);
    return 1;
  }

  // 10. live: state snapshot
  await runRest(results, 'live: state snapshot', async () => {
    const snap = await wb.liveState({ site_id: siteId!, categories: Array.from(LIVE_CATEGORIES) });
    const keys = Object.keys(snap.live).length;
    return `${keys}/${LIVE_CATEGORIES.length} categories present`;
  });

  // 11. live: stream
  const streamResult = await runLiveStream(p, wb, siteId, args.duration);
  results.push(streamResult);

  // Domain echo for log readability
  void domain;

  printResults(p, results);
  const failed = results.filter((r) => r.status === 'fail').length;
  return failed === 0 ? 0 : 1;
}

async function runRest(
  results: CheckResult[],
  name: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail });
  } catch (err) {
    results.push({ name, status: 'fail', detail: errorDetail(err) });
  }
}

interface StreamCounters {
  perCategory: Map<LiveCategory, number>;
  topDrops: number;
  sessionDrops: number;
  total: number;
}

async function runLiveStream(
  p: Printer,
  wb: WireBoardClient,
  siteId: string,
  durationSeconds: number,
): Promise<CheckResult> {
  const counters: StreamCounters = {
    perCategory: new Map(),
    topDrops: 0,
    sessionDrops: 0,
    total: 0,
  };
  let rotationObserved = false;
  let firstError: Error | null = null;
  let reconnects = 0;
  let firstReconnectAt: number | null = null;
  const startedAt = Date.now();
  let rotateAt: number | null = null;

  const live = wb.live({
    siteId,
    categories: Array.from(LIVE_CATEGORIES),
    onEvent: (env) => {
      counters.total++;
      counters.perCategory.set(env.category, (counters.perCategory.get(env.category) ?? 0) + 1);
      countDrops(env, counters);
    },
    onError: (err) => {
      if (!firstError) firstError = err;
    },
    onRotate: () => {
      rotationObserved = true;
      rotateAt = Date.now() - startedAt;
    },
    onReconnect: () => {
      reconnects++;
      if (firstReconnectAt === null) firstReconnectAt = Date.now() - startedAt;
    },
  });

  p.line(p.paint(`  · opening live subscription for ${durationSeconds}s…`, 'dim'));

  try {
    await live.start();
  } catch (err) {
    return {
      name: `live: stream (${durationSeconds}s)`,
      status: 'fail',
      detail: `failed to open: ${errorDetail(err)}`,
    };
  }

  await new Promise<void>((resolve) => setTimeout(resolve, durationSeconds * 1000));
  live.stop();
  // brief grace period for in-flight close
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  // `firstError` is mutated inside the live client's `onError` callback;
  // TS's control-flow analysis can't see closure-driven mutations, so we
  // re-widen the inferred type at the point of read.
  const capturedError = firstError as Error | null;
  const detail = capturedError !== null
    ? `caught error during stream: ${capturedError.message}`
    : `${counters.total} events received`;

  const status: 'pass' | 'fail' = firstError === null ? 'pass' : 'fail';

  const topN = topCategories(counters.perCategory, 8);
  const sublines: string[] = [
    `by category (top): ${topN.length === 0 ? '—' : topN.join(' ')}`,
    `drop signals: top-N=${counters.topDrops} active_sessions=${counters.sessionDrops}`,
    rotationDetail(rotationObserved, rotateAt, durationSeconds),
    reconnectDetail(reconnects, firstReconnectAt),
    `errors: ${firstError === null ? '0' : '1'}`,
  ];

  return {
    name: `live: stream (${durationSeconds}s)`,
    status,
    detail,
    sublines,
  };
}

function rotationDetail(observed: boolean, rotateAt: number | null, duration: number): string {
  if (observed && rotateAt !== null) {
    const seconds = Math.round(rotateAt / 100) / 10;
    return `JWT rotation: ok (observed at +${seconds}s)`;
  }
  // JWT lifetime is 900s; pre-emptive rotation fires at lifetime - 60s = 840s
  if (duration < 920) {
    return `JWT rotation: not observed (need --duration=920 to verify; default ${duration}s)`;
  }
  return `JWT rotation: NOT observed (duration ${duration}s should have triggered one)`;
}

function reconnectDetail(count: number, firstAt: number | null): string {
  if (count === 0) return `reconnects: 0`;
  const firstSec = firstAt !== null ? `+${Math.round(firstAt / 100) / 10}s` : '?';
  return `reconnects: ${count} (first at ${firstSec} — silent recovery from connection drop)`;
}

function topCategories(map: Map<LiveCategory, number>, n: number): string[] {
  const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, n).map(([k, v]) => `${k}(${v})`);
}

function countDrops(env: LiveEnvelope, counters: StreamCounters): void {
  switch (env.category) {
    case 'top_pages':
    case 'top_referrers':
    case 'top_mediums':
    case 'top_sources':
    case 'top_search':
    case 'top_social':
    case 'top_countries':
    case 'top_devices':
    case 'top_browsers':
    case 'top_oses':
    case 'top_languages':
    case 'top_screens':
    case 'geo':
      for (const e of env.data) {
        if (e.count === 0) counters.topDrops++;
      }
      break;
    case 'active_sessions':
      for (const s of env.data) {
        if (s.step_count === 0) counters.sessionDrops++;
      }
      break;
  }
}

function printResults(p: Printer, results: CheckResult[]): void {
  const namePad = Math.max(...results.map((r) => r.name.length), 28) + 2;
  for (const r of results) {
    const tag = r.status === 'pass' ? p.paint('PASS', 'green') : p.paint('FAIL', 'red');
    p.line(`  ${r.name.padEnd(namePad)}${tag}  ${r.detail}`);
    if (r.sublines) {
      const indent = ' '.repeat(namePad + 8);
      for (const sub of r.sublines) {
        p.line(`${indent}${p.paint(sub, 'dim')}`);
      }
    }
  }
  p.line(`  ${'─'.repeat(namePad + 8)}`);
  const passed = results.filter((r) => r.status === 'pass').length;
  const total = results.length;
  const summaryTag = passed === total ? p.paint('PASS', 'green') : p.paint('FAIL', 'red');
  p.line(`  ${'SUMMARY'.padEnd(namePad)}${summaryTag}  ${passed}/${total} surfaces`);
}

function errorDetail(err: unknown): string {
  if (err instanceof WireBoardApiError) {
    const code = err.code ? ` code=${err.code}` : '';
    return `HTTP ${err.httpStatus}${code}: ${err.message}`;
  }
  if (err instanceof WireBoardAuthError) {
    return `HTTP ${err.httpStatus}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
