#!/usr/bin/env bash
# scripts/test-examples.sh
#
# Builds the SDK, installs it into a fresh scratch dir (proves the published
# shape works), then serves every `examples/browser/*.html` on a local HTTP
# server with the token pre-injected. Open the printed URL in a browser and
# click through.
#
# Requires:
#   - WIREBOARD_TOKEN in the environment or in .env at the repo root
#   - Node 18+
#
# Press Ctrl+C to stop the server and clean up.

set -euo pipefail

# ─── locate repo root ────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ─── load token ──────────────────────────────────────────────────────────────
if [[ -z "${WIREBOARD_TOKEN:-}" && -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi

if [[ -z "${WIREBOARD_TOKEN:-}" ]]; then
  echo "error: WIREBOARD_TOKEN not set." >&2
  echo "       Export it or add WIREBOARD_TOKEN='…' to .env at the repo root." >&2
  exit 1
fi

# ─── find a free port ────────────────────────────────────────────────────────
find_free_port() {
  for p in 8080 8081 8082 8083 8084 8085 8086 8087 8088 8089; do
    if ! (echo > /dev/tcp/127.0.0.1/"$p") >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

if [[ -n "${PORT:-}" ]]; then
  if (echo > /dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1; then
    echo "error: requested port $PORT is in use." >&2
    exit 1
  fi
else
  PORT="$(find_free_port)" || { echo "no free port in 8080–8089" >&2; exit 1; }
fi

# ─── cleanup ─────────────────────────────────────────────────────────────────
TARBALL_GLOB="$REPO_ROOT/wireboard-api-*.tgz"
TMPDIR_PATH=""
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f $TARBALL_GLOB || true
  if [[ -n "$TMPDIR_PATH" && -d "$TMPDIR_PATH" ]]; then
    rm -rf "$TMPDIR_PATH"
  fi
}
trap cleanup EXIT INT TERM

# ─── build + pack ────────────────────────────────────────────────────────────
echo "==> Building + packing the SDK"
npm run build --silent
TARBALL_NAME="$(npm pack --silent)"
TARBALL_PATH="$REPO_ROOT/$TARBALL_NAME"

# ─── scratch dir ─────────────────────────────────────────────────────────────
TMPDIR_PATH="$(mktemp -d -t wb-example-XXXXXX)"
echo "    scratch: $TMPDIR_PATH"
cd "$TMPDIR_PATH"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "$TARBALL_PATH"

# ─── stage browser bundle ───────────────────────────────────────────────────
mkdir -p public
cp node_modules/@wireboard/api/dist/index.browser.js public/
cp node_modules/@wireboard/api/dist/index.browser.js.map public/ 2>/dev/null || true

# ─── transform every browser example ────────────────────────────────────────
echo "==> Preparing browser pages"
cp "$REPO_ROOT/scripts/build-browser-demo.mjs" .

LINKS=""
for src in "$REPO_ROOT/examples/browser/"*.html; do
  base="$(basename "$src")"
  WIREBOARD_TOKEN="$WIREBOARD_TOKEN" \
    node build-browser-demo.mjs "$src" "public/$base"
  # Derive a friendly title from the filename: live-managed → "live managed"
  title="$(basename "$base" .html | tr '-' ' ')"
  LINKS="$LINKS
        <li><a href=\"./$base\">$title</a></li>"
done

# ─── nav index ──────────────────────────────────────────────────────────────
cat > public/index.html <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>WireBoard SDK · browser examples</title>
    <style>
      :root {
        --blue: #2563eb;
        --gray-50: #f8fafc;
        --gray-100: #f1f5f9;
        --gray-200: #e2e8f0;
        --gray-500: #64748b;
        --gray-700: #334155;
        --gray-900: #0f172a;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body {
        font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        color: var(--gray-900);
        max-width: 560px;
        margin: 0 auto;
        padding: 3em 1.5em 4em;
        background: white;
      }
      header {
        display: flex; align-items: center; gap: 0.9em;
        padding-bottom: 1em; margin-bottom: 2em;
        border-bottom: 1px solid var(--gray-200);
      }
      header img { height: 28px; }
      header h1 { font-size: 16px; font-weight: 600; margin: 0; color: var(--gray-700); }
      ul { list-style: none; padding: 0; margin: 0;
        border: 1px solid var(--gray-200); border-radius: 8px; overflow: hidden;
      }
      li { padding: 0; border-bottom: 1px solid var(--gray-200); background: white; }
      li:last-child { border-bottom: 0; }
      li a {
        display: block; padding: 12px 16px;
        color: var(--gray-900); text-decoration: none;
        text-transform: capitalize;
        transition: background 0.1s;
      }
      li a:hover { background: var(--gray-50); }
      li a::after { content: '→'; float: right; color: var(--gray-500); }
      .muted { color: var(--gray-500); font-size: 13px; margin-bottom: 1.4em; }
      code {
        font: 12px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        background: var(--gray-100); padding: 2px 6px; border-radius: 4px; color: var(--gray-700);
      }
    </style>
  </head>
  <body>
    <header>
      <img src="https://wireboard.io/img/logo-blue.png" alt="WireBoard" />
      <h1>SDK browser examples</h1>
    </header>
    <p class="muted">Each page imports the SDK from the local bundle at <code>./index.browser.js</code>. Token is pre-loaded; just click through.</p>
    <ul>$LINKS
    </ul>
  </body>
</html>
HTML

# ─── tiny static server ──────────────────────────────────────────────────────
cat > server.mjs <<'NODE'
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve('public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(abs);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving on http://localhost:${PORT}/`);
});
NODE

echo ""
echo "==> Starting server on port $PORT"
PORT="$PORT" node server.mjs &
SERVER_PID=$!
sleep 0.5

cat <<EOF

──────────────────────────────────────────────────────────────────
✔ Ready.

  Open:  http://localhost:$PORT/

Pages served:
EOF
for src in "$REPO_ROOT/examples/browser/"*.html; do
  echo "    http://localhost:$PORT/$(basename "$src")"
done
cat <<EOF

Press Ctrl+C to stop and clean up.
──────────────────────────────────────────────────────────────────

EOF

wait "$SERVER_PID"
