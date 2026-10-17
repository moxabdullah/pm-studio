/* Focus / put-back scenario. For each editor (A = task description #d-desc, B = subtask note #s-note):
   sign in, open the editor, focus it, proxy -> 5xx, type " REFUSED-1" with real keystrokes, wait for the give-up toast,
   read screen/store/focus/caret at +1 s and +5 s, type "X", read again, proxy -> ok, wait for reconnect, read the record from PocketBase.
   Env: EDITORS=A,B (default both), GIVEUP_MAX_S (200), RECONNECT_MAX_S (180), QA_PHASE=smoke (stop after the editor is open and settled). */
import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MARK = 'REFUSED-1';
const MARK2 = 'MORE-2';
const LATER_S = Number(process.env.LATER_TYPE_S || 0); // >0: type ' MORE-2' this many seconds after the first keystroke, while still failing

/* Runs in the page before the app, on every load. */
function installSampler() {
  if (window.top !== window || window.__qaInstalled) return;
  window.__qaInstalled = true;
  const buf = [];
  const flush = () => {
    if (typeof window.__qaPush === 'function' && buf.length) window.__qaPush(buf.splice(0));
  };
  const push = r => {
    buf.push({ ms: Date.now(), ...r });
    flush();
  };
  setInterval(flush, 500);
  const textOf = el => (el.querySelector?.('.grow')?.textContent ?? el.textContent ?? '').trim();
  const isToast = n => n.nodeType === 1 && n.classList.contains('toast');
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes') {
        if (isToast(m.target) && m.target.classList.contains('out')) push({ k: 'toast-out', text: textOf(m.target) });
        continue;
      }
      for (const n of m.addedNodes)
        if (isToast(n)) push({ k: 'toast-add', text: textOf(n), role: n.getAttribute('role'), sticky: n.dataset.sticky || null, key: n.dataset.key || null });
      for (const n of m.removedNodes) if (isToast(n)) push({ k: 'toast-remove', text: textOf(n) });
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  const cfg = () => {
    if (window.__qaCfg) return window.__qaCfg;
    try {
      return JSON.parse(sessionStorage.getItem('__qaCfg') || 'null');
    } catch {
      return null;
    }
  };
  /* everything we want to know about the editor, in one object */
  window.__qaRead = () => {
    const g = window.__pmspace;
    const c = cfg();
    const out = { app: !!g, cfg: !!c };
    if (!g || !c) return out;
    const A = c.kind === 'A';
    const t = g.D().tasks.find(x => x.id === c.tid);
    out.store = A ? (t?.desc ?? null) : (t?.subtasks?.find(s => s.id === c.sid)?.note ?? null);
    const ed = document.querySelector(A ? '#d-desc' : '#s-note');
    out.editorPresent = !!ed;
    if (ed) {
      out.screen = A ? ed.innerHTML : ed.value;
      out.screenText = A ? ed.textContent : ed.value;
      out.sameNode = ed.__qaMark === 1;
      if (!A) out.defaultValue = ed.defaultValue;
      const a = document.activeElement;
      out.focused = a === ed;
      if (!A && ed === a) out.caret = { start: ed.selectionStart, end: ed.selectionEnd, len: ed.value.length };
      if (A) {
        const s = getSelection();
        if (s.rangeCount && ed.contains(s.anchorNode) && ed.contains(s.focusNode)) {
          const r = document.createRange();
          r.selectNodeContents(ed);
          r.setEnd(s.anchorNode, s.anchorOffset);
          const r2 = document.createRange();
          r2.selectNodeContents(ed);
          r2.setEnd(s.focusNode, s.focusOffset);
          out.caret = { start: r.toString().length, end: r2.toString().length, len: ed.textContent.length };
        }
      }
    }
    const a = document.activeElement;
    out.active = a ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.isContentEditable ? '[ce]' : '') : null;
    out.offline = !!g.S.ui.offline;
    out.offlineBar = !!document.querySelector('.offline-bar');
    try {
      out.pending = g.sync.pendingChanges();
      out.details = g.sync.pendingDetails();
    } catch {
      /* not ready */
    }
    out.toasts = [...document.querySelectorAll('#toasts .toast:not(.out)')].map(e => ({
      role: e.getAttribute('role'),
      text: e.querySelector('.grow')?.textContent.trim(),
    }));
    return out;
  };
  let last = '';
  let lastBeat = 0;
  setInterval(() => {
    try {
      const st = window.__qaRead();
      const j = JSON.stringify(st);
      const now = Date.now();
      if (j !== last || now - lastBeat > 5000) {
        last = j;
        lastBeat = now;
        push({ k: 'state', ...st });
      }
    } catch (e) {
      push({ k: 'sampler-error', error: String(e) });
    }
  }, 200);
}

export async function runScenario(cfg) {
  const { baseUrl, proxyUrl, proxyLog, outDir, email, password } = cfg;
  const pbUrl = cfg.pbUrl || `http://127.0.0.1:${process.env.PB_PORT || 8095}`;
  const giveUpMaxMs = Number(process.env.GIVEUP_MAX_S || 200) * 1000;
  const reconnectMaxMs = Number(process.env.RECONNECT_MAX_S || 180) * 1000;
  const smoke = process.env.QA_PHASE === 'smoke';
  const editors = (process.env.EDITORS || 'A,B').split(',');
  const shotsDir = path.join(outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const readProxyLog = () =>
    fs
      .readFileSync(proxyLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  const fault = async mode => (await fetch(`${proxyUrl}/__fault?mode=${mode}`)).json();
  const all = {};

  const browser = await chromium.launch({ headless: true });
  try {
    for (const kind of editors) all[kind] = await runEditor(kind);
  } finally {
    await browser.close().catch(() => {});
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(all.A?.checks ?? null), JSON.stringify(all.B?.checks ?? null));
  }
  return all;

  async function runEditor(kind) {
    const A = kind === 'A';
    const sel = A ? '#d-desc' : '#s-note';
    const tlFile = path.join(outDir, `timeline-${kind}.jsonl`);
    fs.writeFileSync(tlFile, '');
    const tl = [];
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    const rec = r => {
      const e = { ms: Date.now(), ...r };
      tl.push(e);
      fs.appendFileSync(tlFile, JSON.stringify(e) + '\n');
      bus.emit('rec', e);
      return e;
    };
    const waitRec = (pred, ms, since = 0) =>
      new Promise(resolve => {
        const hit = tl.find(e => e.ms >= since && pred(e));
        if (hit) return resolve(hit);
        const to = setTimeout(() => done(null), ms);
        const on = e => e.ms >= since && pred(e) && done(e);
        const done = v => {
          clearTimeout(to);
          bus.off('rec', on);
          resolve(v);
        };
        bus.on('rec', on);
      });
    const result = { kind, notes: [] };
    const startMs = Date.now();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.exposeFunction('__qaPush', batch => batch.forEach(r => rec(r)));
    await page.addInitScript(installSampler);
    page.on('console', m => ['error', 'warning'].includes(m.type()) && rec({ k: 'console', type: m.type(), text: m.text().slice(0, 300) }));
    page.on('pageerror', e => rec({ k: 'pageerror', text: String(e).slice(0, 300) }));
    page.on('request', r => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/collections/') && ['PATCH', 'POST', 'DELETE'].includes(r.method()) && !u.pathname.includes('auth-'))
        rec({ k: 'req', method: r.method(), path: u.pathname, body: (r.postData() || '').slice(0, 4000) });
    });
    page.on('response', r => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/collections/') && ['PATCH', 'POST', 'DELETE'].includes(r.request().method()) && !u.pathname.includes('auth-'))
        rec({ k: 'res', method: r.request().method(), path: u.pathname, status: r.status() });
    });
    const shot = async name => {
      const file = path.join(shotsDir, `${kind}-${name}.png`);
      try {
        await page.screenshot({ path: file });
      } catch (e) {
        rec({ k: 'shot-failed', name, error: String(e) });
      }
      (result.shots ||= []).push(file);
      return file;
    };
    const read = () => page.evaluate(() => window.__qaRead());

    // ---- sign in
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

    // ---- pick a task (B: one with a subtask) and open the editor
    const pick = await page.evaluate(kind => {
      const tasks = window.__pmspace.D().tasks.filter(t => !t.archived && t.title);
      const t = kind === 'A' ? tasks.find(t => t.desc && t.desc.length > 20) || tasks[0] : tasks.find(t => (t.subtasks || []).length);
      return t
        ? {
            id: t.id,
            title: t.title,
            sid: kind === 'B' ? t.subtasks[0].id : null,
            desc: t.desc,
            note: kind === 'B' ? t.subtasks[0].note : null,
            nsub: (t.subtasks || []).length,
          }
        : null;
    }, kind);
    if (!pick) throw new Error(`no task suitable for editor ${kind}`);
    result.task = pick;
    await page.evaluate(
      ([c]) => {
        window.__qaCfg = c;
        sessionStorage.setItem('__qaCfg', JSON.stringify(c));
        location.hash = '#/task/' + c.tid;
      },
      [{ kind, tid: pick.id, sid: pick.sid }],
    );
    await page.waitForSelector('#d-title', { timeout: 20000 });
    if (!A) {
      await page.locator(`[data-a="openSub"][data-sid="${pick.sid}"]`).first().click();
    }
    await page.waitForSelector(sel, { timeout: 15000 });
    if (!A && !pick.note) {
      // give the note a saved base value first, so the put-back has something to go back to
      const e1 = Date.now();
      await page.locator(sel).click();
      await page.keyboard.type('Base note.', { delay: 20 });
      const re = new RegExp(`/records/${pick.id}($|\\?)`);
      for (const end = Date.now() + 15000; Date.now() < end;) {
        if (readProxyLog().find(l => l.method === 'PATCH' && re.test(l.path) && l.status === 200 && l.ms >= e1)) break;
        await sleep(200);
      }
      result.notes.push('pre-typed base note "Base note." and waited for the PATCH');
    }
    // settled: nothing pending for this task, realtime stream (re)opened for this page
    const settled = await page
      .waitForFunction(id => !window.__pmspace.sync.pendingDetails().some(d => d.includes(id)), pick.id, { timeout: 15000, polling: 100 })
      .then(() => true)
      .catch(() => false);
    const sse = await (async () => {
      const end = Date.now() + 20000;
      for (;;) {
        const hit = readProxyLog().find(l => l.event === 'sse-open' && l.status === 200 && l.ms >= startMs);
        if (hit || Date.now() > end) return !!hit;
        await sleep(200);
      }
    })();
    await sleep(1500);
    await page.evaluate(sel => (document.querySelector(sel).__qaMark = 1), sel);
    await page.locator(sel).click();
    await page.keyboard.press('Control+End');
    const s0 = await read();
    result.before = s0;
    result.settled = { settled, sse };
    await shot('01-before-fault');
    if (smoke) {
      result.smoke = true;
      await context.close();
      return result;
    }

    // ---- fault, type, wait for the give-up
    const sw = await fault('5xx');
    const t0 = sw.since;
    const tType = Date.now();
    await page.keyboard.type(' ' + MARK, { delay: 30 });
    await sleep(300);
    const sTyped = await read();
    result.typed = { atMsAfterFault: tType - t0, state: sTyped };
    await shot('02-typed');
    const isGiveUp = e => e.k === 'toast-add' && /couldn.t save|discarded|kept failing/i.test(e.text); // by its text: other role=alert toasts are not the give-up
    if (LATER_S > 0) {
      await sleep(Math.max(0, tType + LATER_S * 1000 - Date.now()));
      const pre = await read();
      await page.keyboard.type(' ' + MARK2, { delay: 30 });
      await sleep(300);
      result.later = { atS: +((Date.now() - tType) / 1000).toFixed(1), before: pre, after: await read() };
      await shot('02b-typed-later');
    }
    let giveUp;
    if (process.env.GIVEUP_BY === 'store') {
      // the edited field's own give-up: the store no longer holds the refused text (a toast for another record's give-up is not it)
      const end = tType + giveUpMaxMs;
      for (;;) {
        const s = await read();
        if (!(s.store || '').includes(MARK) && !(s.store || '').includes(MARK2) && Date.now() - tType > 3000) {
          const tl2 = [...tl].reverse().find(isGiveUp);
          giveUp = { ms: Date.now(), text: (tl2 && tl2.text) || (s.toasts[0] && s.toasts[0].text) || '', role: tl2 && tl2.role, sticky: tl2 && tl2.sticky };
          break;
        }
        if (Date.now() > end) break;
        await sleep(100);
      }
    } else giveUp = await waitRec(isGiveUp, giveUpMaxMs - (Date.now() - tType), tType);
    if (!giveUp) {
      result.notes.push('no give-up toast within ' + giveUpMaxMs / 1000 + ' s');
      result.checks = { C1: 'FAIL (no give-up)', C2: 'FAIL (no give-up)', C3: 'FAIL (no give-up)' };
      await fault('ok');
      await context.close();
      return result;
    }
    result.giveUp = {
      afterFirstKeystrokeS: +((giveUp.ms - tType) / 1000).toFixed(1),
      afterFaultS: +((giveUp.ms - t0) / 1000).toFixed(1),
      text: giveUp.text,
      role: giveUp.role,
      sticky: giveUp.sticky,
    };
    // all toasts seen since the fault
    const sample = async (label, delayMs) => {
      await sleep(Math.max(0, giveUp.ms + delayMs - Date.now()));
      const s = await read();
      await shot(label);
      return { at: `+${((Date.now() - giveUp.ms) / 1000).toFixed(1)}s`, ...s };
    };
    result.s1 = await sample('03-giveup+1s', 1000);
    result.s5 = await sample('04-giveup+5s', 5000);

    // ---- one more keystroke
    const tX = Date.now();
    await page.keyboard.type('X');
    await sleep(600);
    result.afterX_600ms = await read();
    await shot('05-after-X');
    await sleep(2400);
    result.afterX_3s = await read();
    result.requestsAfterX = tl.filter(e => (e.k === 'req' || e.k === 'res') && e.ms >= tX);

    // ---- back online
    const ok = await fault('ok');
    const tOk = ok.since;
    const rc = await waitRec(
      e => (e.k === 'toast-add' && /^Reconnected/i.test(e.text)) || (e.k === 'state' && e.app && e.offline === false && e.ms > tOk + 500),
      reconnectMaxMs,
      tOk,
    );
    result.reconnect = rc
      ? { afterOkS: +((rc.ms - tOk) / 1000).toFixed(1), what: rc.k === 'toast-add' ? 'toast "' + rc.text + '"' : 'state offline=false' }
      : 'not within ' + reconnectMaxMs / 1000 + ' s';
    await sleep(5000);
    result.final = await read();
    await shot('06-final');
    result.requestsAfterOk = tl.filter(e => (e.k === 'req' || e.k === 'res') && e.ms >= tOk);
    result.requestsAfterX = tl.filter(e => (e.k === 'req' || e.k === 'res') && e.ms >= tX); // everything sent after the extra keystroke, to the end
    const token = await page.evaluate(() => window.__pmspace.pb.authStore.token);
    const r = await fetch(`${pbUrl}/api/collections/tasks/records/${pick.id}`, { headers: { Authorization: token } });
    const body = await r.text();
    result.server = {
      status: r.status,
      hasMarker: body.includes(MARK) || body.includes(MARK2),
      snippet: A ? (JSON.parse(body).desc ?? null) : JSON.stringify(JSON.parse(body).subtasks ?? JSON.parse(body).doc?.subtasks ?? null).slice(0, 600),
    };
    result.server.raw = body.slice(0, 3000);
    result.toastsAll = tl
      .filter(e => e.k === 'toast-add' && e.ms >= tType)
      .map(e => ({ s: +((e.ms - tType) / 1000).toFixed(1), text: e.text, role: e.role, sticky: e.sticky }));
    result.console = tl.filter(e => e.k === 'console' || e.k === 'pageerror').map(e => `${e.type || 'pageerror'}: ${e.text}`.slice(0, 200));

    // ---- checks
    const has = v => typeof v === 'string' && (v.includes(MARK) || v.includes(MARK2));
    const agree = s => has(s.screenText) === has(s.store);
    const c1 =
      [result.s1, result.s5].every(agree) && !has(result.s1.store) && !has(result.s5.store) && [result.s1, result.s5].every(s => s.screenText === s.store);
    const caretOk = s => s.focused && s.active.includes(A ? '#d-desc' : '#s-note') && s.caret && s.caret.start === s.caret.end && s.caret.start <= s.caret.len;
    const xLanded =
      (result.afterX_600ms.screenText || '').includes('X') && (result.afterX_600ms.screenText || '').length > (result.s5.screenText || '').length - 1;
    const c2 = caretOk(result.s1) && caretOk(result.s5) && caretOk(result.afterX_600ms) && xLanded;
    const sent = result.requestsAfterX.filter(e => e.k === 'req' && (e.body.includes(MARK) || e.body.includes(MARK2)));
    const c3 = !has(result.afterX_600ms.store) && !has(result.afterX_3s.store) && sent.length === 0 && !result.server.hasMarker;
    result.checks = {
      C1: c1 ? 'PASS' : 'FAIL',
      C2: c2 ? 'PASS' : 'FAIL',
      C3: c3 ? 'PASS' : 'FAIL',
      detail: {
        screenHasMarker: [has(result.s1.screenText), has(result.s5.screenText)],
        storeHasMarker: [has(result.s1.store), has(result.s5.store)],
        focused: [result.s1.focused, result.s5.focused, result.afterX_600ms.focused],
        sameNode: [result.s1.sameNode, result.s5.sameNode],
        caret: [result.s1.caret, result.s5.caret, result.afterX_600ms.caret],
        xLanded,
        storeHasMarkerAfterX: [has(result.afterX_600ms.store), has(result.afterX_3s.store)],
        patchBodiesWithMarkerAfterX: sent.length,
        serverHasMarker: result.server.hasMarker,
      },
    };
    await context.close();
    return result;
  }
}
