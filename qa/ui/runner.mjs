/* Runs browser suites against a stack and tallies them from their results files. Used by run.mjs and compare.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertScratchDir, config, QA_DIR, stamp } from '../lib/env.mjs';
import { describeTally, loadResults, resultsFile, tally } from '../lib/results.mjs';
import { KNOWN } from './known.mjs';
import { SUITES } from './suites.mjs';

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));

/* The output root: PM_OUT, or qa/out/<suite>-<timestamp> (qa/out/run-<timestamp> for several suites). One suite writes into the root
   itself, several write into <root>/<suite>. */
export function outRoot(names, parent = process.env.PM_OUT) {
  if (parent) return assertScratchDir(parent, config().src);
  return path.join(QA_DIR, 'out', `${names.length > 1 ? 'run' : names[0].replace(':', '-')}-${stamp()}`);
}
export const suiteOut = (root, name, count) => (count > 1 ? path.join(root, name.replace(':', '-')) : root);

/* Runs one suite (all of its scripts) on a fresh database each. Returns { name, outDir, secs, tally, problems, line }. */
export async function runSuite(qa, name, outDir, { timeoutS = Number(process.env.PM_SUITE_TIMEOUT_S || 1500) } = {}) {
  const [suiteName, only] = name.split(':'); // "pipeline:r3-checks" runs one script of a suite
  const suite = SUITES[suiteName];
  const files = only ? suite.files.filter(f => path.basename(f, '.mjs') === only) : suite.files;
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(resultsFile(outDir), { force: true });
  const problems = [];
  let secs = 0;
  for (const file of files) {
    const part = path.basename(file, '.mjs');
    qa.log(`${name}: ${part}: fresh database`);
    const db = await qa.freshDb(outDir);
    qa.log(`${name}: ${part}: running`);
    const r = await qa.runScript(path.join(UI_DIR, file), { outDir, name: part, env: qa.suiteEnv(db, outDir), timeoutS });
    secs += r.secs;
    if (r.timedOut) problems.push(`${part} timed out after ${timeoutS}s`);
    else if (r.code !== 0) problems.push(`${part} exited with code ${r.code}`);
  }
  await qa.stopPb();
  const records = loadResults(resultsFile(outDir));
  const t = tally(records, KNOWN[suiteName]);
  if (!records) problems.push('no results file');
  else if (!records.length) problems.push('no checks in the results file (a selector that matches nothing?)');
  // a run that stops early shows fewer checks than a complete one (a suite catches its own errors and exits 0); each selector
  // only limits its own suite
  const partial = (suiteName === 'rt' && process.env.RT_ONLY) || (suiteName === 'pf' && process.env.PF_ONLY) || (suiteName === 'pipeline' && process.env.ONLY);
  if (suite.expect && !partial && !only && t.total !== suite.expect) problems.push(`recorded ${t.total} checks, a complete run records ${suite.expect}`);
  const line = describeTally(name, t, `${secs}s`) + problems.map(p => `\n    PROBLEM ${p}`).join('');
  return { name, outDir, secs, tally: t, problems, line, records };
}

export const ok = r => !r.tally.fail.length && !r.problems.length;
