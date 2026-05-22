#!/usr/bin/env node
/**
 * scripts/build-browser-demo.mjs — dev helper, used by test-examples.sh.
 *
 * Transforms one of the customer-facing examples/browser/*.html pages into
 * a locally-runnable copy:
 *   1. Swaps the esm.sh CDN import for the local ./index.browser.js bundle
 *      (filename preserved so the bundle's sourcemap still resolves).
 *   2. Injects an inline <script> at the top of <body> that pre-populates
 *      localStorage with the token + optional site id, so the served page
 *      works on the first hit (no manual devtools step).
 *
 * Usage:
 *   WIREBOARD_TOKEN=… [WIREBOARD_SITE_ID=…] node build-browser-demo.mjs <in.html> <out.html>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , srcPath, outPath] = process.argv;
if (!srcPath || !outPath) {
  process.stderr.write('usage: build-browser-demo.mjs <in.html> <out.html>\n');
  process.exit(1);
}

const token = process.env.WIREBOARD_TOKEN;
const siteId = process.env.WIREBOARD_SITE_ID;
if (!token) {
  process.stderr.write('WIREBOARD_TOKEN not set\n');
  process.exit(1);
}

let html = readFileSync(srcPath, 'utf8');

// 1. Use the local bundle instead of the CDN. (Filename preserved so the
//    bundle's `//# sourceMappingURL=index.browser.js.map` still resolves.)
html = html.replace('https://esm.sh/@wireboard/api', './index.browser.js');

// 2. Pre-populate localStorage so the served page works on first load.
const bootstrap =
  '<script>' +
  `localStorage.WIREBOARD_TOKEN = ${JSON.stringify(token)};` +
  (siteId ? `localStorage.WIREBOARD_SITE_ID = ${JSON.stringify(siteId)};` : '') +
  '</script>';

if (!html.includes('<body>')) {
  process.stderr.write('input HTML must contain a literal <body> tag\n');
  process.exit(1);
}
html = html.replace('<body>', `<body>${bootstrap}`);

writeFileSync(outPath, html);
process.stderr.write(`wrote ${outPath}\n`);
