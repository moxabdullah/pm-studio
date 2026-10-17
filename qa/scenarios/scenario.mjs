/* The sync-failure scenario ("silent give-up"), driven with Playwright. Called by run.mjs; can also be run alone against an already
   running stack:  BASE_URL=... PROXY_URL=... PROXY_LOG=... OUT_DIR=... EMAIL=... PASSWORD=... node scenario.mjs

   1. sign in, open a task, rename it to QA-<ts>, wait for the PATCH 200 (and for the realtime stream to be up)
   2. t=0: proxy -> 5xx; immediately rename the same task to QA-LOST-<ts>
   3. record toasts, offline state, pending changes and the title (drawer field, board row, store) for up to GIVEUP_MAX_S seconds
   4. note the "Couldn't save" toast (the give-up); 5. wait 15 s more and read the title
   6. proxy -> ok; record the reconnect toast and when the title changes
   7. count 404s in the proxy log after the give-up
   Writes to OUT_DIR: timeline.jsonl (everything, as it happened), summary.json, summary.txt, shots/*.png.
   Env knobs: GIVEUP_MAX_S (200), AFTER_GIVEUP_S (120), RECONNECT_MAX_S (180), QA_PHASE=smoke (stop after step 1).
   EXPECT=fix2 (default: the revised fix: restored-title name in the toast, "discarded" wording, role=alert, sticky) | main (the bug baseline) | fix (the expectations of the silent-give-up fix: give-up at ~75 s, sticky toast, the title
   reverts AT the give-up, "Reconnected, but some changes couldn't be saved.", dismissing the toast).
   SCENARIO=giveup (default) | net: the "network failure must never give up" regression check. After step 1 the network goes down, the
   task is renamed to QA-NET-<ts>, NET_DOWN_S (110) seconds pass, the network comes back. NET_MODE=abort (default: every /api request of
   the page is aborted with a connection error in the browser, so fetch really rejects, plus the proxy's `down` mode to cut the open
   realtime stream) | proxy (only the proxy's `down` mode: vite's dev proxy turns that into an HTTP 500 for the browser, so this is a
   server error to the app, not a network error). */
import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Runs in the page, before the app, on every load (so it survives a reload). Sends records to Node through window.__qaPush. */
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
        if (isToast(n))
          push({
            k: 'toast-add',
            text: textOf(n),
            action: n.querySelector('.ta')?.textContent || null,
            key: n.dataset.key || null,
            role: n.getAttribute('role'),
            sticky: n.dataset.sticky || null,
          });
      for (const n of m.removedNodes) if (isToast(n)) push({ k: 'toast-remove', text: textOf(n) });
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  let last = '';
  let lastBeat = 0;
  setInterval(() => {
    try {
      const g = window.__pmspace;
      let id = null;
      try {
        id = sessionStorage.getItem('__qaTaskId');
      } catch {
        /* no storage */
      }
      const st = { app: !!g };
      if (g) {
        st.offline = !!g.S.ui.offline;
        st.loading = !!g.S.ui.loading;
        try {
          st.pending = g.sync.pendingChanges();
          st.unsaved = g.sync.hasUnsaved();
          if (st.pending) st.details = g.sync.pendingDetails();
        } catch {
          /* sync not ready */
        }
        if (id) st.store = g.D().tasks.find(t => t.id === id)?.title ?? null;
        try {
          const h = document.documentElement;
          st.look = ['theme', 'accent', 'side', 'density', 'motion'].map(a => h.getAttribute('data-' + a)).join('/');
          st.prefs = JSON.stringify(g.S.prefs);
          st.collapsed = JSON.stringify(g.S.ui.collapsed ?? null);
          const v = g.S.views;
          st.viewsN = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : null;
        } catch {
          /* no prefs yet */
        }
      }
      st.bar = !!document.querySelector('.offline-bar');
      st.drawer = document.querySelector('#d-title')?.value ?? null;
      if (id)
        st.row = [...document.querySelectorAll(`[data-a="openTask"][data-id="${id}"]`)].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      st.toasts = [...document.querySelectorAll('#toasts .toast:not(.out) .grow')].map(e => e.textContent.trim());
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
  }, 250);
}

export async function runScenario(cfg) {
  const { baseUrl, proxyUrl, proxyLog, outDir, email, password } = cfg;
  const giveUpMaxMs = Number(process.env.GIVEUP_MAX_S || 200) * 1000;
  const afterGiveUpMs = Number(process.env.AFTER_GIVEUP_S || 120) * 1000;
  const reconnectMaxMs = Number(process.env.RECONNECT_MAX_S || 180) * 1000;
  // The drawer and the board row follow the store's revert by up to ~0.35 s (step 5 allows 1.25 s): only samples after this grace count as "title lost again"
  const REVERT_GRACE_MS = 1250;
  const smoke = process.env.QA_PHASE === 'smoke';
  const EXPECT = process.env.EXPECT || 'fix2';
  const FIX2 = EXPECT === 'fix2'; // the revised fix: restored-title name in the toast, "discarded" wording, role=alert, 150 s fault window, sign-out clears it
  const FIX = EXPECT === 'fix' || FIX2;
  const FAULT_S = Number(process.env.FAULT_S || 150); // fix2: the 5xx window, seconds from t0
  const SCEN = process.env.SCENARIO || 'giveup';
  const NET_MODE = process.env.NET_MODE || 'abort';
  const shotsDir = path.join(outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const tlFile = path.join(outDir, 'timeline.jsonl');
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
  /* resolves with the first record (already seen since `since`, or still to come) that matches; null on timeout */
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
  const readProxyLog = () =>
    fs
      .readFileSync(proxyLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  /* in-script polling of the proxy log file (the log is the ground truth for what reached the server) */
  const untilLog = async (pred, ms, every = 200) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = readProxyLog().find(pred);
      if (hit) return hit;
      if (Date.now() > end) return null;
      await sleep(every);
    }
  };
  const fault = async mode => {
    const r = await fetch(`${proxyUrl}/__fault?mode=${mode}`);
    return r.json();
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.exposeFunction('__qaPush', batch => batch.forEach(r => rec(r)));
  await page.addInitScript(installSampler);
  page.on('framenavigated', f => f === page.mainFrame() && rec({ k: 'nav', url: f.url() }));
  page.on('load', () => rec({ k: 'load' }));
  page.on('console', m => ['error', 'warning'].includes(m.type()) && rec({ k: 'console', type: m.type(), text: m.text().slice(0, 300) }));
  page.on('pageerror', e => rec({ k: 'pageerror', text: String(e).slice(0, 300) }));
  const shot = async name => {
    const file = path.join(shotsDir, `${name}.png`);
    try {
      await page.screenshot({ path: file });
    } catch (e) {
      rec({ k: 'shot-failed', name, error: String(e) });
    }
    return file;
  };
  const shots = [];
  const takeShot = async name => shots.push(await shot(name));
  // one screenshot per distinct toast text, the moment it appears
  const shotToasts = new Set();
  bus.on('rec', e => {
    if (e.k === 'toast-add' && !shotToasts.has(e.text)) {
      shotToasts.add(e.text);
      const n = shotToasts.size;
      const t0ms = marks.t0;
      const rel = t0ms ? `t${Math.round((e.ms - t0ms) / 1000)}s` : 'pre';
      takeShot(`toast-${String(n).padStart(2, '0')}-${rel}`).catch(() => {});
    }
  });

  const marks = {}; // named instants (ms epoch)
  const steps = []; // { n, name, pass, expected, observed }
  const step = (n, name, pass, expected, observed) => {
    steps.push({ n, name, pass, expected, observed });
    rec({ k: 'step', n, name, pass, expected, observed });
  };
  const result = { checkout: cfg.checkout, sha: cfg.sha, email, marks, steps };

  try {
    /* ---- warm-up: first load of vite pre-bundles dependencies and may reload; get that out of the way before signing in ---- */
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
    rec({ k: 'mark', name: 'signed-in' });

    /* ---- step 1: open a task, rename it, wait until saved ---- */
    const task = await page.evaluate(() => {
      const t = window.__pmspace.D().tasks.find(t => !t.archived && t.title);
      return t ? { id: t.id, title: t.title } : null;
    });
    if (!task) throw new Error('no task to edit in the seeded data');
    result.task = task;
    await page.evaluate(id => {
      sessionStorage.setItem('__qaTaskId', id);
      location.hash = '#/task/' + id;
    }, task.id);
    await page.waitForSelector('#d-title', { timeout: 20000 });
    await page
      .waitForSelector(`[data-a="openTask"][data-id="${task.id}"]`, { timeout: 10000 })
      .catch(() => rec({ k: 'note', text: 'no board row for the task' }));
    const stamp = Date.now();
    const title1 = `QA-${stamp}`;
    const title2 = `QA-LOST-${stamp}`;
    result.titles = { original: task.title, saved: title1, lost: title2 };
    const rename = async to => {
      const before = Date.now();
      await page.locator('#d-title').fill(to);
      await page.locator('#d-title').press('Enter');
      return before;
    };
    const e1 = await rename(title1);
    marks.edit1 = e1;
    const patchRe = new RegExp(`/records/${task.id}($|\\?)`);
    const patch = await untilLog(l => l.method === 'PATCH' && patchRe.test(l.path) && l.status === 200 && l.ms >= e1, 15000);
    // before any fault: the edit must be settled and the realtime stream up, or "reconnected" below says nothing about the bug
    // (on main a user_prefs "doc.prefs" diff stays pending forever, idle or not, so "settled" means: no pending op for this task)
    const settled = await page
      .waitForFunction(id => !window.__pmspace.sync.pendingDetails().some(d => d.includes(`tasks/${id}`)), task.id, { timeout: 15000, polling: 100 })
      .then(() => true)
      .catch(() => false);
    const lingering = await page.evaluate(() => window.__pmspace.sync.pendingDetails());
    const sseUp = await untilLog(l => l.event === 'sse-open' && l.status === 200, 20000);
    await sleep(1500); // let the server's echo of the edit arrive
    const storeTitle1 = await page.evaluate(id => window.__pmspace.D().tasks.find(t => t.id === id)?.title, task.id);
    step(
      1,
      `edit saved (${title1})`,
      !!patch && settled && storeTitle1 === title1 && !!sseUp,
      'PATCH 200 in proxy log, no pending op for the task, realtime stream open',
      `PATCH ${patch ? patch.status + ' at +' + (patch.ms - e1) + 'ms' : 'none'}, settled=${settled}, other pending=${JSON.stringify(lingering)}, store="${storeTitle1}", sse=${sseUp ? 'open' : 'none'}`,
    );
    await takeShot('01-saved-before-fault');
    if (smoke) {
      result.smoke = true;
      return finish();
    }

    /* ---- scenario net: the network goes away; nothing may be given up on ---- */
    if (SCEN === 'net') {
      const downMs = Number(process.env.NET_DOWN_S || 110) * 1000;
      const titleNet = `QA-NET-${stamp}`;
      result.titles.lost = titleNet;
      result.netMode = NET_MODE;
      const attempts = []; // what the page tried to send while the network was down (NET_MODE=abort: counted here; proxy: in the proxy log)
      const handler = route => {
        const rq = route.request();
        const u = new URL(rq.url());
        const a = { ms: Date.now(), method: rq.method(), path: u.pathname + u.search };
        attempts.push(a);
        rec({ k: 'net-attempt', ...a });
        return route.abort('connectionrefused');
      };
      if (NET_MODE === 'abort') await page.route('**/api/**', handler);
      const sw = await fault('down'); // also cuts the open realtime stream
      const t0 = (marks.t0 = sw.since);
      rec({ k: 'mark', name: 't0', at: t0 });
      const e2 = await rename(titleNet);
      marks.edit2 = e2;
      const storeLocal = await page.evaluate(id => window.__pmspace.D().tasks.find(t => t.id === id)?.title, task.id);
      step(
        2,
        'edit applied locally while the network is down',
        storeLocal === titleNet,
        'store title becomes QA-NET right after the edit',
        `edit at t0+${e2 - t0}ms, store="${storeLocal}", net mode ${NET_MODE}`,
      );
      for (const sec of [3, 55, 105]) setTimeout(() => takeShot(`02-down-t${sec}s`).catch(() => {}), Math.max(0, sec * 1000 - (Date.now() - t0)));
      await sleep(Math.max(0, downMs - (Date.now() - t0)));
      await takeShot('03-down-end');
      const preOk = await page.evaluate(id => {
        const g = window.__pmspace;
        return {
          store: g.D().tasks.find(t => t.id === id)?.title,
          drawer: document.querySelector('#d-title')?.value ?? null,
          offline: !!g.S.ui.offline,
          pending: g.sync.pendingChanges(),
          details: g.sync.pendingDetails(),
          toasts: [...document.querySelectorAll('#toasts .toast:not(.out) .grow')].map(e => e.textContent.trim()),
        };
      }, task.id);
      const back = await fault('ok');
      const tOk = (marks.ok = back.since);
      if (NET_MODE === 'abort') await page.unroute('**/api/**', handler);
      rec({ k: 'mark', name: 'ok', at: tOk });
      const rc = await waitRec(e => e.k === 'toast-add' && /^Reconnected/i.test(e.text), reconnectMaxMs, tOk);
      const patchRe2 = new RegExp(`/records/${task.id}($|\\?)`);
      const patch2 = await untilLog(l => l.method === 'PATCH' && patchRe2.test(l.path) && l.status === 200 && l.ms >= tOk, 30000);
      await sleep(6000);
      await takeShot('04-after-ok');
      const server = await page.evaluate(
        id =>
          window.__pmspace.pb
            .collection('tasks')
            .getOne(id, { requestKey: null })
            .then(r => ({ title: r.title ?? null, docTitle: r.doc?.title ?? null }))
            .catch(e => ({ error: String(e) })),
        task.id,
      );
      const final = await page.evaluate(id => {
        const g = window.__pmspace;
        return {
          store: g.D().tasks.find(t => t.id === id)?.title,
          drawer: document.querySelector('#d-title')?.value ?? null,
          row: [...document.querySelectorAll(`[data-a="openTask"][data-id="${id}"]`)].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
          offline: !!g.S.ui.offline,
          pending: g.sync.pendingChanges(),
          details: g.sync.pendingDetails(),
          toasts: [...document.querySelectorAll('#toasts .toast:not(.out) .grow')].map(e => e.textContent.trim()),
        };
      }, task.id);
      // 3: no give-up toast, ever
      const giveRe = /^Couldn't save|kept failing|undone|discarded/i;
      const gave = tl.filter(e => e.k === 'toast-add' && e.ms >= t0 && giveRe.test(e.text));
      const toastsAll = tl.filter(e => e.k === 'toast-add' && e.ms >= t0);
      step(
        3,
        'no give-up toast at any point',
        gave.length === 0,
        'none of "Couldn\'t save ..." / "... kept failing ..." / "... undone"',
        gave.length
          ? gave.map(e => `"${e.text}" at t0+${((e.ms - t0) / 1000).toFixed(1)}s`).join('; ')
          : `none; toasts seen: ${toastsAll.map(e => `"${e.text}"@${((e.ms - t0) / 1000).toFixed(1)}s`).join(', ') || 'none'}`,
      );
      // 4: the title never changes back
      const states = tl.filter(e => e.k === 'state' && e.ms >= e2);
      const bad = states.filter(
        e => (e.store != null && e.store !== titleNet) || (e.drawer != null && e.drawer !== titleNet) || (e.row || []).some(r => !r.includes(titleNet)),
      );
      step(
        4,
        'title stays QA-NET-<ts> throughout',
        states.length > 0 && bad.length === 0,
        'drawer, board row and store show QA-NET-<ts> in every sample from the edit to the end',
        `${states.length} samples, ${bad.length} differ${bad.length ? ': first at t0+' + ((bad[0].ms - t0) / 1000).toFixed(1) + 's ' + JSON.stringify({ store: bad[0].store, drawer: bad[0].drawer, row: bad[0].row }) : ''}; end of down window ${JSON.stringify({ store: preOk.store, drawer: preOk.drawer, offline: preOk.offline, pending: preOk.pending })}`,
      );
      // 5: what the page tried to send while the network was down
      let tried;
      if (NET_MODE === 'abort') tried = attempts.filter(a => a.ms >= t0 && a.ms <= tOk);
      else tried = readProxyLog().filter(l => l.method && l.ms >= t0 && l.ms <= tOk);
      const norm = p => p.split('?')[0].replace(/\/records\/[^/]+/, '/records/:id');
      const bucket = tried.reduce((a, l) => ((a[`${l.method} ${norm(l.path)}`] = (a[`${l.method} ${norm(l.path)}`] || 0) + 1), a), {});
      // The edit itself triggers one send (a POST/PATCH per pending op) the moment it is made; that first send is what finds the network
      // gone and puts the page offline. After it, while offline, only the health probe (GET) may go out.
      const FIRST_SEND_MS = 1500;
      const writes = tried.filter(l => l.method !== 'GET');
      const firstSend = writes.filter(l => l.ms - t0 <= FIRST_SEND_MS);
      const laterWrites = writes.filter(l => l.ms - t0 > FIRST_SEND_MS);
      const gets = tried.filter(l => l.method === 'GET');
      const probes = gets.filter(l => l.path.includes('/api/health')).map(l => l.ms);
      const gaps = probes.slice(1).map((v, i) => +((v - probes[i]) / 1000).toFixed(1));
      result.attempts = {
        mode: NET_MODE,
        total: tried.length,
        byRoute: bucket,
        firstSend: firstSend.map(l => `${l.method} ${norm(l.path)} @t0+${((l.ms - t0) / 1000).toFixed(2)}s`),
        laterWrites: laterWrites.length,
        probeGapsS: gaps.length ? { min: Math.min(...gaps), max: Math.max(...gaps), n: probes.length } : null,
      };
      step(
        5,
        'no PATCH/POST attempts while offline (after the first send)',
        laterWrites.length === 0,
        `only the first send (within ${FIRST_SEND_MS} ms of the edit), then GET /api/health probes`,
        `${tried.length} request(s) tried (${NET_MODE === 'abort' ? 'aborted in the browser' : 'seen by the proxy'}): ${JSON.stringify(bucket)}; first send: ${firstSend.map(l => `${l.method} ${norm(l.path)}`).join(', ') || 'none'}; writes after it: ${laterWrites.length}${laterWrites.length ? ' [' + laterWrites.map(l => `${l.method} ${norm(l.path)} @t0+${((l.ms - t0) / 1000).toFixed(1)}s ${l.status ?? ''}`).join(', ') + ']' : ''}; health probes ${probes.length}, gaps ${JSON.stringify(result.attempts.probeGapsS)}`,
      );
      // 6: saved after the network is back
      step(
        6,
        'edit saved after the network is back',
        !!patch2 && (server.title === titleNet || server.docTitle === titleNet),
        'PATCH 200 for the task in the proxy log after ok, and the server holds QA-NET-<ts>',
        `PATCH ${patch2 ? '200 at ok+' + ((patch2.ms - tOk) / 1000).toFixed(1) + 's' : 'none'}; server ${JSON.stringify(server)}; final ${JSON.stringify(final)}`,
      );
      step(
        7,
        'reconnect toast',
        !!rc && rc.text === 'Reconnected. All changes are synced.',
        '"Reconnected. All changes are synced." (or "Reconnected." when the always-pending prefs op interferes)',
        rc ? `"${rc.text}" at ok+${((rc.ms - tOk) / 1000).toFixed(1)}s` : 'not seen',
      );
      return finish();
    }

    /* ---- step 2: fault, then edit again straight away ---- */
    const sw = await fault('5xx');
    const t0 = (marks.t0 = sw.since);
    rec({ k: 'mark', name: 't0', at: t0 });
    const e2 = await rename(title2);
    marks.edit2 = e2;
    const storeTitle2 = await page.evaluate(id => window.__pmspace.D().tasks.find(t => t.id === id)?.title, task.id);
    step(
      2,
      'second edit applied locally under fault',
      storeTitle2 === title2,
      'store title becomes QA-LOST right after the edit',
      `edit at t0+${e2 - t0}ms, store="${storeTitle2}"`,
    );
    for (const s of FIX2 ? [3, 30, 90, 110, 125, 145] : [3, 30, 90, 125])
      setTimeout(() => takeShot(`02-fault-t${s}s`).catch(() => {}), Math.max(0, s * 1000 - (Date.now() - t0)));

    /* ---- steps 3-4: watch until the give-up toast ---- */
    const giveUp = await waitRec(e => e.k === 'toast-add' && /^Couldn't save/i.test(e.text), giveUpMaxMs - (Date.now() - t0), t0);
    if (giveUp) {
      marks.giveUp = giveUp.ms;
      await sleep(600);
      await takeShot('03-giveup-toast');
    }
    const gs = giveUp ? (giveUp.ms - t0) / 1000 : null;
    {
      // step 3: what the page showed while the server was failing (full detail is in the timelines of summary.txt)
      const during = tl.filter(e => e.ms >= t0 && e.ms <= (giveUp?.ms ?? Date.now()));
      const toastsDuring = during.filter(e => e.k === 'toast-add');
      const offlineAt = during.find(e => e.k === 'state' && e.offline === true);
      step(
        3,
        'toasts, offline state and title recorded while failing',
        during.some(e => e.k === 'state'),
        'timelines recorded (no pass/fail expectation)',
        `${toastsDuring.length} toast(s) before the give-up: ${toastsDuring.map(e => `"${e.text}" @${((e.ms - t0) / 1000).toFixed(1)}s`).join('; ') || 'none'}; ` +
          `offline ${offlineAt ? 'true from ' + ((offlineAt.ms - t0) / 1000).toFixed(1) + 's' : 'never became true'}`,
      );
    }
    const sickWarns = () => tl.filter(e => e.k === 'console' && e.ms >= t0 && /has failed with a server error/.test(e.text));
    if (FIX2) {
      const want = `Couldn't save your change to \u201c${title1}\u201d. The server kept failing, so it was discarded.`;
      const w = sickWarns();
      const got = giveUp ? giveUp.text : null;
      const diffAt = got ? [...got].findIndex((c, i) => c !== want[i]) : -1;
      const roleLive = await page.evaluate(() =>
        [...document.querySelectorAll('#toasts .toast')].map(t => ({
          role: t.getAttribute('role'),
          sticky: t.dataset.sticky || null,
          key: t.dataset.key || null,
          text: t.querySelector('.grow')?.textContent.trim(),
        })),
      );
      result.giveUpToast = {
        text: got,
        want,
        role: giveUp?.role ?? null,
        sticky: giveUp?.sticky ?? null,
        key: giveUp?.key ?? null,
        live: roleLive,
        codepointsNonAscii: got
          ? [...got].filter(c => c.charCodeAt(0) > 127).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
          : null,
      };
      step(
        4,
        'give-up toast: about 75 s, exact text',
        !!giveUp && gs > 55 && gs < 110 && got === want,
        `at about 75 s; exactly: ${want}`,
        giveUp
          ? `"${got}" at t0+${gs.toFixed(1)}s, text ${got === want ? 'IDENTICAL' : 'DIFFERS at index ' + diffAt}, key=${giveUp.key}; give-up warnings: ${
              w
                .map(e =>
                  e.text
                    .replace(/\d{6,}/g, 'N')
                    .replace(/^warning: /, '')
                    .slice(0, 60),
                )
                .join(' | ') || 'none'
            }`
          : `not seen within ${giveUpMaxMs / 1000}s`,
      );
      step(
        '4b',
        'give-up toast element has role="alert"',
        giveUp?.role === 'alert',
        'role="alert" (and sticky)',
        `role=${JSON.stringify(giveUp?.role)}, data-sticky=${JSON.stringify(giveUp?.sticky)}; toasts in DOM just after the give-up: ${JSON.stringify(roleLive)}`,
      );
    } else if (FIX) {
      const re = /^Couldn't save (your change to “QA-LOST-\d+”|a change)( \(and \d+ more\))?\. The server kept failing, so (it was|they were) undone\.$/;
      const w = sickWarns();
      step(
        4,
        'give-up toast (the fix: about 75 s, new wording)',
        !!giveUp && gs > 55 && gs < 110 && re.test(giveUp.text),
        'at about 75 s (not 135 s); "Couldn\'t save your change to “QA-LOST-<ts>” (and N more). The server kept failing, so they were undone." or the no-name "Couldn\'t save a change ..."',
        (giveUp
          ? `"${giveUp.text}" at t0+${gs.toFixed(1)}s, wording ${re.test(giveUp.text) ? 'matches' : 'DOES NOT match'}, sticky key=${giveUp.key}`
          : `not seen within ${giveUpMaxMs / 1000}s`) +
          `; give-up warnings in console order: ${
            w
              .map(e =>
                e.text
                  .replace(/\d{6,}/g, 'N')
                  .replace(/^warning: /, '')
                  .slice(0, 60),
              )
              .join(' | ') || 'none'
          }`,
      );
    } else
      step(
        4,
        '"Couldn\'t save" toast (the give-up)',
        !!giveUp && gs > 120 && gs < 150,
        'about 135 s after the fault, within 200 s',
        giveUp ? `"${giveUp.text}" at t0+${gs.toFixed(1)}s` : `not seen within ${giveUpMaxMs / 1000}s`,
      );

    /* ---- step 5: what the title shows after the give-up ---- */
    const readTitles = () =>
      page.evaluate(id => {
        const g = window.__pmspace;
        return {
          drawer: document.querySelector('#d-title')?.value ?? null,
          row: [...document.querySelectorAll(`[data-a="openTask"][data-id="${id}"]`)].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
          store: g.D().tasks.find(t => t.id === id)?.title ?? null,
          offline: !!g.S.ui.offline,
          pending: g.sync.pendingChanges(),
          details: g.sync.pendingDetails(),
          unsaved: g.sync.hasUnsaved(),
          toasts: [...document.querySelectorAll('#toasts .toast:not(.out)')].map(t => ({
            key: t.dataset.key || null,
            role: t.getAttribute('role'),
            text: t.querySelector('.grow')?.textContent.trim(),
          })),
        };
      }, task.id);
    if (giveUp) {
      await sleep(Math.max(0, afterGiveUpMs - (Date.now() - giveUp.ms)));
      const after = await readTitles();
      marks.afterGiveUp = Date.now();
      await takeShot('04-giveup-plus15s');
      if (FIX) {
        // 5a: the title reverts AT the give-up (drawer field, board row and store each), 5b: the give-up toast is still up after 15 s
        const after0 = tl.filter(e => e.k === 'state' && e.ms >= t0);
        const firstAt = f => after0.find(f)?.ms ?? null;
        const rs = firstAt(e => e.store === title1);
        const rd = firstAt(e => e.drawer === title1);
        const rr = firstAt(e => (e.row || []).length && e.row.every(r => r.includes(title1) && !r.includes(title2)));
        const d = v => (v == null ? null : +((v - giveUp.ms) / 1000).toFixed(2));
        const lag = { store: d(rs), drawer: d(rd), row: d(rr) };
        marks.reverted = rs;
        result.revertLagS = lag;
        const okLag = Object.values(lag).every(v => v != null && v >= -0.5 && v <= 1.25);
        step(
          5,
          'title reverts AT the give-up (within ~1 s)',
          okLag,
          'drawer, board row and store show QA-<ts> within ~1 s of the give-up toast (sampler resolution 0.25 s)',
          `seconds after the give-up toast: ${JSON.stringify(lag)}`,
        );
        const holds = [after.drawer, after.store, ...after.row.map(r => (r.includes(title1) && !r.includes(title2) ? title1 : r))].every(
          v => v === title1 || v === null,
        );
        const toastUp = after.toasts.some(t => /kept failing/.test(t.text || ''));
        step(
          '5b',
          `give-up toast still on screen ${afterGiveUp(afterGiveUpMs)}s after the give-up, title stays QA-<ts>`,
          toastUp && holds,
          'give-up toast present (sticky), title still QA-<ts>',
          JSON.stringify(after),
        );
        marks.afterGiveUpState = after;
      } else {
        const still = [after.drawer, after.store, ...after.row.map(r => (r.includes(title2) ? title2 : r))].every(v => v === title2 || v === null);
        step(5, `title ${afterGiveUp(afterGiveUpMs)}s after the give-up`, still, 'still QA-LOST-... (the lost edit is still on screen)', JSON.stringify(after));
      }
    } else step(5, 'title after the give-up', false, FIX ? 'QA-<ts> within ~1 s of the give-up' : 'still QA-LOST-...', 'no give-up toast to measure from');

    /* ---- fix2: steps 6-9. Keep the 5xx on until FAULT_S, record, switch to ok, record, sign out with the sticky toast up, count 404s ---- */
    if (FIX2) {
      const rel1 = ms => +((ms - t0) / 1000).toFixed(1);
      await sleep(Math.max(0, FAULT_S * 1000 - (Date.now() - t0)));
      const preOk = await readTitles();
      const back = await fault('ok');
      const tOk = (marks.ok = back.since);
      rec({ k: 'mark', name: 'ok', at: tOk });
      // step 6: what the page showed between the give-up and the switch to ok (descriptive, not a pass/fail)
      {
        const gu = giveUp ? giveUp.ms : t0;
        const win = tl.filter(e => e.ms > gu && e.ms <= tOk);
        const toastsWin = win.filter(e => e.k === 'toast-add');
        const offTrans = [];
        let lastOff;
        const stBefore = [...tl.filter(e => e.k === 'state' && e.ms <= gu)].pop();
        lastOff = stBefore?.offline;
        offTrans.push(`${rel1(gu)}s: offline=${lastOff}`);
        for (const e of win.filter(e => e.k === 'state'))
          if (e.offline !== lastOff) {
            lastOff = e.offline;
            offTrans.push(`${rel1(e.ms)}s: offline=${e.offline}`);
          }
        const outs = win.filter(e => e.k === 'toast-out' || e.k === 'toast-remove').map(e => `${e.k} "${e.text.slice(0, 70)}" @${rel1(e.ms)}s`);
        const reqWin = readProxyLog().filter(l => l.method && l.ms > gu && l.ms <= tOk);
        const reqSummary = reqWin.reduce(
          (a, l) => (
            (a[`${l.method} ${l.path.split('?')[0].replace(/\/records\/[^/]+/, '/records/:id')} ${l.status}`] =
              (a[`${l.method} ${l.path.split('?')[0].replace(/\/records\/[^/]+/, '/records/:id')} ${l.status}`] || 0) + 1),
            a
          ),
          {},
        );
        result.window = {
          toasts: toastsWin.map(e => ({ s: rel1(e.ms), text: e.text, action: e.action, role: e.role, sticky: e.sticky })),
          offline: offTrans,
          outs,
          requests: reqSummary,
          preOk: {
            offline: preOk.offline,
            pending: preOk.pending,
            details: preOk.details,
            toasts: preOk.toasts,
            drawer: preOk.drawer,
            store: preOk.store,
            row: preOk.row,
          },
        };
        step(
          6,
          `give-up (${giveUp ? rel1(giveUp.ms) + ' s' : 'none'}) to ok (${rel1(tOk)} s): toasts and offline state (recorded, no expectation)`,
          true,
          'record every toast and the offline state; pre-existing quirk possible: online + "Reconnected, but your data could not be reloaded" at the next poll (~105 s) while still failing',
          `toasts: ${toastsWin.length ? toastsWin.map(e => `"${e.text}" @${rel1(e.ms)}s [role=${e.role}${e.sticky ? ',sticky' : ''}]`).join('; ') : 'none'}; offline: ${offTrans.join(' -> ')}; toast fades/removals: ${outs.join('; ') || 'none'}; requests in window: ${JSON.stringify(reqSummary)}; just before ok: ${JSON.stringify({ offline: preOk.offline, pending: preOk.pending, details: preOk.details, toasts: preOk.toasts.map(t => t.text) })}`,
        );
      }
      // step 7: after ok
      const offAtOk = preOk.offline;
      const rcWait = offAtOk ? reconnectMaxMs : 40000;
      const rc = await waitRec(e => e.k === 'toast-add' && /^Reconnected/i.test(e.text), rcWait, tOk);
      if (rc) {
        await sleep(700);
        await takeShot('05-after-reconnect');
      }
      await sleep(6000);
      const final = await readTitles();
      await takeShot('06-final');
      const afterOkToasts = tl.filter(e => e.k === 'toast-add' && e.ms > tOk);
      const lostSamples = tl.filter(
        e =>
          e.k === 'state' &&
          e.ms >= (marks.reverted ?? Infinity) + REVERT_GRACE_MS &&
          (e.store === title2 || e.drawer === title2 || (e.row || []).some(r => r.includes(title2))),
      );
      const server = await page.evaluate(
        id =>
          window.__pmspace.pb
            .collection('tasks')
            .getOne(id, { requestKey: null })
            .then(r => ({ title: r.title ?? null, docTitle: r.doc?.title ?? null }))
            .catch(e => ({ error: String(e) })),
        task.id,
      );
      result.serverAfter = server;
      const want7 = "Reconnected, but some changes couldn't be saved.";
      const titleOk =
        final.store === title1 && final.drawer === title1 && final.row.every(r => r.includes(title1) && !r.includes(title2)) && lostSamples.length === 0;
      const serverOk = server.title === title1 || server.docTitle === title1;
      step(
        7,
        'after ok: reconnect toast, title stays QA-<ts>, server holds QA-<ts>',
        (offAtOk ? !!rc && rc.text === want7 : true) && titleOk && serverOk,
        `page still offline at ok -> toast "${want7}"; title QA-<ts> in drawer/row/store with no QA-LOST sample after the revert; server record QA-<ts>`,
        `offline at ok=${offAtOk}; reconnect toast ${rc ? `"${rc.text}" at ok+${((rc.ms - tOk) / 1000).toFixed(1)}s [role=${rc.role}]` : 'not seen'}; all toasts after ok: ${afterOkToasts.map(e => `"${e.text}"@ok+${((e.ms - tOk) / 1000).toFixed(1)}s`).join(', ') || 'none'}; QA-LOST samples after revert: ${lostSamples.length}; server ${JSON.stringify(server)}; final ${JSON.stringify({ drawer: final.drawer, row: final.row, store: final.store, offline: final.offline, pending: final.pending, details: final.details, unsaved: final.unsaved, toasts: final.toasts })}`,
      );
      // step 8: sign out through the UI with the sticky toast still on screen
      {
        const stickyBefore = final.toasts.filter(t => /kept failing/.test(t.text || ''));
        let how = '';
        let dialog = null;
        let loginShown = false;
        let after = null;
        try {
          await shot('07-before-signout');
          await page.locator('[data-a="pop"][data-pop="user"]:visible').first().click({ timeout: 5000 });
          await page.locator('.mi[data-a="signOut"]').first().waitFor({ timeout: 5000 });
          await shot('07b-user-menu');
          await page.locator('.mi[data-a="signOut"]').first().click({ timeout: 5000 });
          // "Sign out with unsent changes?" would be a confirm dialog; record it and accept
          await sleep(500);
          dialog = await page.evaluate(() => document.querySelector('#mt-confirm')?.textContent || null);
          if (dialog) {
            rec({ k: 'note', text: 'sign-out confirm dialog: ' + dialog });
            await page.click('[data-a="confirmOk"]', { timeout: 5000 });
          }
          await page.waitForSelector('#l-email', { timeout: 10000 });
          loginShown = true;
          await sleep(800);
        } catch (e) {
          how = String(e).slice(0, 200);
        }
        after = await page
          .evaluate(() => ({
            url: location.href,
            login: !!document.querySelector('#l-email'),
            toastEls: [...document.querySelectorAll('#toasts .toast')].map(t => ({
              text: t.querySelector('.grow')?.textContent.trim(),
              sticky: t.dataset.sticky || null,
              out: t.classList.contains('out'),
            })),
            stickyEls: document.querySelectorAll('#toasts .toast[data-sticky]').length,
            bodyHasText: /kept failing|Couldn.t save/.test(document.body.innerText),
          }))
          .catch(e => ({ error: String(e) }));
        await takeShot('08-signin-page-after-signout');
        await sleep(3000);
        const later = await page
          .evaluate(() => ({
            stickyEls: document.querySelectorAll('#toasts .toast[data-sticky]').length,
            bodyHasText: /kept failing|Couldn.t save/.test(document.body.innerText),
            toasts: [...document.querySelectorAll('#toasts .toast')].length,
          }))
          .catch(e => ({ error: String(e) }));
        result.signOut = { stickyBefore, dialog, after, later };
        step(
          8,
          'sign out via the UI with the sticky toast on screen: sign-in page has no sticky toast',
          stickyBefore.length > 0 && loginShown && after.stickyEls === 0 && !after.bodyHasText && later.stickyEls === 0 && !later.bodyHasText,
          'sticky give-up toast on screen before; on the sign-in page no sticky toast and no "kept failing" text (at once and 3 s later)',
          `sticky toast(s) before: ${JSON.stringify(stickyBefore.map(t => t.text))}; confirm dialog: ${JSON.stringify(dialog)}; sign-in page shown: ${loginShown}${how ? ' (' + how + ')' : ''}; right after: ${JSON.stringify(after)}; +3 s: ${JSON.stringify(later)}`,
        );
      }
      // step 9: 404s
      {
        const log = readProxyLog().filter(l => l.status !== undefined && l.method);
        const from = marks.giveUp || t0;
        const after404 = log.filter(l => l.status === 404 && l.ms > from);
        const all404 = log.filter(l => l.status === 404);
        const bucket = after404.reduce((a, l) => {
          const k = `${l.method} ${l.path.split('?')[0].replace(/\/records\/[^/]+/, '/records/:id')}`;
          a[k] = (a[k] || 0) + 1;
          return a;
        }, {});
        result.n404 = { afterGiveUp: after404.length, wholeRun: all404.length, byRoute: bucket };
        step(
          9,
          '404s in the proxy log after the give-up',
          true,
          'count (no expectation)',
          `${after404.length} after the give-up, ${all404.length} in the whole run ${JSON.stringify(bucket)}`,
        );
      }
      return finish();
    }

    /* ---- step 6: bring the server back ---- */
    const back = await fault('ok');
    const tOk = (marks.ok = back.since);
    rec({ k: 'mark', name: 'ok', at: tOk });
    const reconnect = waitRec(e => e.k === 'toast-add' && /^Reconnected/i.test(e.text), reconnectMaxMs, tOk);
    const reverted = FIX ? Promise.resolve(null) : waitRec(e => e.k === 'state' && e.store != null && e.store !== title2, reconnectMaxMs, tOk);
    const [rc, rv] = await Promise.all([reconnect, reverted]);
    if (rv) {
      marks.reverted = rv.ms;
      await sleep(700);
      await takeShot('05-after-reconnect');
    } else if (FIX && rc) {
      await sleep(700);
      await takeShot('05-after-reconnect');
    }
    await sleep(6000); // late toasts
    const final = await readTitles();
    await takeShot('06-final');
    const toastsBetween = tl.filter(
      e => e.k === 'toast-add' && marks.giveUp && e.ms > marks.giveUp + 500 && e.ms < (rv?.ms ?? Infinity) && !/^Reconnected/i.test(e.text),
    );
    if (FIX) {
      const wasUp = final.toasts.some(t => /kept failing/.test(t.text || ''));
      const back2 = tl.filter(
        e =>
          e.k === 'state' &&
          e.ms >= (marks.reverted ?? Infinity) + REVERT_GRACE_MS &&
          (e.store === title2 || e.drawer === title2 || (e.row || []).some(r => r.includes(title2))),
      );
      const server = await page.evaluate(
        id =>
          window.__pmspace.pb
            .collection('tasks')
            .getOne(id, { requestKey: null })
            .then(r => ({ title: r.title ?? null, docTitle: r.doc?.title ?? null }))
            .catch(e => ({ error: String(e) })),
        task.id,
      );
      result.serverAfter = server;
      const want = "Reconnected, but some changes couldn't be saved.";
      step(
        6,
        'reconnect toast, title stays QA-<ts>, give-up toast still up',
        !!rc && rc.text === want && back2.length === 0 && final.store === title1 && wasUp,
        `toast "${want}"; no QA-LOST sample after the revert; give-up toast still on screen`,
        `toast ${rc ? `"${rc.text}" at ok+${((rc.ms - tOk) / 1000).toFixed(1)}s` : 'not seen'}; samples showing QA-LOST after the revert: ${back2.length}; give-up toast on screen after reconnect (+6 s): ${wasUp}; server title ${JSON.stringify(server)}; final ${JSON.stringify({ drawer: final.drawer, row: final.row, store: final.store, offline: final.offline, pending: final.pending, details: final.details, unsaved: final.unsaved })}`,
      );
      // 6b: dismiss it with its X
      let dismissed = false;
      let how = '';
      try {
        await shot('06b-before-dismiss');
        await page.click('#toasts .toast[data-key="refused"] .ibtn', { timeout: 3000 });
        await sleep(800);
        dismissed = await page.evaluate(() => ![...document.querySelectorAll('#toasts .toast')].some(t => /kept failing/.test(t.textContent)));
        await shot('07-after-dismiss');
      } catch (e) {
        how = String(e).slice(0, 200);
      }
      step(
        '6b',
        'dismiss the give-up toast with its X button',
        dismissed,
        'the toast goes when its X is clicked',
        dismissed ? 'gone within 0.8 s' : `still there or no X found ${how}`,
      );
    } else
      step(
        6,
        'reconnect: toast text and title revert',
        !!rc && rc.text === 'Reconnected. All changes are synced.' && !!rv && rv.store === title1,
        'toast "Reconnected. All changes are synced." and title silently reverts to QA-<ts>',
        `toast ${rc ? `"${rc.text}" at ok+${((rc.ms - tOk) / 1000).toFixed(1)}s` : 'not seen'}; title ${rv ? `changed to "${rv.store}" at ok+${((rv.ms - tOk) / 1000).toFixed(1)}s` : 'did not change'}; ` +
          `other toasts between give-up and revert: ${toastsBetween.length ? toastsBetween.map(t => `"${t.text}"`).join(', ') : 'none'}; final ${JSON.stringify(final)}`,
      );

    /* ---- step 7: 404s ---- */
    const log = readProxyLog().filter(l => l.status !== undefined && l.method);
    const from = marks.giveUp || t0;
    const after404 = log.filter(l => l.status === 404 && l.ms > from);
    const all404 = log.filter(l => l.status === 404);
    const bucket = after404.reduce((a, l) => {
      const k = `${l.method} ${l.path.split('?')[0].replace(/\/records\/[^/]+/, '/records/:id')}`;
      a[k] = (a[k] || 0) + 1;
      return a;
    }, {});
    result.n404 = { afterGiveUp: after404.length, wholeRun: all404.length, byRoute: bucket };
    step(
      7,
      '404s in the proxy log after the give-up',
      true,
      'count (no baseline expectation)',
      `${after404.length} after ${marks.giveUp ? 'give-up' : 't0 (no give-up seen)'}, ${all404.length} in the whole run ${JSON.stringify(bucket)}`,
    );
    return finish();
  } catch (err) {
    rec({ k: 'scenario-error', error: String(err && err.stack ? err.stack : err) });
    result.error = String(err && err.stack ? err.stack : err);
    await takeShot('99-error').catch(() => {});
    return finish();
  }

  function afterGiveUp(ms) {
    return Math.round(ms / 1000);
  }

  async function finish() {
    try {
      result.syncStats = await page.evaluate(() => {
        const s = window.__pmspace?.sync?.stats;
        return s ? JSON.parse(JSON.stringify({ ...s, log: (s.log || []).slice(-40) })) : null;
      });
    } catch {
      /* page gone */
    }
    await sleep(700);
    await browser.close().catch(() => {});
    Object.assign(result, analyse(tl, marks, readProxyLog));
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outDir, 'summary.txt'), render(result));
    console.log(render(result));
    return result;
  }
}

/* ---------- analysis ---------- */
function analyse(tl, marks, readProxyLog) {
  const t0 = marks.t0 ?? tl.find(e => e.k === 'mark' && e.name === 'signed-in')?.ms ?? 0;
  const rel = ms => (ms == null ? null : +((ms - t0) / 1000).toFixed(2));
  // toasts: pair every add with the next out (fade start) / remove (+160 ms) of the same text
  const toasts = [];
  for (const e of tl.filter(e => e.k === 'toast-add')) {
    const out = tl.find(o => o.k === 'toast-out' && o.text === e.text && o.ms >= e.ms && !o.used);
    if (out) out.used = true;
    const rm = tl.find(o => o.k === 'toast-remove' && o.text === e.text && o.ms >= e.ms && !o.used);
    if (rm) rm.used = true;
    toasts.push({ text: e.text, action: e.action, startS: rel(e.ms), endS: rel(out?.ms ?? rm?.ms ?? null), removedS: rel(rm?.ms ?? null) });
  }
  const transitions = pick => {
    const out = [];
    let last;
    for (const e of tl.filter(e => e.k === 'state')) {
      const v = JSON.stringify(pick(e));
      if (v !== last) {
        out.push({ s: rel(e.ms), ...pick(e) });
        last = v;
      }
    }
    return out;
  };
  const titleTimeline = transitions(e => ({ drawer: e.drawer, row: e.row, store: e.store }));
  const offlineTimeline = transitions(e => ({ offline: e.offline, bar: e.bar }));
  const pendingTimeline = transitions(e => ({ pending: e.pending, unsaved: e.unsaved, details: e.details }));
  const lookTimeline = transitions(e => ({ look: e.look, collapsed: e.collapsed, viewsN: e.viewsN }));
  const prefsChanges = [];
  {
    let prev = null;
    for (const e of tl.filter(e => e.k === 'state' && e.prefs)) {
      if (e.prefs === prev) continue;
      let cur;
      try {
        cur = JSON.parse(e.prefs);
      } catch {
        continue;
      }
      if (prev) {
        const was = JSON.parse(prev);
        const keys = [...new Set([...Object.keys(was), ...Object.keys(cur)])].filter(k => JSON.stringify(was[k]) !== JSON.stringify(cur[k]));
        prefsChanges.push({ s: rel(e.ms), changed: keys.map(k => `${k}: ${JSON.stringify(was[k])} -> ${JSON.stringify(cur[k])}`) });
      } else prefsChanges.push({ s: rel(e.ms), changed: ['(first sample)'] });
      prev = e.prefs;
    }
  }
  const loads = tl.filter(e => e.k === 'load').map(e => rel(e.ms));
  const consoleMsgs = {};
  for (const e of tl.filter(e => e.k === 'console' || e.k === 'pageerror')) {
    const k = `${e.type || 'pageerror'}: ${e.text.replace(/\d{6,}/g, 'N').slice(0, 140)}`;
    consoleMsgs[k] = (consoleMsgs[k] || 0) + 1;
  }
  const proxy = readProxyLog();
  const statusCounts = {};
  for (const l of proxy.filter(l => l.method && l.ms >= t0)) statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  const phases = {
    giveUpS: rel(marks.giveUp),
    okS: rel(marks.ok),
    revertedS: rel(marks.reverted),
    editSecondAtS: rel(marks.edit2),
  };
  return {
    t0,
    phases,
    toasts,
    titleTimeline,
    offlineTimeline,
    pendingTimeline,
    lookTimeline,
    prefsChanges,
    loads,
    consoleMsgs,
    proxyStatusCountsSinceT0: statusCounts,
  };
}

function render(r) {
  const L = [];
  L.push(`checkout ${r.checkout} @ ${r.sha}   user ${r.email}`);
  if (r.task) L.push(`task ${r.task.id}: "${r.task.title}" -> ${r.titles.saved} -> ${r.titles.lost}`);
  L.push('', 'STEPS');
  for (const s of r.steps) L.push(`  ${s.pass ? 'PASS' : 'FAIL'}  ${s.n}. ${s.name}\n        expected: ${s.expected}\n        observed: ${s.observed}`);
  if (r.error) L.push('', 'SCENARIO ERROR', r.error);
  L.push('', `PHASES (seconds from t0 = proxy switched to 5xx): ${JSON.stringify(r.phases)}`);
  L.push('', 'TOASTS (start s -> end s; end = fade start; negative = before t0)');
  for (const t of r.toasts) L.push(`  ${String(t.startS).padStart(8)} -> ${String(t.endS).padStart(8)}  "${t.text}"${t.action ? `  [${t.action}]` : ''}`);
  L.push('', 'OFFLINE STATE (S.ui.offline / .offline-bar)');
  for (const t of r.offlineTimeline) L.push(`  ${String(t.s).padStart(8)}  offline=${t.offline} bar=${t.bar}`);
  L.push('', 'PENDING CHANGES (sync.pendingChanges / hasUnsaved)');
  for (const t of r.pendingTimeline)
    L.push(`  ${String(t.s).padStart(8)}  pending=${t.pending} unsaved=${t.unsaved}${t.details ? ' ' + JSON.stringify(t.details) : ''}`);
  L.push('', 'TITLE (drawer field | board row | store)');
  for (const t of r.titleTimeline)
    L.push(`  ${String(t.s).padStart(8)}  drawer=${JSON.stringify(t.drawer)} row=${JSON.stringify(t.row)} store=${JSON.stringify(t.store)}`);
  L.push('', 'VIEW LOOK (html data-theme/accent/side/density/motion | S.ui.collapsed | saved views count)');
  for (const t of r.lookTimeline || []) L.push(`  ${String(t.s).padStart(8)}  look=${t.look} collapsed=${t.collapsed} views=${t.viewsN}`);
  L.push('', 'S.prefs CHANGES (diff against the previous sample)');
  for (const t of r.prefsChanges || []) L.push(`  ${String(t.s).padStart(8)}  ${t.changed.join('; ') || '(none)'}`);
  if (r.attempts)
    L.push(
      '',
      `NETWORK ATTEMPTS while down (mode ${r.attempts.mode}): ${r.attempts.total} ${JSON.stringify(r.attempts.byRoute)}`,
      `  first send: ${JSON.stringify(r.attempts.firstSend)}; later writes: ${r.attempts.laterWrites}; probe gaps (s): ${JSON.stringify(r.attempts.probeGapsS)}`,
    );
  if (r.revertLagS) L.push('', `REVERT LAG vs give-up toast (s): ${JSON.stringify(r.revertLagS)}`);
  L.push('', `page loads at s: ${JSON.stringify(r.loads)}`);
  L.push(`proxy statuses since t0: ${JSON.stringify(r.proxyStatusCountsSinceT0)}`);
  const cm = Object.entries(r.consoleMsgs || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (cm.length) L.push('browser console (top):', ...cm.map(([k, n]) => `  ${n}x ${k}`));
  return L.join('\n');
}

// standalone use
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const e = process.env;
  runScenario({ baseUrl: e.BASE_URL, proxyUrl: e.PROXY_URL, proxyLog: e.PROXY_LOG, outDir: e.OUT_DIR, email: e.EMAIL, password: e.PASSWORD }).then(() =>
    process.exit(0),
  );
}
