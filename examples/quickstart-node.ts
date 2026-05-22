/**
 * Quickstart — Node.
 *
 * Proves the SDK installs, authenticates, and reads your account. ~20 lines.
 *
 * Run:  WIREBOARD_TOKEN=… npx tsx examples/quickstart-node.ts
 */

import { WireBoardClient } from '@wireboard/api';

async function main(): Promise<void> {
  const token = process.env['WIREBOARD_TOKEN'];
  if (!token) throw new Error('WIREBOARD_TOKEN env var is required.');

  const wb = new WireBoardClient({ token });

  const account = await wb.account();
  console.log(`Hello ${account.name} (${account.email})`);
  console.log(`Abilities: ${account.abilities.join(', ')}`);

  const { sites } = await wb.sites();
  console.log(`\nYou own ${sites.length} site(s):`);
  for (const s of sites.slice(0, 5)) {
    console.log(`  ${s.id.padEnd(10)} ${s.domain}`);
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
