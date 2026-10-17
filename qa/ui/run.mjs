#!/usr/bin/env node
/* Browser suites against a throwaway stack:   npm run ui -- <suite> [<suite> ...]    or   npm run ui -- all
   Starts PocketBase (the checkout's migrations and hooks) and vite for PM_SRC, gives every suite a fresh seeded database and its own
   output folder, prints pass/fail counts per suite from the results files, and stops everything (also on failure and Ctrl+C).
   Exit code: 0 all passed, 1 a failure, a KNOWN-free problem or a crash, 2 usage, 3 ports in use. See qa/README.md. */
import { Qa } from '../lib/stack.mjs';
import { ok, outRoot, runSuite, suiteOut } from './runner.mjs';
import { resolveSuites, SUITES } from './suites.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || !args.length) {
  console.log(
    `usage: npm run ui -- <suite>... | all\nsuites:\n${Object.entries(SUITES)
      .map(([n, s]) => `  ${n.padEnd(9)}${s.about}`)
      .join('\n')}`,
  );
  process.exit(args.length ? 0 : 2);
}
let names;
try {
  names = resolveSuites(args);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const qa = new Qa();
let failed = false;
try {
  qa.init();
  const root = outRoot(names);
  await qa.startVite(root);
  await qa.warmUp();
  const done = [];
  for (const name of names) {
    const r = await runSuite(qa, name, suiteOut(root, name, names.length));
    console.log(r.line);
    console.log(`    output ${r.outDir}`);
    done.push(r);
    if (!ok(r)) failed = true;
  }
  console.log('\nSummary');
  for (const r of done)
    console.log(
      `  ${ok(r) ? 'ok  ' : 'FAIL'} ${r.name.padEnd(9)} ${r.tally.pass} pass ${r.tally.fail.length} fail ${r.tally.known.length} known of ${r.tally.total} checks, ${r.secs}s`,
    );
} catch (e) {
  console.error('RUN FAILED:', e && e.stack ? e.stack : e);
  failed = true;
} finally {
  await qa.cleanup();
}
process.exit(failed ? 1 : 0);
