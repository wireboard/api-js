import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

const define = { __SDK_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
    dts: true,
    clean: true,
    sourcemap: true,
    define,
  },
  {
    entry: { 'index.browser': 'src/index.browser.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    define,
    treeshake: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
    define,
  },
]);
