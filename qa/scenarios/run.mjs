#!/usr/bin/env node
/* Outage and fault scenarios against a throwaway stack:   npm run scenario -- <name>
   Starts PocketBase (the checkout's migrations and hooks) with the dev seed, the fault proxy in front of it, and vite whose /api
   proxy points at the fault proxy; runs the scenario in this process; stops everything (also on failure and Ctrl+C).
   Names: giveup (default), net, focus, fix2, prefs. See qa/README.md for what each one does and how long it takes.
   Output goes to PM_OUT (default qa/out/scenario-<name>-<timestamp>). Exit code: 0 done (giveup and net: every step passed),
   1 a step failed or the run crashed, 2 usage, 3 ports in use. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertScratchDir, QA_DIR, stamp } from '../lib/env.mjs';
import { Qa } from '../lib/stack.mjs';
import { waitHttp } from '../lib/procs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = {
  giveup: {
    file: 'scenario.mjs',
    env: { SCENARIO: 'giveup' },
    steps: true,
    about: 'a refused change is discarded with a toast after the give-up window (steps 1-9, about 5 minutes)',
  },
  net: { file: 'scenario.mjs', env: { SCENARIO: 'net' }, steps: true, about: 'a network failure must never give up (about 3 minutes)' },
  focus: {
    file: 'focus-scenario.mjs',
    env: {},
    about: 'focus and caret in the description and subtask note after a refused change (observations in result.json)',
  },
  fix2: { file: 'fix2-scenario.mjs', env: {}, about: 'C4 typing while remote changes arrive, C5 offline toast wording (result.json)' },
  prefs: { file: 'prefs-scenario.mjs', env: {}, about: 'is a user_prefs update pending from page load, and does a PATCH 200 clear it (result.json)' },
};

const name = process.argv[2] || 'giveup';
if (process.argv.includes('--help') || process.argv.includes('-h') || !SCENARIOS[name]) {
  console.log(
    `usage: npm run scenario -- <name>\n${Object.entries(SCENARIOS)
      .map(([n, s]) => `  ${n.padEnd(8)}${s.about}`)
      .join('\n')}`,
  );
  process.exit(process.argv.includes('--help') || process.argv.includes('-h') ? 0 : 2);
}
const scen = SCENARIOS[name];
Object.assign(process.env, scen.env);

const qa = new Qa({ proxy: true });
let code = 0;
try {
  qa.init();
  const outDir = assertScratchDir(process.env.PM_OUT || path.join(QA_DIR, 'out', `scenario-${name}-${stamp()}`), qa.cfg.src);
  fs.mkdirSync(outDir, { recursive: true });
  const { proxyPort, pbPort, proxyUrl, pbUrl, baseUrl } = qa.cfg;

  const db = await qa.freshDb(outDir);
  const seedLog = fs.readFileSync(path.join(outDir, 'seed.log'), 'utf8');
  const m = /^\s*(\S+@\S+)\s+(\S+)\s+\S+\s+.*\(the seed user\)/m.exec(seedLog);
  if (!m) throw new Error('could not find the seed user in seed.log');
  const [, email, password] = m;
  qa.log(`seeded; the scenario signs in as ${email}`);

  const proxyLog = path.join(outDir, 'proxy.log.jsonl');
  fs.rmSync(proxyLog, { force: true });
  const proxy = qa.stack.start(
    'proxy',
    process.execPath,
    [path.join(HERE, 'proxy.mjs'), '--listen', `127.0.0.1:${proxyPort}`, '--target', `127.0.0.1:${pbPort}`, '--log', proxyLog],
    {
      cwd: HERE,
      logFile: path.join(outDir, 'proxy.log'),
    },
  );
  await waitHttp(`${proxyUrl}/__fault`, 'fault proxy', 15000, proxy);
  qa.stack.verifyOwn(proxyPort, 'fault proxy');
  await qa.startVite(outDir, proxyUrl);
  await qa.warmUp();

  const { runScenario } = await import(pathToFileURL(path.join(HERE, scen.file)).href);
  const result = await runScenario({ baseUrl, proxyUrl, pbUrl, proxyLog, outDir, email, password, checkout: qa.cfg.src, sha: qa.sha, suEmail: db.suEmail });

  console.log(`\nscenario ${name}: output in ${outDir}`);
  if (scen.steps) {
    // counted from the steps in summary.json, not from console output
    const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
    const steps = summary.steps || [];
    const failed = steps.filter(s => !s.pass);
    console.log(`${name}: ${steps.length - failed.length} pass, ${failed.length} fail of ${steps.length} steps`);
    for (const s of failed) console.log(`    FAIL ${s.n}. ${s.name}`);
    if (failed.length || !steps.length) code = 1;
  }
  // a scenario that throws partway still writes the steps it got to, all of which may have passed
  // (fix2 keeps the error of a crashed check under that check's name in result.json)
  const crashed = result && (result.error || Object.values(result).find(v => v && typeof v === 'object' && v.error)?.error);
  if (crashed) {
    console.log(`${name}: the scenario crashed before its last step: ${String(crashed).split('\n')[0]}`);
    code = 1;
  }
} catch (e) {
  console.error('RUN FAILED:', e && e.stack ? e.stack : e);
  code = 1;
} finally {
  await qa.cleanup();
}
process.exit(code);
