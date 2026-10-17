#!/usr/bin/env node
/* Runs browser suites on two checkouts, one after the other, and compares them per check id:
     npm run compare -- <suite>... | all  --a <checkout> --b <checkout>
   Each checkout gets its own PocketBase (its migrations and hooks), seed and vite, on the usual ports, one after the other. Output:
   PM_OUT (default qa/out/compare-<timestamp>) with an a/ and a b/ folder. Prints, for every suite, the counts of both and every
   check id that passed on one and not on the other (DIFF) or failed on both (BOTH-FAIL; BOTH-KNOWN for a known bug, which is not a failure).
   Exit code: 0 no difference and no failure, 1 otherwise, 2 usage, 3 ports in use. */
import path from 'node:path';
import { assertScratchDir, QA_DIR, stamp } from '../lib/env.mjs';
import { Qa } from '../lib/stack.mjs';
import { runSuite } from './runner.mjs';
import { resolveSuites, SUITES } from './suites.mjs';

const argv = process.argv.slice(2);
const take = flag => {
  const i = argv.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (i < 0) return null;
  if (argv[i].includes('=')) return argv.splice(i, 1)[0].split('=').slice(1).join('=');
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const a = take('--a');
const b = take('--b');
if (argv.includes('--help') || argv.includes('-h') || !a || !b || !argv.length) {
  console.log(`usage: npm run compare -- <suite>... | all --a <checkout> --b <checkout>\nsuites: ${Object.keys(SUITES).join(' ')}`);
  process.exit(argv.includes('--help') || argv.includes('-h') ? 0 : 2);
}
let names;
try {
  names = resolveSuites(argv);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

let root;
try {
  root = assertScratchDir(process.env.PM_OUT || path.join(QA_DIR, 'out', `compare-${stamp()}`), a, b);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const runs = { a: {}, b: {} };
let failed = false;
for (const [side, checkout] of [
  ['a', a],
  ['b', b],
]) {
  process.env.PM_SRC = path.resolve(checkout);
  const qa = new Qa();
  try {
    qa.init();
    runs[side].sha = qa.sha;
    const sideRoot = path.join(root, side);
    await qa.startVite(sideRoot);
    await qa.warmUp();
    for (const name of names) {
      const r = await runSuite(qa, name, path.join(sideRoot, name));
      console.log(`[${side} ${qa.sha}] ${r.line}`);
      // a script that crashed, timed out or recorded too few checks: the same gap on both sides would otherwise read as no difference
      if (r.problems.length) failed = true;
      runs[side][name] = r;
    }
  } catch (e) {
    console.error(`RUN FAILED on ${side} (${checkout}):`, e && e.stack ? e.stack : e);
    failed = true;
  } finally {
    await qa.cleanup();
  }
}

const passed = r => (r.records || []).filter(x => x.pass).length;
console.log(`\nA = ${path.resolve(a)} @ ${runs.a.sha}\nB = ${path.resolve(b)} @ ${runs.b.sha}`);
for (const name of names) {
  const ra = runs.a[name];
  const rb = runs.b[name];
  if (!ra?.records || !rb?.records) {
    console.log(`${name}: missing results (a ${!!ra?.records}, b ${!!rb?.records})`);
    failed = true;
    continue;
  }
  console.log(`${name}: A ${passed(ra)}/${ra.records.length} pass, B ${passed(rb)}/${rb.records.length} pass`);
  const byKey = r => new Map(r.records.map(x => [x.key, x]));
  const ma = byKey(ra);
  const mb = byKey(rb);
  const keys = [...new Set([...ra.records, ...rb.records].map(x => x.key))];
  for (const k of keys) {
    const pa = ma.get(k)?.pass;
    const pb = mb.get(k)?.pass;
    if (pa !== pb) {
      console.log(`  DIFF ${k}  A ${pa === undefined ? 'absent' : pa ? 'pass' : 'FAIL'}  B ${pb === undefined ? 'absent' : pb ? 'pass' : 'FAIL'}`);
      failed = true;
    } else if (pa === false) {
      // a bug on main that known.mjs lists fails on both sides: reported, but it is not a failure of the comparison
      const known = r => r.tally.known.some(x => x.startsWith(`${k}:`));
      if (known(ra) && known(rb)) console.log(`  BOTH-KNOWN ${k}`);
      else {
        console.log(`  BOTH-FAIL ${k}`);
        failed = true;
      }
    }
  }
}
process.exit(failed ? 1 : 0);
