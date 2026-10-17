/* Browser-suite helpers: launching Chromium, signing in, API calls as the throwaway database's superuser, and check(), which
   appends one JSON line per check to <PM_OUT>/results.jsonl. The runner (ui/run.mjs) sets the environment:
   PM_BASE (the app), PM_PB (PocketBase), PM_OUT, PM_SU_EMAIL and PM_SU_PASSWORD (random for this database), PM_SRC. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertScratchDir, QA_DIR, REPO_DIR } from './env.mjs';

export { chromium };
export const BASE = process.env.PM_BASE || 'http://localhost:5180';
export const PBU = process.env.PM_PB || 'http://127.0.0.1:8095';
// suites call the API as superuser (PATCH, DELETE) and sign in to the app: neither may be the real server, even when run by hand
for (const [name, url] of [
  ['PM_BASE', BASE],
  ['PM_PB', PBU],
])
  if (new URL(url).port === '8090') throw new Error(`${name} is the real server on :8090: refusing to run`);
export const SRC = process.env.PM_SRC || REPO_DIR;
export const OUT = assertScratchDir(process.env.PM_OUT || path.join(QA_DIR, 'out', 'adhoc'), SRC);
fs.mkdirSync(OUT, { recursive: true });
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const launch = () => chromium.launch({ headless: true, args: ['--no-sandbox'] });

// a page that collects console errors in page.errs
export async function open(ctx, tag) {
  const page = await ctx.newPage();
  page.errs = [];
  page.on('console', m => {
    if (m.type() === 'error') page.errs.push(`[${tag}] ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', e => page.errs.push(`[${tag}] pageerror ${String(e).slice(0, 200)}`));
  return page;
}

// every seeded account shares this (published) password; it only exists in throwaway databases
export const USER_PASSWORD = 'pmspace-dev-1234';
export async function login(page, email, pw = USER_PASSWORD) {
  await page.goto(BASE + '/');
  await page.waitForSelector('#l-email', { timeout: 15000 });
  await page.fill('#l-email', email);
  await page.fill('#l-pw', pw);
  await page.click('#login-btn');
  await page.waitForSelector('.sidebar, nav, [data-r="projects"]', { timeout: 20000, state: 'attached' });
  await sleep(1500);
}

let SU = '';
export async function suLogin() {
  const identity = process.env.PM_SU_EMAIL;
  const password = process.env.PM_SU_PASSWORD;
  if (!identity || !password) throw new Error('PM_SU_EMAIL and PM_SU_PASSWORD are not set: run the suite through qa/ui/run.mjs');
  const r = await fetch(PBU + '/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  if (!r.ok) throw new Error(`superuser sign-in failed: ${r.status}`);
  SU = (await r.json()).token;
  return SU;
}
export const suToken = () => SU;

export async function api(method, apiPath, body) {
  const r = await fetch(PBU + '/api' + apiPath, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: SU },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    // no body (204)
  }
  return { status: r.status, body: j };
}
export const lists = async () => (await api('GET', '/collections/workspace_lists/records?perPage=50')).body.items;
export const pend = page => page.evaluate(() => window.__pmspace.sync.pendingDetails());
export async function settle(page, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await pend(page);
    if (!p.length) return [];
    await sleep(250);
  }
  return pend(page);
}

// the seeded workspaces
export const W1 = 'seed000000000w1';
export const W2 = 'seed000000000w2';
export const W3 = 'seed000000000w3';

export const RESULTS = path.join(OUT, 'results.jsonl');
export const results = { pass: 0, fail: 0 };
export async function check(id, name, page, fn) {
  const e0 = page.errs.length;
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, ev: 'EXCEPTION ' + String(e).split('\n')[0].slice(0, 300) };
  }
  const rec = { id, name, pass: !!r.pass, ev: r.ev, errs: page.errs.length - e0, errTxt: page.errs.slice(e0).slice(0, 3) };
  fs.appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  if (rec.pass) results.pass++;
  else results.fail++;
  console.log(`${rec.pass ? 'PASS' : 'FAIL'} [${id}] ${name} :: ${typeof r.ev === 'string' ? r.ev : JSON.stringify(r.ev)} (console errs ${rec.errs})`);
  return rec;
}
export const note = (id, txt) => {
  fs.appendFileSync(RESULTS, JSON.stringify({ id, note: true, ev: txt }) + '\n');
  console.log('NOTE', id, txt);
};
export const goSettings = async (page, sec) => {
  await page.evaluate(s => window.__pmspace.go('settings', { sec: s }), sec);
  await sleep(500);
};
export const names = page => page.$$eval('[id^="lb-name-"]', els => els.map(e => e.value));
export const sleepRender = () => sleep(250);
