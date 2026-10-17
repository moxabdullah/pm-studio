/* C4 (online typing in the subtask note while remote changes to the same task arrive) and C5 (offline toast wording).
   Same orchestrator as focus-scenario.mjs (SCENARIO=fix2-scenario.mjs node run.mjs <checkout> <out>). */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'; // 40 distinct characters, so order is checkable
const VIEW = 'QA offline view';
const VIEW2 = 'QA online view';

function installRecorder() {
  if (window.top !== window || window.__rec) return;
  window.__rec = true;
  window.__qaToasts = [];
  const text = el => (el.querySelector?.('.grow')?.textContent ?? el.textContent ?? '').trim();
  new MutationObserver(muts => {
    for (const m of muts)
      for (const n of m.addedNodes)
        if (n.nodeType === 1 && n.classList.contains('toast'))
          window.__qaToasts.push({ ms: Date.now(), text: text(n), role: n.getAttribute('role'), offline: !!window.__pmspace?.S.ui.offline });
  }).observe(document, { childList: true, subtree: true });
}

export async function runScenario(cfg) {
  const { baseUrl, proxyUrl, outDir, email, password } = cfg;
  const pbUrl = cfg.pbUrl || `http://127.0.0.1:${process.env.PB_PORT || 8095}`;
  const shotsDir = path.join(outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const fault = async mode => (await fetch(`${proxyUrl}/__fault?mode=${mode}`)).json();
  const out = { C4: null, C5: null };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [k, fn] of [
      ['C4', runC4],
      ['C5', runC5],
    ]) {
      try {
        out[k] = await fn();
      } catch (e) {
        out[k] = { error: String(e && e.stack ? e.stack : e) };
        await fault('ok').catch(() => {});
      }
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
    }
  } finally {
    await browser.close().catch(() => {});
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ C4: out.C4?.verdict ?? out.C4, C5: out.C5?.verdict ?? out.C5 }));
  }
  return out;

  async function openPage(name) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', m => m.type() === 'error' && !/status of 5\d\d/.test(m.text()) && errors.push(`console.error: ${m.text().slice(0, 200)}`));
    page.on('pageerror', e => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    await page.addInitScript(installRecorder);
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForSelector('#l-email', { timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#l-email', { timeout: 60000 });
    await page.fill('#l-email', email);
    await page.fill('#l-pw', password);
    await page.click('#login-btn');
    await page.waitForFunction(
      () => {
        const g = window.__pmspace;
        return g && g.pb.authStore.isValid && !g.S.ui.loading && !document.querySelector('.auth-card');
      },
      null,
      { timeout: 60000, polling: 250 },
    );
    const shot = async n => {
      const f = path.join(shotsDir, `${name}-${n}.png`);
      await page.screenshot({ path: f }).catch(() => {});
      return f;
    };
    return { context, page, errors, shot };
  }

  async function runC4() {
    const { context, page, errors, shot } = await openPage('C4');
    const res = { errors };
    const pick = await page.evaluate(() => {
      const t = window.__pmspace.D().tasks.find(t => !t.archived && t.title && (t.subtasks || []).length);
      return { id: t.id, title: t.title, sid: t.subtasks[0].id, note: t.subtasks[0].note || '' };
    });
    res.task = pick;
    const token = await page.evaluate(() => window.__pmspace.pb.authStore.token);
    const getRec = async () => (await fetch(`${pbUrl}/api/collections/tasks/records/${pick.id}`, { headers: { Authorization: token } })).json();
    await page.evaluate(id => (location.hash = '#/task/' + id), pick.id);
    await page.waitForSelector('#d-title', { timeout: 20000 });
    await page.locator(`[data-a="openSub"][data-sid="${pick.sid}"]`).first().click();
    await page.waitForSelector('#s-note', { timeout: 15000 });
    if (!pick.note) {
      await page.locator('#s-note').click();
      await page.keyboard.type('Base note.', { delay: 20 });
      pick.note = 'Base note.';
    }
    // wait until nothing is pending for this task, then settle
    await page
      .waitForFunction(id => !window.__pmspace.sync.pendingDetails().some(d => d.includes(id)), pick.id, { timeout: 20000, polling: 100 })
      .catch(() => {});
    await sleep(2000);
    await page.evaluate(() => (document.querySelector('#s-note').__qaMark = 1));
    await page.locator('#s-note').click();
    await page.keyboard.press('Control+End');
    const rd = () =>
      page.evaluate(
        ([id, sid]) => {
          const g = window.__pmspace;
          const t = g.D().tasks.find(x => x.id === id);
          const ed = document.querySelector('#s-note');
          const a = document.activeElement;
          return {
            store: t?.subtasks?.find(s => s.id === sid)?.note ?? null,
            storeTitle: t?.title,
            screen: ed ? ed.value : null,
            defaultValue: ed ? ed.defaultValue : null,
            sameNode: !!ed && ed.__qaMark === 1,
            focused: a === ed,
            caret: ed ? { start: ed.selectionStart, end: ed.selectionEnd, len: ed.value.length } : null,
            offline: !!g.S.ui.offline,
          };
        },
        [pick.id, pick.sid],
      );
    res.before = await rd();
    await shot('01-before');
    const expected = res.before.store + TYPED;
    // remote changes: another device edits the title (the whole doc as it sees it) while this page is typing
    const remote = async n => {
      const rec = await getRec();
      const doc = { ...rec.doc, title: `${pick.title} [remote ${n}]`, updated: Date.now() };
      const r = await fetch(`${pbUrl}/api/collections/tasks/records/${pick.id}`, {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc }),
      });
      return { n, status: r.status, atMs: Date.now() };
    };
    res.remote = [];
    const t0 = Date.now();
    const typing = page.keyboard.type(TYPED, { delay: 100 });
    const mids = [];
    const fire = async (afterMs, n) => {
      await sleep(Math.max(0, t0 + afterMs - Date.now()));
      const before = await rd();
      const r = await remote(n);
      r.charsTypedBefore = (before.screen || '').length - res.before.screen.length;
      res.remote.push(r);
    };
    const poller = (async () => {
      while (Date.now() < t0 + 4600) {
        mids.push({ ms: Date.now() - t0, ...(await rd()) });
        await sleep(100);
      }
    })();
    await Promise.all([typing, fire(1300, 1), fire(2900, 2), poller]);
    res.typingMs = Date.now() - t0;
    await sleep(600);
    res.after600 = await rd();
    await shot('02-after-typing');
    await sleep(2500);
    res.after3s = await rd();
    // monotone: every sampled value during typing is a prefix of the final expected text
    res.sampledNotPrefix = mids.filter(m => m.screen !== null && !expected.startsWith(m.screen)).map(m => ({ ms: m.ms, screen: m.screen.slice(-60) }));
    res.renderedAgain = mids.some(m => !m.sameNode);
    res.titleChanged = mids.some(m => /\[remote/.test(m.storeTitle || '')) || /\[remote/.test(res.after3s.storeTitle || '');
    // server
    let rec;
    for (const end = Date.now() + 15000; ;) {
      rec = await getRec();
      const n = rec.doc.subtasks.find(s => s.id === pick.sid)?.note;
      if (n === expected || Date.now() > end) break;
      await sleep(500);
    }
    res.server = { note: rec.doc.subtasks.find(s => s.id === pick.sid)?.note, title: rec.doc.title };
    const f = res.after3s;
    res.checks = {
      screenEqualsExpected: f.screen === expected,
      storeEqualsExpected: f.store === expected,
      screenEqualsStore: f.screen === f.store,
      caretAtEnd: !!f.caret && f.caret.start === f.caret.len && f.caret.end === f.caret.len,
      focused: f.focused,
      serverEqualsExpected: res.server.note === expected,
      noSampleOutOfOrder: res.sampledNotPrefix.length === 0,
      remoteStatuses: res.remote.map(r => r.status),
      pageRebuiltDuringTyping: res.renderedAgain,
      titleChangeArrived: res.titleChanged,
    };
    res.verdict =
      Object.entries(res.checks)
        .filter(([k]) => !['pageRebuiltDuringTyping', 'titleChangeArrived', 'remoteStatuses'].includes(k))
        .every(([, v]) => v) && res.remote.every(r => r.status === 200)
        ? 'PASS'
        : 'FAIL';
    res.expected = expected;
    res.midsSample = mids
      .filter((_, i) => i % 5 === 0)
      .map(m => ({
        ms: m.ms,
        len: (m.screen || '').length,
        same: m.sameNode,
        foc: m.focused,
        caret: m.caret && m.caret.start,
        title: (m.storeTitle || '').slice(-12),
      }));
    res.errors = errors;
    await context.close();
    return res;
  }

  async function runC5() {
    const { context, page, errors, shot } = await openPage('C5');
    const res = { errors, steps: [] };
    const token = await page.evaluate(() => window.__pmspace.pb.authStore.token);
    const prefsRec = async () => (await (await fetch(`${pbUrl}/api/collections/user_prefs/records`, { headers: { Authorization: token } })).json()).items[0];
    const viewsRec = async () => (await (await fetch(`${pbUrl}/api/collections/saved_views/records`, { headers: { Authorization: token } })).json()).items;
    res.serverBefore = {
      lang: (await prefsRec()).doc.prefs?.lang ?? null,
      tz: (await prefsRec()).doc.prefs?.tz ?? null,
      email_digest: (await prefsRec()).doc.notifPrefs.email_digest,
      views: (await viewsRec()).map(v => v.doc.name),
    };
    const toastsSince = async mark =>
      page.evaluate(m => window.__qaToasts.filter(t => t.ms >= m).map(t => ({ text: t.text, role: t.role, offline: t.offline })), mark);
    const step = async (name, fn) => {
      const mark = Date.now();
      await fn();
      await sleep(350);
      const toasts = await toastsSince(mark);
      const s = { name, offline: await page.evaluate(() => !!window.__pmspace.S.ui.offline), offlineBar: await page.locator('.offline-bar').count(), toasts };
      s.shot = await shot(name.replace(/\W+/g, '-'));
      res.steps.push(s);
      return s;
    };
    const goSec = async sec => {
      await page.evaluate(sec => window.__pmspace.go('settings', { sec }), sec);
      await page.waitForSelector('.set-body', { timeout: 10000 });
      await sleep(300);
    };
    const projId = await page.evaluate(() => window.__pmspace.D().projects[0].id);
    const gotoProject = async () => {
      await page.evaluate(id => window.__pmspace.go('project', { id, tab: 'list' }), projId);
      await page.waitForSelector('button[data-a="saveView"]', { timeout: 10000 });
      await sleep(300);
    };
    const doSaveView = async name => {
      await page.locator('button[data-a="saveView"]').click();
      await page.waitForSelector('#sv-name', { timeout: 5000 });
      await page.fill('#sv-name', name);
      await page.keyboard.press('Enter');
    };
    const doDelView = async name => {
      const tab = page.locator('button.tab[data-ctx="savedview"]', { hasText: name });
      await tab.click({ button: 'right' });
      await page.locator('button[data-a="delView"]').click();
    };
    await sleep(1500);

    // ---- go offline
    const sw = await fault('5xx');
    res.offlineAtS = null;
    const t0 = sw.since;
    const ok = await page
      .waitForFunction(() => !!window.__pmspace.S.ui.offline && !!document.querySelector('.offline-bar'), null, { timeout: 60000, polling: 200 })
      .then(() => true)
      .catch(() => false);
    res.offlineAtS = ok ? +((Date.now() - t0) / 1000).toFixed(1) : null;
    res.wentOffline = ok;
    await shot('00-offline');
    if (!ok) {
      res.verdict = 'FAIL (page never showed the offline bar)';
      await fault('ok');
      await context.close();
      return res;
    }

    // ---- offline: (a) select, (b) toggle, (c) save view, (d) delete view
    await goSec('language');
    await step('a-offline-pref-select', () => page.locator('select[data-k="lang"]').selectOption('Deutsch'));
    await goSec('notif-email');
    await step('b-offline-np-toggle', () => page.locator('input[data-k="email_digest"]').click());
    await gotoProject();
    await step('c-offline-save-view', () => doSaveView(VIEW));
    await step('d-offline-delete-view', () => doDelView(VIEW));
    res.localAfterOffline = await page.evaluate(() => ({
      lang: window.__pmspace.S.prefs.lang,
      email_digest: window.__pmspace.D().notifPrefs.email_digest,
      views: window.__pmspace.D().savedViews.map(v => v.name),
    }));

    // ---- back online
    const ok2 = await fault('ok');
    const rc = await page
      .waitForFunction(() => !window.__pmspace.S.ui.offline && !document.querySelector('.offline-bar'), null, { timeout: 150000, polling: 250 })
      .then(() => true)
      .catch(() => false);
    res.reconnectAfterOkS = rc ? +((Date.now() - ok2.since) / 1000).toFixed(1) : null;
    await sleep(5000);
    res.reconnectToasts = (await toastsSince(ok2.since)).map(t => t.text);
    // server: did the offline changes arrive?
    let pr;
    for (const end = Date.now() + 20000; ;) {
      pr = await prefsRec();
      if ((pr.doc.prefs?.lang === 'Deutsch' && pr.doc.notifPrefs.email_digest === false) || Date.now() > end) break;
      await sleep(500);
    }
    res.serverAfterReconnect = {
      lang: pr.doc.prefs?.lang ?? null,
      email_digest: pr.doc.notifPrefs.email_digest,
      views: (await viewsRec()).map(v => v.doc.name),
    };

    // ---- online wording
    await goSec('datetime');
    await step('e-online-pref-select', () => page.locator('select[data-k="tz"]').selectOption('(GMT+01:00) Berlin'));
    await goSec('notif-email');
    await step('f-online-np-toggle', () => page.locator('input[data-k="email_digest"]').click());
    await gotoProject();
    await step('g-online-save-view', () => doSaveView(VIEW2));
    await step('h-online-delete-view', () => doDelView(VIEW2));
    await sleep(3000);
    pr = await prefsRec();
    res.serverFinal = {
      tz: pr.doc.prefs?.tz ?? null,
      lang: pr.doc.prefs?.lang ?? null,
      email_digest: pr.doc.notifPrefs.email_digest,
      views: (await viewsRec()).map(v => v.doc.name),
    };

    // ---- verdict
    const exp = 'The change will be saved when your connection is back.';
    const off = res.steps.filter(s => s.name.includes('offline'));
    const offOk = off.map(s => {
      const t = s.toasts.map(x => x.text);
      return {
        step: s.name,
        offline: s.offline,
        offlineBar: s.offlineBar,
        toasts: t,
        ok: t.length >= 1 && t.some(x => x.endsWith(exp)) && t.every(x => !/saved/i.test(x.replace(exp, ''))),
      };
    });
    res.offlineChecks = offOk;
    const on = res.steps.filter(s => s.name.includes('online'));
    res.onlineChecks = on.map(s => ({ step: s.name, toasts: s.toasts.map(x => x.text) }));
    res.verdict = {
      offlineWording: offOk.every(o => o.ok && o.offline) ? 'PASS' : 'FAIL',
      onlinePrefSelect: on[0].toasts.some(t => t.text === 'Preference saved') ? 'PASS' : 'FAIL',
    };
    res.errors = errors;
    await context.close();
    return res;
  }
}
