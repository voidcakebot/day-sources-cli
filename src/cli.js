#!/usr/bin/env node
import { parseArgs, runLookup, formatHuman } from './core.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runLookup(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatHuman(report));
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
