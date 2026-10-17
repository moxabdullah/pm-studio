// Rail tooltip + rail a11y suite (branch fix/rail-tooltips-a11y vs origin/main). Each check passes when the FIXED behaviour holds, so on main the
// checks that depend on the change fail; every check also records NEG, the observed main-specific symptom (no #rail-tip, old names, ...), and
// on main "confirmed" = (pass is false and NEG is true). Checks that must behave the same on both builds carry no NEG.
// RT1 painted; RT2 keyboard (+RT2c mouse focus is not focus-visible); RT3 dismiss; RT4 re-render (render(), a live event, a live rename);
// RT5 scroll; RT6 not elsewhere (expanded, topbar, design system, drawer, "["); RT7 dark theme; A1 popups+names; A2 current; A3 groups;
// A4 project rows; A5 shortcuts; K2b focus across "["; C1 console.
// Round 2 (branch c1f8bea): R2a..R2h at the end. RT_ONLY=R2 runs only the groups whose name starts with R2 (a comma list is allowed: RT,R2a,R2b).
// Round 3 (branch dbfd78a): R3a..R3e after R2h.
// Env: PM_BASE, PM_PB, PM_OUT (lib.mjs), RT_BUILD (label only). Needs the scratch PocketBase (login + the live-event checks).
import * as L from '../lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { rawRgba } from '../lib/png.mjs';
const { sleep, OUT } = L;
const BUILD = process.env.RT_BUILD || 'fix';
const RES = OUT + '/results.jsonl';
fs.writeFileSync(RES, '');
L.note('SETUP', `build=${BUILD} base=${L.BASE} out=${OUT}`);
const b = await L.launch();
const allErrs = [];
const ONLY = process.env.RT_ONLY || '';
const group = async (name, fn) => {
  if (ONLY && !ONLY.split(',').some(p => name.startsWith(p))) return;
  try {
    await fn();
  } catch (e) {
    await L.check('ERR-' + name, `group ${name} crashed`, { errs: [] }, async () => ({
      pass: false,
      ev: String(e.stack || e)
        .split('\n')
        .slice(0, 3)
        .join(' | ')
        .slice(0, 400),
    }));
  }
};
// pass = the fixed behaviour holds; neg = the symptom main is expected to show (undefined when the check is the same on both builds)
const chk = (id, name, page, fn) =>
  L.check(id, name, page, async () => {
    const r = await fn();
    return { pass: r.pass, ev: { ...r.ev, NEG: r.neg } };
  });

// ---- helpers (copied from sb.mjs: mk, setCollapsed, quiet, park, goTo, pixelDiff)
async function mk(w, h, tag) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await L.open(ctx, tag);
  await L.login(page, 'hello@example.com');
  await page.waitForSelector('nav.side .sproj', { state: 'attached', timeout: 15000 });
  page.ctx = ctx;
  return page;
}
const done = async page => {
  allErrs.push(...page.errs);
  await page.ctx.close();
};
const isCol = p => p.evaluate(() => document.querySelector('.shell')?.classList.contains('collapsed'));
async function setCollapsed(page, want, how = 'button') {
  if ((await isCol(page)) === want) return { changed: false, how: 'already' };
  if (how === 'button') await page.locator('nav.side [data-a="toggleSide"]:visible').first().click();
  else {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('[');
  }
  await page.waitForFunction(w => document.querySelector('.shell').classList.contains('collapsed') === w, want, { timeout: 5000 });
  await page.waitForFunction(
    w => {
      const r = document.querySelector('nav.side').getBoundingClientRect().width;
      return w ? r > 20 && r < 70 : r > 150;
    },
    want,
    { timeout: 5000 },
  );
  await quiet(page);
  return { changed: true, how };
}
const quiet = page =>
  page.evaluate(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      const a = document.getAnimations().filter(x => x.playState === 'running' && x.effect?.getComputedTiming().iterations !== Infinity);
      if (!a.length) break;
      await Promise.race([Promise.allSettled(a.map(x => x.finished)), new Promise(r => setTimeout(r, 400))]);
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
const park = async page => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(900, 720);
  await quiet(page);
};
const goTo = async (page, route, params, waitSel) => {
  await page.evaluate(([r, p]) => window.__pmspace.go(r, p), [route, params || {}]);
  await page.waitForSelector(waitSel, { timeout: 8000 });
  await quiet(page);
};
const route = page =>
  page.evaluate(() => ({ route: window.__pmspace.S.ui.route, params: window.__pmspace.S.ui.params, expanded: { ...window.__pmspace.S.ui.expanded } }));
async function restore(page) {
  try {
    await setCollapsed(page, false, 'button');
    const left = await L.settle(page, 8000);
    if (left.length) L.note('RESTORE', 'pending after restore: ' + JSON.stringify(left).slice(0, 200));
  } catch (e) {
    L.note('RESTORE', 'failed: ' + String(e).split('\n')[0]);
  }
}
async function pixelDiff(a, c) {
  // a, c: Buffers or file paths
  const [x, y] = await Promise.all([rawRgba(a), rawRgba(c)]);
  if (x.info.width !== y.info.width || x.info.height !== y.info.height)
    return { sameSize: false, a: [x.info.width, x.info.height], b: [y.info.width, y.info.height] };
  let n = 0,
    x0 = 1e9,
    y0 = 1e9,
    x1 = -1,
    y1 = -1;
  const w = x.info.width;
  for (let i = 0; i < x.data.length; i += 4)
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3]) {
      n++;
      const p = i / 4,
        px = p % w,
        py = (p / w) | 0;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
  return { sameSize: true, diffPixels: n, bbox: n ? [x0, y0, x1, y1] : null };
}

// ---- tip helpers
const tipState = page =>
  page.evaluate(() => {
    const t = document.getElementById('rail-tip');
    if (!t) return { exists: false };
    const r = t.getBoundingClientRect(),
      cs = getComputedStyle(t);
    return {
      exists: true,
      hidden: t.hidden,
      display: cs.display,
      text: t.textContent,
      opacity: cs.opacity,
      l: r.left,
      t: r.top,
      r: r.right,
      b: r.bottom,
      w: r.width,
      h: r.height,
      bg: cs.backgroundColor,
      color: cs.color,
      position: cs.position,
      ariaHidden: t.getAttribute('aria-hidden'),
      inBody: t.parentElement === document.body,
      anims: t.getAnimations().length,
    };
  });
const vis = s => !!(s.exists && !s.hidden && s.display !== 'none');
const hasTip = page => page.evaluate(() => !!document.getElementById('rail-tip'));
// waits until #rail-tip is shown and its fade is done (opacity 1); on a build without #rail-tip it only waits for the old ::after to have played
async function waitTip(page, ms = 2500) {
  if (!(await hasTip(page))) {
    await sleep(650);
    return false;
  }
  try {
    await page.waitForFunction(
      () => {
        const t = document.getElementById('rail-tip');
        return t && !t.hidden && getComputedStyle(t).opacity === '1';
      },
      null,
      { timeout: ms, polling: 'raf' },
    );
    return true;
  } catch {
    return false;
  }
}
// stays hidden/absent for ms (polls every frame); returns the number of frames it was visible
const visibleFrames = (page, ms) =>
  page.evaluate(async ms => {
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const t = document.getElementById('rail-tip');
      if (t && !t.hidden && getComputedStyle(t).display !== 'none') n++;
      await new Promise(r => requestAnimationFrame(r));
    }
    return n;
  }, ms);
const ITEMS = {
  Home: 'nav.side .sitem[data-r="home"]',
  'Expand sidebar': 'nav.side .side-scroll > button[data-a="toggleSide"]',
  Project: 'nav.side .sproj > .sitem',
  Team: 'nav.side .sitem[data-r="team"]',
  Help: 'nav.side [data-pop="help"]',
  Settings: 'nav.side .sitem[data-r="settings"]',
  Account: 'nav.side .side-bot [data-pop="user"]',
};
const hover = async (page, sel) => {
  const l = page.locator(sel).first();
  await l.scrollIntoViewIfNeeded();
  await l.hover();
};
const geom = (page, sel) =>
  page.evaluate(sel => {
    const e = document.querySelector(sel);
    const r = e.getBoundingClientRect();
    return {
      dataTip: e.getAttribute('data-tip'),
      pos: e.getAttribute('data-tip-pos'),
      l: r.left,
      t: r.top,
      r: r.right,
      b: r.bottom,
      cy: (r.top + r.bottom) / 2,
      vw: innerWidth,
      vh: innerHeight,
      railR: document.querySelector('nav.side').getBoundingClientRect().right,
    };
  }, sel);
// the tip's placement against an item's box
const placed = (g, s) =>
  vis(s) &&
  s.l >= g.railR - 1.5 &&
  Math.abs(s.l - (g.r + 8)) <= 1.5 &&
  Math.abs((s.t + s.b) / 2 - g.cy) <= 2 &&
  s.l >= 0 &&
  s.r <= g.vw &&
  s.t >= 0 &&
  s.b <= g.vh;

// ---- CDP accessibility
async function withCdp(page, fn) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  try {
    return await fn(cdp);
  } finally {
    await cdp.detach();
  }
}
async function axOne(cdp, page, sel) {
  const ok = await page.evaluate(sel => {
    const e = document.querySelector(sel);
    if (!e) return false;
    e.setAttribute('data-qa-x', '1');
    return true;
  }, sel);
  if (!ok) return null;
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-qa-x="1"]' });
    const { node } = await cdp.send('DOM.describeNode', { nodeId });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = nodes.find(x => x.backendDOMNodeId === node.backendNodeId) || nodes[0];
    const props = {};
    for (const p of n.properties || []) props[p.name] = p.value?.value;
    return { role: n.role?.value ?? null, name: String(n.name?.value ?? ''), ignored: !!n.ignored, props };
  } finally {
    await page.evaluate(() => document.querySelectorAll('[data-qa-x]').forEach(e => e.removeAttribute('data-qa-x')));
  }
}

// =============== RT1 painted, RT2 keyboard, RT2c mouse focus, RT3 dismiss (1280x800, rail collapsed)
await group('RT1', async () => {
  const P = await mk(1280, 800, 'RT1');
  await setCollapsed(P, true);
  await park(P);
  const per = [];
  for (const [label, sel] of Object.entries(ITEMS)) {
    await park(P);
    const loc = P.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    const g0 = await geom(P, sel);
    const y0 = Math.max(0, Math.floor(g0.t - 16));
    const clip = { x: Math.ceil(g0.railR), y: y0, width: 170, height: Math.min(g0.vh - y0, Math.ceil(g0.b - g0.t + 32)) };
    const off = await P.screenshot({ clip });
    await loc.hover();
    await waitTip(P);
    const on = await P.screenshot({ clip });
    const fn = label.replace(/\W+/g, '_');
    fs.writeFileSync(path.join(OUT, `RT1-${fn}-off.png`), off);
    fs.writeFileSync(path.join(OUT, `RT1-${fn}-on.png`), on);
    const d = await pixelDiff(off, on);
    const g = await geom(P, sel),
      s = await tipState(P);
    await P.screenshot({
      path: path.join(OUT, `RT1-${fn}-full.png`),
      clip: { x: 0, y: Math.max(0, Math.floor(g.t - 30)), width: 260, height: Math.min(g.vh - Math.max(0, Math.floor(g.t - 30)), Math.ceil(g.b - g.t + 60)) },
    });
    per.push({
      label,
      dataTip: g.dataTip,
      text: s.text,
      exists: s.exists,
      shown: vis(s),
      opacity: s.opacity,
      dx: s.exists ? Math.round((s.l - g.r) * 10) / 10 : null,
      leftVsRailRight: s.exists ? Math.round((s.l - g.railR) * 10) / 10 : null,
      dy: s.exists ? Math.round(((s.t + s.b) / 2 - g.cy) * 10) / 10 : null,
      inViewport: s.exists && s.l >= 0 && s.r <= g.vw && s.t >= 0 && s.b <= g.vh,
      tipBox: s.exists ? [s.l, s.t, s.r, s.b].map(Math.round) : null,
      itemBox: [g.l, g.t, g.r, g.b].map(Math.round),
      diffPixels: d.diffPixels,
      ok: placed(g, s) && s.text === g.dataTip && s.opacity === '1' && d.diffPixels > 50,
      files: `RT1-${fn}-off.png RT1-${fn}-on.png RT1-${fn}-full.png`,
    });
  }
  const s0 = await tipState(P);
  await chk(
    'RT1',
    `collapsed rail: hover on Home, Expand sidebar, a project, a team, Help, Settings, Account paints #rail-tip (text = data-tip, 8px right of the item, centred +-2px, inside the viewport, pixels change right of the rail)`,
    P,
    async () => ({
      pass: per.every(x => x.ok) && s0.position === 'fixed' && s0.inBody && s0.ariaHidden === 'true',
      neg: per.every(x => !x.exists && x.diffPixels <= 50),
      ev: {
        passed: per.filter(x => x.ok).length + '/' + per.length,
        tipElement: { position: s0.position, inBody: s0.inBody, ariaHidden: s0.ariaHidden },
        items: per.map(x => ({
          item: x.label,
          dataTip: x.dataTip,
          text: x.text,
          dx: x.dx,
          dy: x.dy,
          tipLeftVsRailRightEdge: x.leftVsRailRight,
          inVP: x.inViewport,
          diffPx: x.diffPixels,
          ok: x.ok,
        })),
      },
    }),
  );
  L.note('RT1', JSON.stringify(per.map(x => ({ item: x.label, tipBox: x.tipBox, itemBox: x.itemBox, files: x.files }))));
  await restore(P);
  await done(P);
});

await group('RT2', async () => {
  const P = await mk(1280, 800, 'RT2');
  await setCollapsed(P, true);
  await park(P);
  await P.reload();
  await P.waitForSelector('nav.side .sproj', { state: 'attached' });
  await quiet(P);
  await P.mouse.move(900, 720);
  const stops = [];
  let inSide = false,
    tipHome = null;
  for (let i = 0; i < 70; i++) {
    await P.keyboard.press('Tab');
    const a = await P.evaluate(() => {
      const e = document.activeElement;
      const r = e.getBoundingClientRect();
      return {
        inSide: !!e.closest('nav.side'),
        tag: e.tagName.toLowerCase(),
        dataTip: e.getAttribute('data-tip'),
        pos: e.getAttribute('data-tip-pos'),
        label: e.getAttribute('aria-label'),
        fv: e.matches(':focus-visible'),
        l: r.left,
        t: r.top,
        r: r.right,
        b: r.bottom,
        cy: (r.top + r.bottom) / 2,
        railR: document.querySelector('nav.side').getBoundingClientRect().right,
        vw: innerWidth,
        vh: innerHeight,
        key: e.dataset.r || e.dataset.a || e.dataset.pop || '',
      };
    });
    if (a.inSide) inSide = true;
    else if (inSide) break;
    if (!a.inSide) continue;
    const tipped = a.pos === 'right';
    if (tipped) await waitTip(P, 2000);
    else await sleep(500);
    const s = await tipState(P);
    stops.push({ ...a, tipped, s, ok: tipped ? placed(a, s) && s.text === a.dataTip && s.opacity === '1' : !vis(s) });
    if (a.key === 'home' && tipped) tipHome = s.text;
  }
  const bad = stops.filter(x => !x.ok);
  const tippedStops = stops.filter(x => x.tipped);
  await P.screenshot({ path: path.join(OUT, 'RT2-focus-last.png'), clip: { x: 0, y: 0, width: 320, height: 800 } });
  await chk(
    'RT2',
    `Tab through the collapsed rail: every tipped stop shows its own tip on focus-visible (position and text), untipped stops show none`,
    P,
    async () => ({
      pass: stops.length > 20 && tippedStops.length >= 20 && bad.length === 0 && tipHome === 'Home' && stops.every(x => x.fv),
      neg: !(await hasTip(P)) && tippedStops.length > 0,
      ev: {
        stops: stops.length,
        tipped: tippedStops.length,
        ok: stops.filter(x => x.ok).length,
        homeTip: tipHome,
        allFocusVisible: stops.every(x => x.fv),
        sequence: stops.map(x => `${x.key}${x.tipped ? '' : '(untipped)'}${x.ok ? '' : '!'}`).join(' '),
        bad: bad
          .slice(0, 5)
          .map(x => ({ key: x.key, dataTip: x.dataTip, tip: x.s.exists ? { text: x.s.text, vis: vis(x.s), opacity: x.s.opacity } : 'no #rail-tip' })),
      },
    }),
  );
  await restore(P);
  await done(P);
});

await group('RT2c', async () => {
  // fresh page: the last input is the mouse. A click on a rail item (it navigates and renders) leaves focus on it, not as focus-visible
  const P = await mk(1280, 800, 'RT2c');
  await setCollapsed(P, true);
  await park(P);
  await P.reload();
  await P.waitForSelector('nav.side .sproj', { state: 'attached' });
  await quiet(P);
  await P.mouse.move(900, 720);
  await P.locator(ITEMS.Home.replace('home', 'inbox')).first().click();
  await P.waitForFunction(() => window.__pmspace.S.ui.route === 'inbox', null, { timeout: 4000 });
  await quiet(P);
  const f1 = await P.evaluate(() => {
    const e = document.activeElement;
    return { el: e.tagName.toLowerCase() + (e.dataset.r ? '[' + e.dataset.r + ']' : ''), fv: e.matches(':focus-visible'), inSide: !!e.closest('nav.side') };
  });
  await P.mouse.move(900, 720, { steps: 6 });
  const frames = await visibleFrames(P, 900);
  const s = await tipState(P);
  await P.screenshot({ path: path.join(OUT, 'RT2c-after-click-away.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  await chk(
    'RT2c',
    `a mouse click on a rail item (Inbox) then the pointer moves away: the item keeps focus but it is not :focus-visible and no tip shows`,
    P,
    async () => ({
      pass: !f1.fv && frames === 0 && !vis(s) && (await route(P)).route === 'inbox',
      ev: { focusAfterClick: f1, framesTipVisibleAfterMouseAway: frames, tip: s.exists ? { hidden: s.hidden } : 'no #rail-tip' },
    }),
  );
  // after real keyboard use, then a click (informational variant)
  await P.keyboard.press('Tab');
  await P.keyboard.press('Shift+Tab');
  await P.locator(ITEMS.Home).first().click();
  await P.waitForFunction(() => window.__pmspace.S.ui.route === 'home', null, { timeout: 4000 });
  await quiet(P);
  const f2 = await P.evaluate(() => {
    const e = document.activeElement;
    return { el: e.tagName.toLowerCase() + (e.dataset.r ? '[' + e.dataset.r + ']' : ''), fv: e.matches(':focus-visible'), inSide: !!e.closest('nav.side') };
  });
  await P.mouse.move(900, 720, { steps: 6 });
  const frames2 = await visibleFrames(P, 900);
  L.note('RT2c', `after Tab/Shift+Tab then a click on Home: focus ${JSON.stringify(f2)}, tip visible frames after the pointer left: ${frames2}`);
  await chk('RT2d', `(extra) Tab, Shift+Tab (keyboard modality), then a mouse click on Home and the pointer leaves: no tip afterwards`, P, async () => ({
    pass: frames2 === 0,
    ev: { focusAfterClick: f2, framesTipVisible: frames2 },
  }));
  await restore(P);
  await done(P);
});

await group('RT3', async () => {
  const P = await mk(1280, 800, 'RT3');
  await setCollapsed(P, true);
  await park(P);
  const ev = {};
  const INBOX = 'nav.side .sitem[data-r="inbox"]';
  // Esc
  await hover(P, ITEMS.Home);
  const sh = await waitTip(P);
  await P.keyboard.press('Escape');
  await sleep(60);
  const afterEsc = await tipState(P);
  const framesEsc = await visibleFrames(P, 800);
  ev.esc = { shownBefore: sh, hiddenAfterEsc: !vis(afterEsc), visibleFramesNext800ms: framesEsc };
  // another item shows again
  await hover(P, INBOX);
  const sh2 = await waitTip(P);
  const s2 = await tipState(P);
  ev.moveToOther = { shown: sh2, text: s2.text };
  // mousedown, then the click that follows (Inbox navigates and re-renders) with the pointer left where it is; a log of what the browser fires after the render
  await P.evaluate(() => {
    window.__ev = [];
    for (const n of ['pointerover', 'pointerout'])
      document.addEventListener(
        n,
        e =>
          window.__ev.push(
            `${Math.round(performance.now())} ${n} ${e.target.tagName.toLowerCase()}${e.target.className?.baseVal === undefined ? '.' + String(e.target.className).split(' ')[0] : ''} rel=${e.relatedTarget ? 'y' : 'n'}`,
          ),
        true,
      );
  });
  await P.mouse.down();
  await sleep(60);
  const afterDown = await tipState(P);
  await P.mouse.up();
  await P.waitForFunction(() => window.__pmspace.S.ui.route === 'inbox', null, { timeout: 4000 });
  const firstVisible = await P.evaluate(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      const t = document.getElementById('rail-tip');
      if (t && !t.hidden) return Math.round(performance.now() - t0);
      await new Promise(r => requestAnimationFrame(r));
    }
    return null;
  });
  await sleep(300);
  const framesClick = await visibleFrames(P, 600);
  const afterClick = await tipState(P);
  const stillHover = await P.evaluate(() => !!document.querySelector('nav.side .sitem[data-r="inbox"]')?.matches(':hover'));
  const evlog = await P.evaluate(() => window.__ev.slice(0, 8));
  await P.screenshot({ path: path.join(OUT, 'RT3-after-click-render.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  ev.mousedown = {
    hiddenAtMousedown: !vis(afterDown),
    routeAfterClick: (await route(P)).route,
    pointerPhysicallyStill: true,
    pointerOnItemAfterRender: stillHover,
    tipFirstVisibleMsAfterRoute: firstVisible,
    visibleFramesAfterRender600ms: framesClick,
    tipAfter: afterClick.exists ? { hidden: afterClick.hidden, text: afterClick.text } : null,
    browserPointerEventsAfterRender: evlog,
  };
  // re-hover the same item: leave and come back
  await P.mouse.move(900, 720, { steps: 4 });
  await sleep(100);
  await hover(P, INBOX);
  const sh3 = await waitTip(P);
  const s3 = await tipState(P);
  ev.rehover = { shown: sh3, text: s3.text };
  // leave to a non-tipped spot: the content area, then a non-tipped control inside the rail (workspace switcher)
  await P.mouse.move(900, 400, { steps: 5 });
  await sleep(80);
  const sLeave = await tipState(P);
  await hover(P, ITEMS.Home);
  const sh4 = await waitTip(P);
  await P.locator('nav.side .ws').hover();
  await sleep(80);
  const sLeave2 = await tipState(P);
  const framesWs = await visibleFrames(P, 600);
  ev.leave = { toContentHidden: !vis(sLeave), shownBeforeWs: sh4, toWorkspaceSwitcherHidden: !vis(sLeave2), framesVisibleAtSwitcher: framesWs };
  await hover(P, ITEMS.Settings);
  const sh5 = await waitTip(P);
  const s5 = await tipState(P);
  ev.showsAgain = { shown: sh5, text: s5.text };
  const neg = !(await hasTip(P));
  await chk('RT3a', `Esc hides the tip, it stays hidden while the pointer stays on that item, and another item shows its tip`, P, async () => ({
    pass: ev.esc.shownBefore && ev.esc.hiddenAfterEsc && ev.esc.visibleFramesNext800ms === 0 && ev.moveToOther.shown && ev.moveToOther.text === 'Inbox',
    neg,
    ev: { esc: ev.esc, moveToOther: ev.moveToOther },
  }));
  await chk('RT3b', `mousedown on the item hides the tip`, P, async () => ({
    pass: sh2 && ev.mousedown.hiddenAtMousedown,
    neg,
    ev: { shownBeforeMousedown: sh2, hiddenAtMousedown: ev.mousedown.hiddenAtMousedown },
  }));
  await chk(
    'RT3c',
    `the pointer leaves the item to a non-tipped spot (content area; workspace switcher in the rail): the tip hides; the next item shows it again`,
    P,
    async () => ({
      pass:
        ev.leave.toContentHidden &&
        ev.leave.shownBeforeWs &&
        ev.leave.toWorkspaceSwitcherHidden &&
        ev.leave.framesVisibleAtSwitcher === 0 &&
        ev.showsAgain.shown &&
        ev.showsAgain.text === 'Settings' &&
        ev.rehover.shown &&
        ev.rehover.text === 'Inbox',
      neg,
      ev: { leave: ev.leave, rehoverAfterLeaving: ev.rehover, showsAgain: ev.showsAgain },
    }),
  );
  await chk('RT3d', `a click on a rail item that navigates (Inbox), pointer not moved: no tip next to it after the re-render`, P, async () => ({
    pass: ev.mousedown.routeAfterClick === 'inbox' && ev.mousedown.tipFirstVisibleMsAfterRoute === null && ev.mousedown.visibleFramesAfterRender600ms === 0,
    neg,
    ev: ev.mousedown,
  }));
  await chk('RT3', `dismiss (RT3a-d together)`, P, async () => ({ pass: [...results3()].every(Boolean), neg, ev: { note: 'see RT3a, RT3b, RT3c, RT3d' } }));
  function* results3() {
    const r = fs
      .readFileSync(RES, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
    for (const id of ['RT3a', 'RT3b', 'RT3c', 'RT3d']) yield r.find(x => x.id === id)?.pass;
  }
  await restore(P);
  await done(P);
});

// =============== RT4 re-render (collapsed rail, 1280x800)
await group('RT4', async () => {
  const P = await mk(1280, 800, 'RT4');
  await setCollapsed(P, true);
  await park(P);
  await L.suLogin();
  // an observer on the page: every frame's tip state, animationstart events on #rail-tip
  await P.evaluate(() => {
    window.__rt = { frames: [], starts: 0, run: true };
    document.addEventListener(
      'animationstart',
      e => {
        if (e.target.id === 'rail-tip') window.__rt.starts++;
      },
      true,
    );
    const f = () => {
      const t = document.getElementById('rail-tip');
      if (t) {
        const r = t.getBoundingClientRect();
        window.__rt.frames.push({ h: t.hidden, o: +getComputedStyle(t).opacity, l: r.left, t: r.top, x: t.textContent });
      }
      if (window.__rt.run) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const ev = {};
  await hover(P, ITEMS.Home);
  const sh = await waitTip(P);
  await sleep(300);
  const before = await tipState(P);
  const animBefore = await P.evaluate(() => {
    const a = document.getElementById('rail-tip')?.getAnimations()[0];
    return a ? { startTime: a.startTime, name: a.animationName } : null;
  });
  await P.evaluate(() => {
    window.__rt.frames.length = 0;
    window.__rt.starts = 0;
    window.__rt.nav = document.querySelector('nav.side');
  });
  // (a) render() three times, the pointer does not move
  for (let i = 0; i < 3; i++) {
    await P.evaluate(() => window.__pmspace.render());
    await sleep(120);
  }
  const navReplaced = await P.evaluate(() => !window.__rt.nav.isConnected);
  const afterA = await tipState(P);
  const fa = await P.evaluate(() => ({
    n: window.__rt.frames.length,
    minOpacity: Math.min(...window.__rt.frames.map(f => f.o)),
    hiddenFrames: window.__rt.frames.filter(f => f.h).length,
    texts: [...new Set(window.__rt.frames.map(f => f.x))],
    lefts: [...new Set(window.__rt.frames.map(f => f.l))],
    tops: [...new Set(window.__rt.frames.map(f => f.t))],
    starts: window.__rt.starts,
  }));
  ev.render = {
    navReplacedByRender: navReplaced,
    sh,
    before: before.exists ? { text: before.text, l: before.l, t: before.t } : null,
    after: afterA.exists ? { text: afterA.text, l: afterA.l, t: afterA.t } : null,
    frames: fa,
    animStartTimeBefore: animBefore?.startTime,
    animStartTimeAfter: await P.evaluate(() => document.getElementById('rail-tip')?.getAnimations()[0]?.startTime),
  };
  // (b) a live event: a task's title is changed through the PocketBase API, the app gets it on its realtime stream and renders
  const tasks = (await L.api('GET', '/collections/tasks/records?perPage=1')).body.items;
  let live = { skipped: true };
  if (tasks.length) {
    const tk = tasks[0],
      title0 = tk.doc.title;
    await P.evaluate(() => {
      window.__rt.frames.length = 0;
      window.__rt.starts = 0;
      window.__rt.nav = document.querySelector('nav.side');
      window.__rt.renders = 0;
    });
    const r1 = await L.api('PATCH', '/collections/tasks/records/' + tk.id, { doc: { ...tk.doc, title: title0 + ' (rt4)' } });
    let seen = false;
    for (let i = 0; i < 30 && !seen; i++) {
      await sleep(200);
      seen = await P.evaluate(([, f]) => JSON.stringify(window.__pmspace.D()).includes(f), [tk.id, title0 + ' (rt4)']);
    }
    await sleep(400);
    const navRepl = await P.evaluate(() => !window.__rt.nav.isConnected);
    const sb = await tipState(P);
    const fb = await P.evaluate(() => ({
      n: window.__rt.frames.length,
      minOpacity: Math.min(...window.__rt.frames.map(f => f.o)),
      hiddenFrames: window.__rt.frames.filter(f => f.h).length,
      starts: window.__rt.starts,
      texts: [...new Set(window.__rt.frames.map(f => f.x))],
    }));
    await L.api('PATCH', '/collections/tasks/records/' + tk.id, { doc: tk.doc });
    live = {
      patchStatus: r1.status,
      appSawChange: seen,
      navReplacedByRender: navRepl,
      tip: sb.exists ? { text: sb.text, l: sb.l, t: sb.t } : null,
      frames: fb,
    };
  }
  ev.liveEvent = live;
  // (c) rename a project through the API while its row is hovered
  const pid = await P.evaluate(sel => document.querySelector(sel).dataset.dragProj, ITEMS.Project);
  const pr = (await L.api('GET', '/collections/projects/records/' + pid)).body;
  await hover(P, ITEMS.Project);
  await waitTip(P);
  await sleep(300);
  const pb0 = await tipState(P);
  await P.evaluate(() => {
    window.__rt.frames.length = 0;
    window.__rt.starts = 0;
  });
  const oldName = pr.doc.name,
    newName = oldName + ' RT4';
  const rr = await L.api('PATCH', '/collections/projects/records/' + pid, { doc: { ...pr.doc, name: newName } });
  let follow = false;
  const t0 = Date.now();
  for (; Date.now() - t0 < 6000 && !follow;) {
    await sleep(100);
    const s = await tipState(P);
    follow = s.exists && s.text === newName;
  }
  const followMs = Date.now() - t0;
  await sleep(500);
  const pb1 = await tipState(P);
  const g1 = await geom(P, ITEMS.Project);
  const fc = await P.evaluate(() => ({
    n: window.__rt.frames.length,
    minOpacity: Math.min(...window.__rt.frames.map(f => f.o)),
    hiddenFrames: window.__rt.frames.filter(f => f.h).length,
    starts: window.__rt.starts,
  }));
  await L.api('PATCH', '/collections/projects/records/' + pid, { doc: pr.doc });
  await sleep(1200);
  const pb2 = await tipState(P);
  ev.rename = {
    project: pid,
    from: oldName,
    to: newName,
    patchStatus: rr.status,
    tipBefore: pb0.exists ? pb0.text : null,
    tipFollowed: follow,
    followMs,
    tipAfter: pb1.exists ? { text: pb1.text, vis: vis(pb1), l: pb1.l, t: pb1.t, opacity: pb1.opacity } : null,
    itemRect: [g1.l, g1.t, g1.r, g1.b].map(Math.round),
    placedOnItem: placed(g1, pb1),
    frames: fc,
    tipAfterRestore: pb2.exists ? pb2.text : null,
  };
  await P.evaluate(() => {
    window.__rt.run = false;
  });
  await chk(
    'RT4',
    `re-render under a stationary pointer: Home's tip stays (text, position), no fade replay (opacity stays 1, no animationstart) through render() and a live event; a live project rename updates the hovered row's tip text`,
    P,
    async () => {
      const r = ev.render,
        l = ev.liveEvent,
        n = ev.rename;
      const same = (a, c) => a && c && a.text === c.text && Math.abs(a.l - c.l) < 0.5 && Math.abs(a.t - c.t) < 0.5;
      return {
        pass:
          !!r.before &&
          r.navReplacedByRender &&
          same(r.before, r.after) &&
          r.after.text === 'Home' &&
          r.frames.hiddenFrames === 0 &&
          r.frames.minOpacity === 1 &&
          r.frames.starts === 0 &&
          r.animStartTimeBefore === r.animStartTimeAfter &&
          (l.skipped ||
            (l.appSawChange &&
              l.navReplacedByRender &&
              l.tip &&
              l.tip.text === 'Home' &&
              l.frames.hiddenFrames === 0 &&
              l.frames.minOpacity === 1 &&
              l.frames.starts === 0)) &&
          n.tipFollowed &&
          n.tipAfter?.vis &&
          n.placedOnItem &&
          n.frames.starts === 0 &&
          n.frames.minOpacity === 1 &&
          n.frames.hiddenFrames === 0 &&
          n.tipAfterRestore === n.from,
        neg: !(await hasTip(P)),
        ev,
      };
    },
  );
  await restore(P);
  await done(P);
});

// =============== RT5 scroll (1280x500)
await group('RT5', async () => {
  const P = await mk(1280, 500, 'RT5');
  await setCollapsed(P, true);
  await park(P);
  const sc = await P.evaluate(() => {
    const s = document.querySelector('.side-scroll');
    const r = s.getBoundingClientRect();
    return { sh: s.scrollHeight, ch: s.clientHeight, top: r.top, bottom: r.bottom };
  });
  // invariants of a tip that is shown: it sits beside an item with its own text; that item, if in .side-scroll, has its centre inside it
  const inv = () =>
    document.getElementById('rail-tip') &&
    (() => {
      const t = document.getElementById('rail-tip');
      if (t.hidden) return { shown: false };
      const tr = t.getBoundingClientRect(),
        cy = (tr.top + tr.bottom) / 2,
        box = document.querySelector('.side-scroll').getBoundingClientRect();
      const cand = [...document.querySelectorAll('nav.side [data-tip-pos="right"]')].filter(e => e.dataset.tip === t.textContent);
      const it = cand.find(e => {
        const r = e.getBoundingClientRect();
        return Math.abs((r.top + r.bottom) / 2 - cy) <= 2 && Math.abs(tr.left - (r.right + 8)) <= 1.5;
      });
      const inScroll = it?.closest('.side-scroll');
      return {
        shown: true,
        text: t.textContent,
        cy,
        beside: !!it,
        inScroll: !!inScroll,
        centerInsideScroll: inScroll ? cy >= box.top - 1 && cy <= box.bottom + 1 : null,
        ok: !!it && (!inScroll || (cy >= box.top - 1 && cy <= box.bottom + 1)),
      };
    })();
  const sample = async ms =>
    P.evaluate(
      async ([ms, invSrc]) => {
        const f = eval(invSrc);
        const out = [];
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          out.push(f());
          await new Promise(r => requestAnimationFrame(r));
        }
        return out;
      },
      [ms, '(' + inv.toString() + ')'],
    );
  const sumS = arr => ({
    frames: arr.length,
    shown: arr.filter(x => x && x.shown).length,
    bad: arr.filter(x => x && x.shown && !x.ok).length,
    texts: [...new Set(arr.filter(x => x && x.shown).map(x => x.text))].slice(0, 12),
  });
  const ev = { rail: sc };
  // A. hover Home (top of the list), wheel the rail down in steps with the pointer still
  await hover(P, ITEMS.Home);
  await waitTip(P);
  const gH = await geom(P, ITEMS.Home);
  const wheelLog = [];
  for (let i = 0; i < 8; i++) {
    await P.mouse.wheel(0, 40);
    const arr = await sample(150);
    wheelLog.push({ step: i, scrollTop: await P.evaluate(() => document.querySelector('.side-scroll').scrollTop), ...sumS(arr) });
  }
  ev.wheelDownHover = {
    itemAtStart: gH.dataTip,
    steps: wheelLog.map(w => `${w.scrollTop}:${w.shown}/${w.frames} bad${w.bad} [${w.texts.join('|')}]`),
    badFrames: wheelLog.reduce((n, w) => n + w.bad, 0),
  };
  // wheel back up
  for (let i = 0; i < 8; i++) {
    await P.mouse.wheel(0, -40);
    const arr = await sample(150);
    wheelLog.push({ step: 8 + i, ...sumS(arr) });
  }
  ev.wheelUpBad = wheelLog.slice(8).reduce((n, w) => n + w.bad, 0);
  await P.screenshot({ path: path.join(OUT, 'RT5-after-wheel.png'), clip: { x: 0, y: 0, width: 320, height: 500 } });
  // B. keyboard focus on an item in the middle, then the rail scrolls it out through the top and back (programmatic scroll: the pointer is parked outside)
  await park(P);
  await P.locator('nav.side .sitem[data-r="overview"]').first().focus();
  await P.keyboard.press('Tab');
  await P.keyboard.press('Shift+Tab'); // keyboard modality: :focus-visible
  await waitTip(P);
  const s0 = await tipState(P);
  const upOut = await P.evaluate(async () => {
    const s = document.querySelector('.side-scroll'),
      e = document.activeElement,
      out = [];
    const mid = () => {
      const r = e.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    };
    const t = () => document.getElementById('rail-tip');
    const box = s.getBoundingClientRect();
    const step = async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const tt = t();
      out.push({ st: Math.round(s.scrollTop), mid: Math.round(mid()), inside: mid() >= box.top && mid() <= box.bottom, tipShown: !!tt && !tt.hidden });
    };
    for (let v = s.scrollTop; v <= s.scrollHeight; v += 25) {
      s.scrollTop = v;
      await step();
      if (s.scrollTop < v - 1) break;
    }
    return out;
  });
  const wrongUp = upOut.filter(x => x.inside !== x.tipShown);
  const backIn = await P.evaluate(async () => {
    const s = document.querySelector('.side-scroll');
    const t = () => document.getElementById('rail-tip');
    const e = document.activeElement;
    const box = s.getBoundingClientRect();
    s.scrollTop = 0;
    for (let k = 0; k < 3; k++) await new Promise(r => requestAnimationFrame(r));
    const r = e.getBoundingClientRect();
    const mid = (r.top + r.bottom) / 2;
    const tt = t();
    return {
      st: s.scrollTop,
      mid: Math.round(mid),
      inside: mid >= box.top && mid <= box.bottom,
      tipShown: !!tt && !tt.hidden,
      tipText: tt?.textContent,
      focusStill: e.dataset.r,
    };
  });
  ev.focusScrollOut = {
    focused: 'overview',
    tipBefore: s0.exists ? s0.text : null,
    samples: upOut.length,
    mismatches: wrongUp.length,
    firstMismatch: wrongUp[0] || null,
    firstHiddenAt: upOut.find(x => !x.tipShown) || null,
    backToTop: backIn,
  };
  // C. focus on the last team (bottom of the list), then scroll to the top: its centre leaves through the bottom
  await P.locator('nav.side .sitem[data-r="team"]').last().focus();
  await P.keyboard.press('Tab');
  await P.keyboard.press('Shift+Tab');
  await waitTip(P);
  const c0 = await tipState(P);
  const out2 = await P.evaluate(async () => {
    const s = document.querySelector('.side-scroll'),
      e = document.activeElement,
      box = s.getBoundingClientRect();
    const t = () => document.getElementById('rail-tip');
    const res = [];
    for (let v = s.scrollTop; v >= 0; v -= 25) {
      s.scrollTop = v;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = e.getBoundingClientRect(),
        mid = (r.top + r.bottom) / 2,
        tt = t();
      res.push({ st: Math.round(s.scrollTop), inside: mid >= box.top && mid <= box.bottom, tipShown: !!tt && !tt.hidden });
    }
    return res;
  });
  const wrong2 = out2.filter(x => x.inside !== x.tipShown);
  ev.focusScrollOutBottom = {
    tipBefore: c0.exists ? c0.text : null,
    samples: out2.length,
    mismatches: wrong2.length,
    firstMismatch: wrong2[0] || null,
    hiddenSamples: out2.filter(x => !x.tipShown).length,
  };
  // D. hover a bottom item (Settings, outside .side-scroll) and wheel the rail: its tip must not move off it
  await hover(P, ITEMS.Settings);
  await waitTip(P);
  const gS = await geom(P, ITEMS.Settings);
  await P.mouse.wheel(0, 200);
  await sleep(300);
  const sS = await tipState(P);
  ev.sideBotHoverWheel = { tip: sS.exists ? sS.text : null, placed: placed(gS, sS) };
  await chk(
    'RT5',
    `rail scrolls (${sc.sh}px in ${sc.ch}px): the tip stays beside its item or hides once the item's centre leaves .side-scroll; never beside the wrong item`,
    P,
    async () => ({
      pass:
        sc.sh > sc.ch + 20 &&
        ev.wheelDownHover.badFrames === 0 &&
        ev.wheelUpBad === 0 &&
        ev.focusScrollOut.samples > 3 &&
        ev.focusScrollOut.mismatches === 0 &&
        ev.focusScrollOut.tipBefore === 'Overview' &&
        ev.focusScrollOut.firstHiddenAt &&
        ev.focusScrollOutBottom.tipBefore !== null &&
        ev.focusScrollOutBottom.mismatches === 0 &&
        ev.focusScrollOutBottom.hiddenSamples > 0 &&
        ev.sideBotHoverWheel.placed,
      neg: !(await hasTip(P)),
      ev,
    }),
  );
  await restore(P);
  await done(P);
});

// =============== RT6 not elsewhere
await group('RT6', async () => {
  const P = await mk(1280, 800, 'RT6');
  await setCollapsed(P, false);
  await park(P);
  // (a) expanded sidebar: no #rail-tip on hover
  const exp = [];
  for (const [label, sel] of [
    ['Home', 'nav.side .sitem[data-r="home"]'],
    ['Project', ITEMS.Project],
    ['Team', ITEMS.Team],
    ['Settings', ITEMS.Settings],
    ['Account', ITEMS.Account],
  ]) {
    await hover(P, sel);
    await sleep(750);
    const s = await tipState(P);
    const fr = await visibleFrames(P, 150);
    exp.push({
      label,
      tipElement: s.exists,
      visible: vis(s) || fr > 0,
      dataTipPos: await P.evaluate(sel => document.querySelector(sel).getAttribute('data-tip-pos'), sel),
    });
  }
  await chk(
    'RT6a',
    `expanded sidebar: hovering Home, a project, a team, Settings, Account shows no #rail-tip (and the items have no data-tip-pos)`,
    P,
    async () => ({ pass: exp.every(x => !x.visible && x.dataTipPos === null), ev: exp }),
  );
  // (b) topbar tips still paint (collapsed and expanded)
  const bellSel = 'header [data-r="notifications"][data-tip="Notifications"]';
  const bellTest = async tag => {
    await park(P);
    const g = await geom(P, bellSel);
    const clip = { x: Math.max(0, Math.floor(g.l - 50)), y: Math.floor(g.b), width: Math.ceil(g.r - g.l + 100), height: 40 };
    const off = await P.screenshot({ clip });
    await P.locator(bellSel).hover();
    await sleep(800);
    const on = await P.screenshot({ clip });
    fs.writeFileSync(path.join(OUT, `RT6b-bell-${tag}-on.png`), on);
    const d = await pixelDiff(off, on);
    const af = await P.evaluate(sel => {
      const cs = getComputedStyle(document.querySelector(sel), '::after');
      return { content: cs.content, opacity: cs.opacity, position: cs.position };
    }, bellSel);
    const s = await tipState(P);
    return { tag, after: af, diffPixels: d.diffPixels, railTipVisible: vis(s) };
  };
  const bellExp = await bellTest('expanded');
  await setCollapsed(P, true);
  const bellCol = await bellTest('collapsed');
  await chk(
    'RT6b',
    `topbar Notifications bell: its data-tip still paints through ::after ("Notifications", opacity 1, pixels change under the bell), #rail-tip not used; expanded and collapsed`,
    P,
    async () => ({
      pass: [bellExp, bellCol].every(x => x.after.content === '"Notifications"' && x.after.opacity === '1' && x.diffPixels > 50 && !x.railTipVisible),
      ev: { expanded: bellExp, collapsed: bellCol },
    }),
  );
  // (c) the design-system page with the rail collapsed
  await goTo(P, 'system', {}, '.content .side .sitem');
  await park(P);
  const ds = [];
  const n = await P.locator('.content .side .sitem').count();
  for (let i = 0; i < n; i++) {
    const loc = P.locator('.content .side .sitem').nth(i);
    await loc.scrollIntoViewIfNeeded();
    await loc.hover();
    await sleep(750);
    const s = await tipState(P);
    const m = await loc.evaluate(e => {
      const cs = getComputedStyle(e, '::after');
      return { dataTip: e.getAttribute('data-tip'), pos: e.getAttribute('data-tip-pos'), content: cs.content, opacity: cs.opacity };
    });
    ds.push({ i, ...m, railTipVisible: vis(s) });
  }
  await P.screenshot({ path: path.join(OUT, 'RT6c-design-system-hover.png') });
  await chk(
    'RT6c',
    `Help > Design system, rail collapsed: the sample sidebar's items show no tip (#27 known gap: no #rail-tip, ::after content none)`,
    P,
    async () => ({
      pass: n >= 4 && ds.every(x => !x.railTipVisible && x.content === 'none'),
      neg: ds.some(x => x.pos === 'right' && x.content !== 'none' && x.opacity === '1'),
      ev: { items: n, perItem: ds, note: 'only the sample sidebar Home item carries data-tip/data-tip-pos' },
    }),
  );
  // (d) drawer mode: viewport narrowed to 800 with the rail on
  await goTo(P, 'home', {}, '.sitem');
  await hover(P, ITEMS.Home);
  const sh1280 = await waitTip(P);
  const before800 = await tipState(P);
  await P.setViewportSize({ width: 800, height: 700 });
  await P.waitForFunction(() => !document.querySelector('.shell').classList.contains('collapsed'), null, { timeout: 4000 }).catch(() => {});
  await sleep(500);
  const afterResize = await tipState(P);
  const fr800 = await visibleFrames(P, 300);
  const colAt800 = await P.evaluate(() => ({
    shellCollapsed: document.querySelector('.shell').classList.contains('collapsed'),
    uiCollapsed: window.__pmspace.S.ui.collapsed,
  }));
  await P.click('#mnav-btn');
  await P.waitForSelector('.shell.mnav', { timeout: 5000 });
  await P.waitForFunction(
    () => {
      const s = document.querySelector('nav.side'),
        r = s.getBoundingClientRect();
      return getComputedStyle(s).visibility === 'visible' && r.left >= 0 && r.width > 200;
    },
    null,
    { timeout: 5000 },
  );
  await quiet(P);
  const dr = [];
  const nd = await P.locator('nav.side .sitem:visible').count();
  for (let i = 0; i < Math.min(nd, 8); i++) {
    const loc = P.locator('nav.side .sitem:visible').nth(i);
    await loc.scrollIntoViewIfNeeded();
    await loc.hover();
    await sleep(650);
    const s = await tipState(P);
    const e = await loc.evaluate(e => ({ label: (e.textContent || '').trim().slice(0, 20), pos: e.getAttribute('data-tip-pos') }));
    dr.push({ ...e, railTipVisible: vis(s) });
  }
  await P.screenshot({ path: path.join(OUT, 'RT6d-drawer-hover.png') });
  await chk(
    'RT6d',
    `800px wide with the rail preference on: a tip shown at 1280 hides on the crossing; in drawer mode (drawer open) hovering items shows no tip`,
    P,
    async () => ({
      pass: (!sh1280 || (!vis(afterResize) && fr800 === 0)) && !colAt800.shellCollapsed && dr.length >= 5 && dr.every(x => !x.railTipVisible && x.pos === null),
      ev: {
        tipShownAt1280: sh1280 ? before800.text : false,
        tipAfterCrossing: vis(afterResize),
        framesVisibleAt800: fr800,
        at800: colAt800,
        drawerItemsHovered: dr.length,
        drawer: dr,
      },
    }),
  );
  await P.setViewportSize({ width: 1280, height: 800 });
  await sleep(600);
  await restore(P);
  await done(P);
  // (e) "[" while a tip is shown (fresh page, collapsed)
  const Q = await mk(1280, 800, 'RT6e');
  await setCollapsed(Q, true);
  await park(Q);
  await hover(Q, ITEMS.Home);
  const shK = await waitTip(Q);
  await Q.evaluate(() => document.activeElement?.blur());
  await Q.keyboard.press('[');
  await sleep(80);
  const sK1 = await tipState(Q);
  await Q.waitForFunction(() => !document.querySelector('.shell').classList.contains('collapsed'), null, { timeout: 4000 });
  const frK = await visibleFrames(Q, 900);
  const sK2 = await tipState(Q);
  const homeAfter = await Q.evaluate(() => {
    const e = document.querySelector('nav.side .sitem[data-r="home"]');
    return {
      hover: e.matches(':hover'),
      hasDataTip: e.hasAttribute('data-tip'),
      width: Math.round(document.querySelector('nav.side').getBoundingClientRect().width),
    };
  });
  await Q.screenshot({ path: path.join(OUT, 'RT6e-after-bracket.png'), clip: { x: 0, y: 0, width: 400, height: 300 } });
  await chk('RT6e', `"[" while Home's tip is shown: the rail opens and the tip hides (at once and for the next 900 ms)`, Q, async () => ({
    pass: shK && !vis(sK1) && !vis(sK2) && frK === 0 && homeAfter.width > 150,
    neg: !(await hasTip(Q)),
    ev: { shownBefore: shK, hiddenAfter80ms: !vis(sK1), visibleFramesNext900ms: frK, homeAfter },
  }));
  await done(Q);
});

// =============== RT7 dark theme
await group('RT7', async () => {
  const P = await mk(1280, 800, 'RT7');
  await setCollapsed(P, true);
  await park(P);
  const prefTheme = await P.evaluate(() => window.__pmspace.S.prefs.theme);
  const probe = () =>
    P.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'background:var(--text);color:var(--text-inv)';
      document.body.appendChild(d);
      const cs = getComputedStyle(d);
      const o = { bg: cs.backgroundColor, color: cs.color };
      d.remove();
      return o;
    });
  const lightTokens = await probe();
  await hover(P, ITEMS.Home);
  await waitTip(P);
  const light = await tipState(P);
  await park(P);
  await P.emulateMedia({ colorScheme: 'dark' });
  await P.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); // explicit dark, whatever the saved preference is
  await sleep(300);
  const darkTokens = await probe();
  await hover(P, ITEMS.Home);
  const sh = await waitTip(P);
  const dark = await tipState(P);
  await P.screenshot({ path: path.join(OUT, 'RT7-dark-tip.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  await chk(
    'RT7',
    `dark theme: the tip's background is the dark --text (rgb(236,234,229)) and its colour the dark --text-inv (rgb(21,21,20)); light is rgb(29,28,26) on white`,
    P,
    async () => ({
      pass:
        sh &&
        light.bg === lightTokens.bg &&
        light.color === lightTokens.color &&
        dark.bg === darkTokens.bg &&
        dark.color === darkTokens.color &&
        darkTokens.bg === 'rgb(236, 234, 229)' &&
        darkTokens.color === 'rgb(21, 21, 20)' &&
        lightTokens.bg === 'rgb(29, 28, 26)' &&
        dark.bg !== light.bg,
      neg: !(await hasTip(P)),
      ev: {
        savedThemePref: prefTheme,
        light: { tipBg: light.bg, tipColor: light.color, tokens: lightTokens },
        dark: { tipBg: dark.bg, tipColor: dark.color, tokens: darkTokens },
        shot: 'RT7-dark-tip.png',
      },
    }),
  );
  await P.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await P.emulateMedia({ colorScheme: 'light' });
  await restore(P);
  await done(P);
});

// =============== A1 popups and names (CDP), A2 current, A3 groups
await group('A1', async () => {
  const P = await mk(1280, 800, 'A1');
  await setCollapsed(P, true);
  await park(P);
  const out = {};
  await withCdp(P, async cdp => {
    out.railHelp = await axOne(cdp, P, 'nav.side [data-pop="help"]');
    out.railAccount = await axOne(cdp, P, 'nav.side .side-bot [data-pop="user"]');
    out.topAccount = await axOne(cdp, P, 'header [data-pop="user"]');
    await setCollapsed(P, false);
    await park(P);
    out.expProfile = await axOne(cdp, P, 'nav.side .side-bot [data-pop="user"]');
    out.expHelp = await axOne(cdp, P, 'nav.side [data-pop="help"]');
  });
  const userName = await P.evaluate(() => document.querySelector('nav.side .side-bot [data-pop="user"] .trunc').textContent.trim());
  const times = (s, sub) => s.split(sub).length - 1;
  const hp = x => x?.props?.hasPopup ?? x?.props?.haspopup;
  await chk(
    'A1',
    `Help, rail Account and topbar Account have haspopup=menu; collapsed rail button and topbar button are both named "Account"; expanded Profile button is named with the user's name once`,
    P,
    async () => ({
      pass:
        hp(out.railHelp) === 'menu' &&
        hp(out.railAccount) === 'menu' &&
        hp(out.topAccount) === 'menu' &&
        out.railAccount.name === 'Account' &&
        out.topAccount.name === 'Account' &&
        out.expProfile.name === userName &&
        times(out.expProfile.name, userName) === 1,
      neg: out.railAccount.name === 'Profile' && out.topAccount.name === 'Account menu' && !hp(out.railHelp),
      ev: {
        userName,
        railHelp: { name: out.railHelp.name, role: out.railHelp.role, haspopup: hp(out.railHelp) },
        railAccount: { name: out.railAccount.name, role: out.railAccount.role, haspopup: hp(out.railAccount) },
        topbarAccount: { name: out.topAccount.name, role: out.topAccount.role, haspopup: hp(out.topAccount) },
        expandedProfile: { name: out.expProfile.name, haspopup: hp(out.expProfile), occurrencesOfName: times(out.expProfile.name, userName) },
        expandedHelp: { name: out.expHelp.name, haspopup: hp(out.expHelp) },
      },
    }),
  );
  await restore(P);
  await done(P);
});

await group('A2', async () => {
  const P = await mk(1280, 800, 'A2');
  await setCollapsed(P, false);
  await park(P);
  const ids = await P.evaluate(() => [...document.querySelectorAll('nav.side .sproj > .sitem')].map(e => e.dataset.id));
  await P.evaluate(ids => {
    for (const id of ids) window.__pmspace.S.ui.expanded[id] = true;
    window.__pmspace.render();
  }, ids);
  await sleep(300);
  await goTo(P, 'project', { id: ids[0], tab: 'board' }, 'nav.side .sproj .sub.open');
  const snap = () =>
    P.evaluate(() =>
      [...document.querySelectorAll('nav.side [aria-current]')].map(e => ({
        cls: e.className.replace(/\s+/g, ' ').trim(),
        r: e.dataset.r,
        id: e.dataset.id || null,
        tab: e.dataset.tab || null,
        cur: e.getAttribute('aria-current'),
        isRow: e.matches('.sproj > .sitem'),
        isSub: !!e.closest('.sub'),
      })),
    );
  const proj = await snap();
  const openSubs = await P.evaluate(() => document.querySelectorAll('nav.side .sub.open').length);
  await P.screenshot({ path: path.join(OUT, 'A2-project.png'), clip: { x: 0, y: 0, width: 260, height: 800 } });
  await goTo(P, 'home', {}, '.sitem');
  const home = await snap();
  await chk(
    'A2',
    `project open (board), its sub-list shown: its row has aria-current="true" (round 2; round 1 was "page") and the Board sub-tab "page", no other project row or sub-tab does (${ids.length} projects, all sub-pages open); on Home only Home has it`,
    P,
    async () => ({
      pass:
        proj.length === 2 &&
        proj.some(x => x.isRow && x.id === ids[0] && x.cur === 'true') &&
        proj.some(x => x.isSub && x.id === ids[0] && x.tab === 'board' && x.cur === 'page') &&
        home.length === 1 &&
        home[0].r === 'home' &&
        !home.some(x => x.isRow || x.isSub),
      neg: !proj.some(x => x.isRow) && !proj.some(x => x.isSub),
      ev: { projects: ids.length, openSubLists: openSubs, onProject: proj, onHome: home },
    }),
  );
  await restore(P);
  await done(P);
});

await group('A3', async () => {
  const P = await mk(1280, 800, 'A3');
  await setCollapsed(P, true);
  await park(P);
  const expected = await P.evaluate(() =>
    [...document.querySelectorAll('nav.side .sgroup')].map(g => ({
      heading: g.querySelector('.sgroup-h')?.textContent.trim().replace(/\s+/g, ' ') || '',
      items: [...g.querySelectorAll('.sitem')].filter(e => e.checkVisibility({ checkVisibilityCSS: true })).map(e => e.getAttribute('aria-label')),
    })),
  );
  const groups = await withCdp(P, async cdp => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const by = new Map(nodes.map(n => [n.nodeId, n]));
    const navN = nodes.find(n => n.role?.value === 'navigation' && !n.ignored && n.name?.value === 'Main');
    const walk = (id, acc) => {
      const n = by.get(id);
      if (!n) return acc;
      if (!n.ignored && ['link', 'button'].includes(n.role?.value)) acc.push(String(n.name?.value ?? ''));
      for (const c of n.childIds || []) walk(c, acc);
      return acc;
    };
    const res = [];
    const find = id => {
      const n = by.get(id);
      if (!n) return;
      if (!n.ignored && n.role?.value === 'group' && n.name?.value) res.push({ name: String(n.name.value), items: walk(n.nodeId, []) });
      for (const c of n.childIds || []) find(c);
    };
    if (navN) find(navN.nodeId);
    return { nav: navN ? String(navN.name?.value) : null, groups: res };
  });
  const want = ['Workspace', 'Projects', 'Teams'];
  const got = want.map(w => groups.groups.find(g => g.name === w));
  const match = want.map((w, i) => {
    const e = expected[i],
      g = got[i];
    return !!g && JSON.stringify(g.items) === JSON.stringify(e.items);
  });
  await chk(
    'A3',
    `collapsed rail AX tree: three groups named Workspace, Projects, Teams, each holding its own items (Overview..Activity; project rows + Archive; teams)`,
    P,
    async () => ({
      pass:
        got.every(Boolean) &&
        match.every(Boolean) &&
        groups.groups.filter(g => want.includes(g.name)).length === 3 &&
        got[0].items[0] === 'Overview' &&
        got[0].items.at(-1) === 'Activity' &&
        got[1].items.at(-1) === 'Archive',
      neg: groups.groups.length === 0,
      ev: {
        navName: groups.nav,
        axGroups: groups.groups.map(g => ({ name: g.name, count: g.items.length, items: g.items })),
        domExpected: expected.map(e => ({ heading: e.heading, count: e.items.length })),
        matchesDom: match,
      },
    }),
  );
  await restore(P);
  await done(P);
});

// =============== A4 project rows (expanded sidebar), arrows in the rail, A5 shortcuts, K2b
await group('A4', async () => {
  const P = await mk(1280, 800, 'A4');
  await setCollapsed(P, false);
  await park(P);
  await P.evaluate(() => {
    const e = window.__pmspace.S.ui.expanded;
    for (const k of Object.keys(e)) delete e[k];
    window.__pmspace.render();
  });
  await sleep(300);
  const rows = await P.evaluate(() =>
    [...document.querySelectorAll('nav.side .sproj > .sitem')].map(e => ({
      id: e.dataset.id,
      name: e.querySelector('.trunc').textContent,
      titles: [...e.querySelectorAll('[title]')].map(t => t.getAttribute('title')),
      ariaExpanded: e.getAttribute('aria-expanded'),
      picoRole: e.querySelector('.pico').getAttribute('role'),
      picoTab: e.querySelector('.pico').getAttribute('tabindex'),
      picoLabel: e.querySelector('.pico').getAttribute('aria-label'),
    })),
  );
  const names = {};
  await withCdp(P, async cdp => {
    for (const r of rows) names[r.id] = await axOne(cdp, P, `nav.side .sproj > .sitem[data-id="${r.id}"]`);
  });
  // the real Tab walk through the sidebar
  await P.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('nav.side .ws').focus();
  });
  const walk = [];
  for (let i = 0; i < 80; i++) {
    walk.push(
      await P.evaluate(() => {
        const e = document.activeElement;
        const row = e.closest('.sproj');
        return {
          inSide: !!e.closest('nav.side'),
          isRow: e.matches('.sproj > .sitem'),
          inPico: !!e.closest('.pico'),
          rowId: row ? row.querySelector(':scope > .sitem').dataset.id : null,
          desc: e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0],
          name: (e.getAttribute('aria-label') || '').slice(0, 30),
        };
      }),
    );
    await P.keyboard.press('Tab');
    if (!(await P.evaluate(() => !!document.activeElement.closest('nav.side')))) break;
  }
  const perRow = rows.map(r => ({
    id: r.id,
    name: r.name,
    stops: walk.filter(w => w.rowId === r.id && !w.desc.startsWith('button')).length,
    picoStops: walk.filter(w => w.rowId === r.id && w.inPico).length,
  }));
  await chk(
    'A4a',
    `expanded sidebar Tab walk: exactly one stop per project row (the row, none on .pico), each named exactly the project's name, aria-expanded=false`,
    P,
    async () => ({
      pass:
        rows.length >= 3 &&
        perRow.every(x => x.stops === 1 && x.picoStops === 0) &&
        rows.every(r => names[r.id].name === r.name && r.ariaExpanded === 'false' && r.picoTab === null && r.picoRole === null),
      neg: perRow.every(x => x.stops === 2 && x.picoStops === 1) && rows.every(r => names[r.id].name === 'Toggle sub-pages ' + r.name),
      ev: {
        rows: rows.length,
        tabWalkStops: walk.length,
        perRow: perRow.map(x => `${x.name}: ${x.stops} stop(s), ${x.picoStops} on .pico`),
        computedNames: rows.map(
          r =>
            JSON.stringify(names[r.id].name) +
            ' (role ' +
            names[r.id].role +
            ', aria-expanded ' +
            r.ariaExpanded +
            ', descendant titles ' +
            JSON.stringify(r.titles) +
            ')',
        ),
      },
    }),
  );
  // arrows on a project row: reached by Tab
  const focusRow = async id => {
    await P.evaluate(() => {
      document.activeElement?.blur();
      document.querySelector('nav.side .ws').focus();
    });
    for (let i = 0; i < 60; i++) {
      await P.keyboard.press('Tab');
      if (await P.evaluate(id => document.activeElement.matches(`.sproj > .sitem[data-id="${id}"]`), id)) return i + 1;
    }
    return -1;
  };
  await P.evaluate(() => {
    window.__dp = [];
    document.addEventListener('keydown', e => {
      if (e.key.startsWith('Arrow')) window.__dp.push([e.key, e.defaultPrevented]);
    });
  });
  const target = rows[1] || rows[0];
  const tabs = await focusRow(target.id);
  const st = () =>
    P.evaluate(id => {
      const row = document.querySelector(`nav.side .sproj > .sitem[data-id="${id}"]`);
      const a = document.activeElement;
      return {
        open: !!row.closest('.sproj').querySelector('.sub.open'),
        ariaExpanded: row.getAttribute('aria-expanded'),
        focusOnRow: a === row,
        focusId: a.dataset?.id,
        focusVisible: a.matches(':focus-visible'),
        route: window.__pmspace.S.ui.route,
        exp: !!window.__pmspace.S.ui.expanded[id],
      };
    }, target.id);
  const s0 = await st();
  await P.keyboard.press('ArrowRight');
  await sleep(350);
  const s1 = await st();
  await P.keyboard.press('ArrowRight');
  await sleep(250);
  const s1b = await st();
  await P.keyboard.press('ArrowLeft');
  await sleep(350);
  const s2 = await st();
  await P.keyboard.press('ArrowLeft');
  await sleep(250);
  const s2b = await st();
  await P.keyboard.press('Shift+ArrowRight');
  await sleep(250);
  const s3 = await st();
  const dps = await P.evaluate(() => window.__dp.slice());
  await P.screenshot({ path: path.join(OUT, 'A4-arrows.png'), clip: { x: 0, y: 0, width: 260, height: 800 } });
  await chk(
    'A4b',
    `focused project row (by Tab): ArrowRight opens its sub-pages (.sub.open, aria-expanded true), focus stays on the row; ArrowLeft closes; repeat and Shift+Arrow do nothing`,
    P,
    async () => ({
      pass:
        tabs > 0 &&
        !s0.open &&
        s0.ariaExpanded === 'false' &&
        s1.open &&
        s1.ariaExpanded === 'true' &&
        s1.focusOnRow &&
        s1b.open &&
        s1b.focusOnRow &&
        !s2.open &&
        s2.ariaExpanded === 'false' &&
        s2.focusOnRow &&
        !s2b.open &&
        s2b.focusOnRow &&
        !s3.open &&
        s1.route === s0.route &&
        s2.route === s0.route,
      neg: !s1.open && s1.ariaExpanded === null,
      ev: {
        project: target.name,
        tabsToRow: tabs,
        start: s0,
        afterArrowRight: s1,
        afterSecondArrowRight: s1b,
        afterArrowLeft: s2,
        afterSecondArrowLeft: s2b,
        afterShiftArrowRight: s3,
        keydownsDefaultPrevented: dps.map(d => d.join(':')).join(' '),
      },
    }),
  );
  // mouse: the icon toggles without navigating, the name navigates
  await goTo(P, 'home', {}, '.sitem');
  const rowSel = `nav.side .sproj > .sitem[data-id="${target.id}"]`;
  const subOpen = () => P.evaluate(sel => !!document.querySelector(sel).closest('.sproj').querySelector('.sub.open'), rowSel);
  const rt0 = (await route(P)).route;
  await P.locator(rowSel + ' .pico').click();
  await sleep(350);
  const m1 = { open: await subOpen(), route: (await route(P)).route };
  await P.locator(rowSel + ' .pico').click();
  await sleep(350);
  const m2 = { open: await subOpen(), route: (await route(P)).route };
  await P.locator(rowSel + ' .trunc').click();
  await sleep(500);
  const m3 = await route(P);
  await chk(
    'A4c',
    `mouse: a click on the project icon opens/closes the sub-pages without navigating; a click on the name navigates to the project`,
    P,
    async () => ({
      pass: rt0 === 'home' && m1.open && m1.route === 'home' && !m2.open && m2.route === 'home' && m3.route === 'project' && m3.params.id === target.id,
      ev: { routeBefore: rt0, afterIconClick1: m1, afterIconClick2: m2, afterNameClick: { route: m3.route, id: m3.params.id } },
    }),
  );
  // the rail: arrows do nothing
  await goTo(P, 'home', {}, '.sitem');
  await setCollapsed(P, true);
  await park(P);
  const tabsR = await focusRow(target.id);
  const stR = () =>
    P.evaluate(() => ({
      anyOpen: document.querySelectorAll('nav.side .sub.open').length,
      exp: JSON.stringify(window.__pmspace.S.ui.expanded),
      focus: document.activeElement.dataset?.id,
      route: window.__pmspace.S.ui.route,
      ariaExpanded: document.activeElement.getAttribute('aria-expanded'),
    }));
  await P.evaluate(() => {
    window.__dp.length = 0;
  });
  const r0 = await stR();
  await P.keyboard.press('ArrowRight');
  await sleep(300);
  const r1 = await stR();
  await P.keyboard.press('ArrowLeft');
  await sleep(300);
  const r2 = await stR();
  const dpR = await P.evaluate(() => window.__dp.slice());
  await chk(
    'A4d',
    `collapsed rail: ArrowRight/ArrowLeft on a focused project row do nothing (no sub-pages, same expanded state, no aria-expanded on the row)`,
    P,
    async () => ({
      pass:
        tabsR > 0 &&
        r1.anyOpen === 0 &&
        r2.anyOpen === 0 &&
        r1.exp === r0.exp &&
        r2.exp === r0.exp &&
        r1.focus === target.id &&
        r1.ariaExpanded === null &&
        !dpR.some(d => d[1]),
      ev: { tabsToRow: tabsR, before: r0, afterArrowRight: r1, afterArrowLeft: r2, keydownsDefaultPrevented: dpR.map(d => d.join(':')).join(' ') },
    }),
  );
  await restore(P);
  await done(P);
});

await group('A5', async () => {
  const P = await mk(1280, 800, 'A5');
  await setCollapsed(P, false);
  await park(P);
  await P.keyboard.press('?');
  await sleep(500);
  const info = await P.evaluate(() => {
    const m = document.querySelector('.modal') || document.querySelector('[role="dialog"]');
    if (!m) return { modal: false };
    const row = [...m.querySelectorAll('.row')].find(r => /sidebar project/i.test(r.textContent));
    return {
      modal: true,
      title: m.querySelector('h2,h3,.modal-h')?.textContent.trim().slice(0, 40),
      rowText: row ? row.textContent.trim().replace(/\s+/g, ' ') : null,
      kbds: row ? [...row.querySelectorAll('kbd')].map(k => k.textContent) : [],
      general: [...m.querySelectorAll('.eyebrow')].map(e => e.textContent),
    };
  });
  await P.screenshot({ path: path.join(OUT, 'A5-shortcuts.png') });
  await chk('A5', `"?" opens the shortcuts panel and it lists the arrow keys for sidebar projects`, P, async () => ({
    pass: info.modal && !!info.rowText && /Expand or collapse a sidebar project/.test(info.rowText) && info.kbds.join('') === '→←',
    neg: info.modal && !info.rowText,
    ev: info,
  }));
  await P.keyboard.press('Escape');
  await restore(P);
  await done(P);
});

await group('K2b', async () => {
  const P = await mk(1280, 800, 'K2b');
  await setCollapsed(P, false);
  await park(P);
  await P.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('nav.side .ws').focus();
  });
  let id = null,
    tabs = 0;
  for (let i = 0; i < 60; i++) {
    await P.keyboard.press('Tab');
    tabs++;
    id = await P.evaluate(() => (document.activeElement.matches('.sproj > .sitem') ? document.activeElement.dataset.id : null));
    if (id) break;
  }
  await P.keyboard.press('[');
  await sleep(900);
  await quiet(P);
  const f = await P.evaluate(() => {
    const a = document.activeElement;
    return {
      collapsed: document.querySelector('.shell').classList.contains('collapsed'),
      el: a === document.body ? 'body' : a.tagName.toLowerCase(),
      id: a.dataset?.id,
      isRow: a.matches?.('.sproj > .sitem'),
      inSide: !!a.closest?.('nav.side'),
      fv: a.matches?.(':focus-visible'),
    };
  });
  const s = await tipState(P);
  await chk(
    'K2b',
    `(extra, replaces sb K2 whose premise, Tab onto the project icon, is gone by design) Tab onto a project row, "[": rail on, focus on that row in the rail`,
    P,
    async () => ({
      pass: !!id && f.collapsed && f.isRow && f.id === id && f.inSide,
      ev: { tabs, project: id, after: f, tipAfter: s.exists ? { shown: vis(s), text: s.text } : 'no #rail-tip' },
    }),
  );
  await restore(P);
  await done(P);
});

// =============== ROUND 2: R2a..R2h (branch c1f8bea). Run alone with RT_ONLY=R2.
// Page-side recorder: every frame's #rail-tip visibility (hidden attribute / display, not opacity), every transition to shown (MutationObserver,
// so a show+hide inside one frame is still seen), and a capture-phase log of pointer events with isTrusted and coordinates (diag3's idea).
const R2 = {
  install: page =>
    page.evaluate(() => {
      if (window.__r2) return;
      const R = (window.__r2 = { frames: [], ev: [], shows: [], nav: null, run: true, t0: performance.now() });
      const ms = (R.ms = () => Math.round(performance.now() - R.t0));
      const d = e =>
        e
          ? e.tagName.toLowerCase() +
            (e.dataset && e.dataset.r ? '[' + e.dataset.r + ']' : '') +
            (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')
          : 'null';
      for (const n of ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointermove', 'click'])
        document.addEventListener(n, e => R.ev.push({ t: ms(), n, tg: d(e.target), x: e.clientX, y: e.clientY, tr: e.isTrusted }), true);
      const tip = document.getElementById('rail-tip');
      if (tip)
        new MutationObserver(recs => {
          recs.forEach((rec, i) => {
            if (rec.type !== 'attributes') return;
            const after = i + 1 < recs.length ? recs.slice(i + 1).find(r => r.type === 'attributes')?.oldValue !== null : tip.hidden;
            if (after === false || (after === undefined && !tip.hidden)) R.shows.push({ t: ms(), text: tip.textContent });
          });
        }).observe(tip, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
      const f = () => {
        const t = document.getElementById('rail-tip');
        R.frames.push({ t: ms(), v: !!t && !t.hidden && getComputedStyle(t).display !== 'none', x: t ? t.textContent : null });
        if (R.run) requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }),
  mark: page =>
    page.evaluate(() => {
      const R = window.__r2;
      R.frames.length = 0;
      R.ev.length = 0;
      R.shows.length = 0;
      R.nav = document.querySelector('nav.side');
      return R.ms();
    }),
  read: page =>
    page.evaluate(() => {
      const R = window.__r2;
      return { frames: R.frames.slice(), ev: R.ev.slice(), shows: R.shows.slice(), navReplaced: !!R.nav && !R.nav.isConnected, now: R.ms() };
    }),
};
const bbox = (page, sel) =>
  page.evaluate(sel => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
  }, sel);
const act = page =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return { el: 'body' };
    return {
      el:
        e.tagName.toLowerCase() +
        (e.id ? '#' + e.id : '') +
        (e.dataset.r ? '[' + e.dataset.r + ']' : '') +
        (e.dataset.pop ? '[pop:' + e.dataset.pop + ']' : '') +
        (e.dataset.a === 'toggleSide' ? '[toggleSide]' : '') +
        (e.matches('.sproj > .sitem') ? '[project:' + e.querySelector('.trunc')?.textContent + ']' : ''),
      id: e.id,
      tip: e.getAttribute('data-tip'),
      label: e.getAttribute('aria-label'),
      fv: e.matches(':focus-visible'),
      inSide: !!e.closest('nav.side'),
      inTop: !!e.closest('header.topbar'),
      inPop: !!e.closest('.pop'),
    };
  });
const geomActive = page =>
  page.evaluate(() => {
    const e = document.activeElement;
    const r = e.getBoundingClientRect();
    return {
      dataTip: e.getAttribute('data-tip'),
      pos: e.getAttribute('data-tip-pos'),
      l: r.left,
      t: r.top,
      r: r.right,
      b: r.bottom,
      cy: (r.top + r.bottom) / 2,
      vw: innerWidth,
      vh: innerHeight,
      railR: document.querySelector('nav.side').getBoundingClientRect().right,
    };
  });
// presses key until document.activeElement matches sel; returns the number of presses, 0 when not reached in max
async function pressTo(page, sel, key = 'Tab', max = 90) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key);
    if (await page.evaluate(s => !!document.activeElement && document.activeElement.matches(s), sel)) return i;
  }
  return 0;
}
const visIn = (rd, from, to = 1e12) => rd.frames.filter(f => f.t > from && f.t <= to && f.v).length;
const showsIn = (rd, from, to = 1e12) => rd.shows.filter(s => s.t > from && s.t <= to).length;
const near = (a, c) => Math.abs(a - c) < 0.01;

// ---- R2a: a dismissal survives a render (RT3d's case, stricter)
const R2A_CASES = [
  { label: 'Inbox', sel: 'nav.side .sitem[data-r="inbox"]', from: ['settings', {}], to: 'inbox' },
  { label: 'Home', sel: 'nav.side .sitem[data-r="home"]', from: ['settings', {}], to: 'home' },
  { label: 'Project row', sel: 'nav.side .sproj > .sitem', from: ['settings', {}], to: 'project' },
];
async function r2aCase(P, c, frac) {
  await goTo(P, c.from[0], c.from[1], 'nav.side .sproj');
  await park(P);
  const bb = await bbox(P, c.sel);
  const x = Math.round(bb.cx) + (frac ? 0.5 : 0),
    y = Math.round(bb.cy) + (frac ? 0.25 : 0);
  await P.mouse.move(x, y, { steps: 4 });
  const shown = await waitTip(P);
  const s0 = await tipState(P);
  const want = await P.evaluate(sel => document.querySelector(sel).getAttribute('data-tip'), c.sel);
  await R2.mark(P);
  await P.mouse.down();
  await sleep(60);
  await P.mouse.up();
  await P.waitForFunction(r => window.__pmspace.S.ui.route === r, c.to, { timeout: 4000 });
  await sleep(1050);
  const r1 = await R2.read(P);
  const down = r1.ev.find(e => e.n === 'pointerdown');
  const replay = r1.ev.filter(e => e.n === 'pointerover' && e.t >= down.t);
  const onItem = await P.evaluate(sel => !!document.querySelector(sel)?.matches(':hover'), c.sel);
  const frames1 = visIn(r1, down.t),
    shows1 = showsIn(r1, down.t);
  // a 2 px move within the item
  await R2.mark(P);
  await P.mouse.move(x + 2, y);
  await sleep(650);
  const r2 = await R2.read(P);
  const mv = {
    frames: visIn(r2, 0),
    shows: showsIn(r2, 0),
    pointermove: r2.ev.filter(e => e.n === 'pointermove').length,
    pointerover: r2.ev.filter(e => e.n === 'pointerover').map(e => `${e.tg}@${e.x},${e.y}`),
  };
  // off and back: the tip shows
  await P.mouse.move(900, 720, { steps: 5 });
  await sleep(150);
  const sOff = await tipState(P);
  await P.mouse.move(x, y, { steps: 5 });
  const back = await waitTip(P, 2500);
  const sB = await tipState(P);
  const g = await geom(P, c.sel);
  return {
    label: c.label,
    x,
    y,
    tipBefore: shown ? s0.text : null,
    want,
    route: (await route(P)).route,
    navReplaced: r1.navReplaced,
    pointerOnItemAfterRender: onItem,
    afterClick1s: { visibleFrames: frames1, showTransitions: shows1, frames: r1.frames.filter(f => f.t > down.t).length },
    replayedPointerover: {
      count: replay.length,
      trusted: replay.every(e => e.tr),
      atPointerPos: replay.every(e => near(e.x, down.x) && near(e.y, down.y)),
      events: replay.slice(0, 4).map(e => `${e.tg}@${e.x},${e.y}+${e.t - down.t}ms-after-down`),
      pointerDown: `${down.x},${down.y}`,
    },
    twoPxMove: mv,
    offTipHidden: !vis(sOff),
    back: { shown: back, text: sB.text, placed: placed(g, sB) },
    ok:
      shown &&
      s0.text === want &&
      r1.navReplaced &&
      frames1 === 0 &&
      shows1 === 0 &&
      replay.length >= 1 &&
      mv.frames === 0 &&
      mv.shows === 0 &&
      !vis(sOff) &&
      back &&
      sB.text === want &&
      placed(g, sB),
    vacuous: replay.length === 0,
  };
}
await group('R2a', async () => {
  const P = await mk(1280, 800, 'R2a');
  await setCollapsed(P, true);
  await park(P);
  await R2.install(P);
  const per = [],
    perF = [];
  for (const c of R2A_CASES) per.push(await r2aCase(P, c, false));
  for (const c of R2A_CASES) perF.push(await r2aCase(P, c, true));
  const noTip = !(await hasTip(P));
  await P.screenshot({ path: path.join(OUT, 'R2a-end.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  await chk(
    'R2a',
    `a click on Inbox, Home and a project row (pointer still, integer coordinates): no tip in any frame or show transition for 1 s through the render and the replayed pointerover; a 2 px move in the item: none; off and back: the tip shows`,
    P,
    async () => ({
      pass: per.length === 3 && per.every(x => x.ok),
      neg: noTip,
      ev: per.map(x => ({
        item: x.label,
        ok: x.ok,
        route: x.route,
        navReplaced: x.navReplaced,
        tipBefore: x.tipBefore,
        visibleFramesAfterClick1s: x.afterClick1s.visibleFrames + '/' + x.afterClick1s.frames,
        showTransitions: x.afterClick1s.showTransitions,
        replayedPointerover: x.replayedPointerover,
        twoPx: x.twoPxMove,
        offBack: x.back,
      })),
    }),
  );
  await chk('R2a2', `(extra) same with fractional pointer coordinates (x.5, y.25), as a browser zoom or a trackpad gives`, P, async () => ({
    pass: perF.length === 3 && perF.every(x => x.ok),
    neg: noTip,
    ev: perF.map(x => ({
      item: x.label,
      ok: x.ok,
      xy: [x.x, x.y],
      visibleFramesAfterClick1s: x.afterClick1s.visibleFrames,
      showTransitions: x.afterClick1s.showTransitions,
      replayedPointerover: x.replayedPointerover,
      twoPx: x.twoPxMove,
      offBack: x.back,
    })),
  }));
  L.note('R2a', 'vacuity guard: replayed pointerover counts ' + [...per, ...perF].map(x => `${x.label}:${x.replayedPointerover.count}`).join(' '));
  await restore(P);
  await done(P);
});

// ---- R2b: the latest input wins
await group('R2b', async () => {
  const P = await mk(1280, 800, 'R2b');
  await setCollapsed(P, true);
  await park(P);
  await P.reload();
  await P.waitForSelector('nav.side .sproj', { state: 'attached' });
  await quiet(P);
  await P.mouse.move(900, 720);
  await R2.install(P);
  const ev = {};
  // (1) the pointer parked on Home with its tip shown, then Tab onto the next rail item
  await goTo(P, 'inbox', {}, 'nav.side .sproj');
  await quiet(P);
  const tabs1 = await pressTo(P, 'nav.side .ws');
  const hb = await bbox(P, ITEMS.Home);
  const hx = Math.round(hb.cx),
    hy = Math.round(hb.cy);
  await P.mouse.move(hx, hy, { steps: 4 });
  const sh0 = await waitTip(P);
  const sHome = await tipState(P);
  await P.keyboard.press('Tab');
  const a1 = await act(P);
  const sh1 = await waitTip(P);
  const s1 = await tipState(P);
  const g1 = await geomActive(P);
  ev.tabOntoOther = { tabsToWs: tabs1, homeTipBefore: sh0 ? sHome.text : null, focus: a1, tipText: s1.text, tipShown: sh1, placedOnFocused: placed(g1, s1) };
  // (2) the pointer moved 2 px on Home: Home's tip shows. Several moves are tried, each is logged with the events that fired
  await R2.mark(P);
  const moves = [];
  for (const [dx, dy] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [2, 2],
    [-4, 0],
  ]) {
    await R2.mark(P);
    await P.mouse.move(hx + dx, hy + dy);
    await sleep(120);
    const s = await tipState(P);
    const rd = await R2.read(P);
    moves.push({
      to: [hx + dx, hy + dy],
      tip: vis(s) ? s.text : null,
      pointermove: rd.ev.filter(e => e.n === 'pointermove').length,
      pointerover: rd.ev.filter(e => e.n === 'pointerover').map(e => `${e.tg}@${e.x},${e.y}`),
    });
    if (vis(s) && s.text === 'Home') break;
  }
  ev.pointerMoveOnHome = { firstSwitchedToHomeAt: moves.findIndex(m => m.tip === 'Home'), literal2pxRight: moves[0], moves };
  const underPointer = await P.evaluate(
    ([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.tagName.toLowerCase() + (e.className && e.className.baseVal === undefined ? '.' + String(e.className).split(' ')[0] : '') : null;
    },
    [hx, hy],
  );
  ev.elementUnderPointer = underPointer;
  // (3) click Home (dismissed), keep still, Tab to the next item: its tip shows
  await goTo(P, 'inbox', {}, 'nav.side .sproj');
  await park(P);
  await P.mouse.move(hx, hy, { steps: 4 });
  await waitTip(P);
  await P.mouse.down();
  await sleep(60);
  await P.mouse.up();
  await P.waitForFunction(() => window.__pmspace.S.ui.route === 'home', null, { timeout: 4000 });
  await sleep(500);
  const afterClick = await tipState(P);
  const f0 = await act(P);
  await P.keyboard.press('Tab');
  const a3 = await act(P);
  const sh3 = await waitTip(P);
  const s3 = await tipState(P);
  const g3 = await geomActive(P);
  ev.clickThenTab = {
    tipAfterClickVisible: vis(afterClick),
    focusAfterClick: f0,
    focusAfterTab: a3,
    tipText: s3.text,
    tipShown: sh3,
    expectedText: a3.tip,
    placedOnFocused: placed(g3, s3),
  };
  await P.screenshot({ path: path.join(OUT, 'R2b-click-then-tab.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  // (4, extra) the same as (2) but with a 2 px move that stays inside the button itself (its padding, no child element crossed), so no pointerover
  await goTo(P, 'inbox', {}, 'nav.side .sproj');
  await park(P);
  const hbb = await P.evaluate(sel => {
    const b = document.querySelector(sel);
    const r = b.getBoundingClientRect();
    const c = b.firstElementChild ? b.firstElementChild.getBoundingClientRect() : null;
    return { l: r.left, r: r.right, cy: (r.top + r.bottom) / 2, childL: c ? c.left : null, childR: c ? c.right : null };
  }, ITEMS.Home);
  const px = Math.round(hbb.l) + 3,
    py = Math.round(hbb.cy);
  await P.mouse.move(px, py, { steps: 4 });
  const sh4 = await waitTip(P);
  const s4a = await tipState(P);
  await pressTo(P, 'nav.side .ws');
  await P.keyboard.press('Tab');
  const a4 = await act(P);
  await waitTip(P);
  const s4b = await tipState(P);
  await R2.mark(P);
  await P.mouse.move(px + 2, py);
  await sleep(300);
  const s4c = await tipState(P);
  const rd4 = await R2.read(P);
  const under4 = await P.evaluate(
    ([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.tagName.toLowerCase() + (e.dataset.r ? '[' + e.dataset.r + ']' : '') : null;
    },
    [px + 2, py],
  );
  const ev4 = {
    point: [px, py],
    homeButtonBox: { l: hbb.l, r: hbb.r, childL: hbb.childL, childR: hbb.childR },
    elementAtNewPoint: under4,
    homeTipBefore: sh4 ? s4a.text : null,
    focusAfterTab: a4.el,
    tipAfterTab: s4b.text,
    tipAfter2pxMove: vis(s4c) ? s4c.text : null,
    events: {
      pointermove: rd4.ev.filter(e => e.n === 'pointermove').length,
      pointerover: rd4.ev.filter(e => e.n === 'pointerover').map(e => `${e.tg}@${e.x},${e.y}`),
    },
  };
  await chk(
    'R2b4',
    `(R2b extra) after Tab moved the tip to another item, a 2 px pointer move inside Home's button (no child boundary crossed, so pointermove only) brings Home's tip back`,
    P,
    async () => ({
      pass: sh4 && s4a.text === 'Home' && a4.fv && s4b.text === a4.tip && vis(s4c) && s4c.text === 'Home',
      neg: !(await hasTip(P)),
      ev: ev4,
    }),
  );
  const neg = !(await hasTip(P));
  await chk(
    'R2b',
    `latest input wins: (1) pointer parked on Home (tip), Tab onto another rail item: that item's tip shows; (2) a 2 px pointer move on Home: Home's tip shows; (3) click Home, keep still, Tab: the next item's tip shows`,
    P,
    async () => ({
      pass:
        ev.tabOntoOther.homeTipBefore === 'Home' &&
        a1.fv &&
        a1.inSide &&
        ev.tabOntoOther.tipShown &&
        s1.text === a1.tip &&
        s1.text !== 'Home' &&
        ev.tabOntoOther.placedOnFocused &&
        moves[0].tip === 'Home' &&
        ev.clickThenTab.tipShown &&
        a3.fv &&
        s3.text === a3.tip &&
        s3.text !== 'Home' &&
        ev.clickThenTab.placedOnFocused &&
        !ev.clickThenTab.tipAfterClickVisible,
      neg,
      ev,
    }),
  );
  await chk(
    'R2b1',
    `(R2b part 1) pointer parked on Home with its tip shown, Tab onto another rail item (focus-visible): that item's tip shows, not Home's`,
    P,
    async () => ({
      pass:
        ev.tabOntoOther.homeTipBefore === 'Home' &&
        a1.fv &&
        ev.tabOntoOther.tipShown &&
        s1.text === a1.tip &&
        s1.text !== 'Home' &&
        ev.tabOntoOther.placedOnFocused,
      neg,
      ev: ev.tabOntoOther,
    }),
  );
  await chk('R2b2', `(R2b part 2) then a 2 px pointer move on Home: Home's tip shows`, P, async () => ({
    pass: moves[0].tip === 'Home',
    neg,
    ev: { literal2pxRight: moves[0], firstSwitchedToHomeAtMoveIndex: moves.findIndex(m => m.tip === 'Home'), moves, elementUnderPointer: underPointer },
  }));
  await chk('R2b3', `(R2b part 3) click Home (dismissed), keep still, Tab to the next item: its tip shows`, P, async () => ({
    pass:
      ev.clickThenTab.tipShown && a3.fv && s3.text === a3.tip && s3.text !== 'Home' && ev.clickThenTab.placedOnFocused && !ev.clickThenTab.tipAfterClickVisible,
    neg,
    ev: ev.clickThenTab,
  }));
  await restore(P);
  await done(P);
});

// ---- R2c: a press off any item leaves a keyboard tip alone
await group('R2c', async () => {
  const P = await mk(1280, 800, 'R2c');
  await setCollapsed(P, true);
  await park(P);
  await P.reload();
  await P.waitForSelector('nav.side .sproj', { state: 'attached' });
  await quiet(P);
  await P.mouse.move(900, 400);
  await R2.install(P);
  const per = [];
  for (let [label, sel] of [
    ['Inbox', 'nav.side .sitem[data-r="inbox"]'],
    ['Settings', 'nav.side .sitem[data-r="settings"]'],
    ['Project row', 'nav.side .sproj > .sitem'],
  ]) {
    await goTo(P, 'home', {}, 'nav.side .sproj');
    await P.evaluate(() => document.activeElement?.blur());
    await P.mouse.move(900, 400);
    await quiet(P);
    const tabs = await pressTo(P, sel);
    const a0 = await act(P);
    const rid = await P.evaluate(() => (document.activeElement.matches('.sproj > .sitem') ? document.activeElement.dataset.id : null));
    sel = rid ? `nav.side .sproj > .sitem[data-id="${rid}"]` : sel;
    const sh0 = await waitTip(P);
    const s0 = await tipState(P);
    // an empty spot of the content area
    const spot = await P.evaluate(() => {
      const bad =
        'nav.side,button,a,input,select,textarea,summary,[data-a],[data-pop],[role="button"],[role="link"],[role="tab"],[role="menuitem"],[contenteditable]';
      for (let y = 790; y > 300; y -= 25)
        for (let x = 1270; x > 330; x -= 40) {
          const e = document.elementFromPoint(x, y);
          if (e && e !== document.documentElement && !e.closest(bad)) return { x, y, el: e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] };
        }
      return null;
    });
    await P.mouse.click(spot.x, spot.y);
    await sleep(250);
    const afterClick = await act(P);
    const sC = await tipState(P);
    const back = await pressTo(P, sel, 'Shift+Tab', 90);
    const a1 = await act(P);
    const sh1 = await waitTip(P);
    const s1 = await tipState(P);
    const g = await geomActive(P);
    // and forward with Tab from the click point
    await P.mouse.click(spot.x, spot.y);
    await sleep(200);
    const fwd = await pressTo(P, sel, 'Tab', 120);
    const a2 = await act(P);
    const sh2 = await waitTip(P);
    const s2 = await tipState(P);
    const g2 = await geomActive(P);
    per.push({
      label,
      tabsToItem: tabs,
      tipBefore: sh0 ? s0.text : null,
      clickSpot: spot,
      focusAfterClick: afterClick.el,
      tipVisibleAfterClick: vis(sC),
      shiftTabPresses: back,
      returned: a1.el,
      fv: a1.fv,
      tipOnReturn: sh1 ? s1.text : null,
      placed: placed(g, s1),
      tabPressesForward: fwd,
      returnedFwd: a2.el,
      tipOnReturnFwd: sh2 ? s2.text : null,
      placedFwd: placed(g2, s2),
      ok: tabs > 0 && sh0 && s0.text === a0.tip && back > 0 && a1.fv && sh1 && s1.text === a1.tip && placed(g, s1),
      okFwd: fwd > 0 && a2.fv && sh2 && s2.text === a2.tip && placed(g2, s2),
    });
    await P.screenshot({ path: path.join(OUT, `R2c-${label.replace(/\W+/g, '_')}-return.png`), clip: { x: 0, y: 0, width: 320, height: 800 } });
  }
  const neg = !(await hasTip(P));
  await chk(
    'R2c',
    `Tab onto a rail item (tip), click the empty content area, Shift+Tab back to the item without moving the pointer: its tip shows (Inbox, Settings, a project row); and forward with Tab (extra)`,
    P,
    async () => ({
      pass: per.every(x => x.ok) && per.every(x => x.okFwd),
      neg,
      ev: per,
    }),
  );
  await restore(P);
  await done(P);
});

// ---- R2d: under overlays
await group('R2d', async () => {
  const P = await mk(1280, 800, 'R2d');
  await setCollapsed(P, true);
  await park(P);
  await R2.install(P);
  const per = [];
  if (!(await hasTip(P))) {
    // main: there is no #rail-tip to stack, so the check cannot hold
    await chk(
      'R2d',
      `pointer resting on a rail item with its tip, then Ctrl+K and (separately) ?: the tip is painted below the scrim; z-index 60`,
      P,
      async () => ({ pass: false, neg: true, ev: { noRailTip: true, note: 'no #rail-tip element in this build, nothing to stack' } }),
    );
    await restore(P);
    await done(P);
    return;
  }
  for (const [name, key] of [
    ['palette', 'Control+k'],
    ['shortcuts', '?'],
  ]) {
    await goTo(P, 'home', {}, 'nav.side .sproj');
    await park(P);
    const hb = await bbox(P, ITEMS.Home);
    await P.mouse.move(Math.round(hb.cx), Math.round(hb.cy), { steps: 4 });
    const shown = await waitTip(P);
    const z0 = await P.evaluate(() => {
      const t = document.getElementById('rail-tip');
      return t ? getComputedStyle(t).zIndex : null;
    });
    await R2.mark(P);
    await P.keyboard.press(key);
    await sleep(600);
    const rd = await R2.read(P);
    const open = await P.evaluate(() => ({
      palette: !!document.querySelector('.palette'),
      modal: !!document.querySelector('.modal'),
      scrim: !!document.querySelector('.scrim'),
    }));
    let s = await tipState(P);
    const stayed = vis(s);
    let forced = false;
    if (!stayed && s.exists) {
      await P.evaluate(() => {
        document.getElementById('rail-tip').hidden = false;
      });
      forced = true;
      await sleep(700);
      s = await tipState(P);
    }
    // the tip's centre: what is under it (the tip itself is pointer-events:none, so it is made hit-testable for the probe only)
    const cx = (s.l + s.r) / 2,
      cy = (s.t + s.b) / 2;
    const probe = await P.evaluate(
      ([x, y]) => {
        const t = document.getElementById('rail-tip');
        const pe = t.style.pointerEvents;
        const d = e =>
          e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '');
        const plain = document.elementFromPoint(x, y);
        t.style.pointerEvents = 'auto';
        const stack = document.elementsFromPoint(x, y).map(e => ({ el: d(e), z: getComputedStyle(e).zIndex, pos: getComputedStyle(e).position }));
        t.style.pointerEvents = pe;
        const z = sel => {
          const e = document.querySelector(sel);
          return e ? getComputedStyle(e).zIndex : null;
        };
        return {
          elementFromPoint: plain ? d(plain) : null,
          stack: stack.slice(0, 5),
          tipIndex: stack.findIndex(e => e.el.startsWith('div#rail-tip')),
          z: { scrim: z('.scrim'), modalWrap: z('.modal-wrap'), palette: z('.palette'), tip: z('#rail-tip') },
        };
      },
      [cx, cy],
    );
    // pixel evidence: the tip's own background colour sampled 3 px inside its left edge, against the colour on screen
    const shot = await P.screenshot({
      clip: { x: Math.max(0, Math.floor(s.l)), y: Math.max(0, Math.floor(s.t)), width: Math.ceil(s.w), height: Math.ceil(s.h) },
    });
    const full = path.join(OUT, `R2d-${name}.png`);
    fs.writeFileSync(full, await P.screenshot({ clip: { x: 0, y: 0, width: 640, height: 400 } }));
    const raw = await rawRgba(shot);
    const px = (xx, yy) => {
      const i = (yy * raw.info.width + xx) * 4;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
    };
    const sample = px(2, Math.floor(raw.info.height / 2));
    await P.evaluate(() => {
      document.getElementById('rail-tip').style.visibility = 'hidden';
    });
    const shotHid = await P.screenshot({
      clip: { x: Math.max(0, Math.floor(s.l)), y: Math.max(0, Math.floor(s.t)), width: Math.ceil(s.w), height: Math.ceil(s.h) },
    });
    await P.evaluate(() => {
      document.getElementById('rail-tip').style.visibility = '';
    });
    const dHid = await pixelDiff(shot, shotHid);
    const rawH = await rawRgba(shotHid);
    const sampleHid = [
      rawH.data[(Math.floor(rawH.info.height / 2) * rawH.info.width + 2) * 4],
      rawH.data[(Math.floor(rawH.info.height / 2) * rawH.info.width + 2) * 4 + 1],
      rawH.data[(Math.floor(rawH.info.height / 2) * rawH.info.width + 2) * 4 + 2],
    ];
    const tipBg = s.bg.match(/\d+/g).slice(0, 3).map(Number);
    const exact = sample.every((v, i) => v === tipBg[i]);
    per.push({
      overlay: name,
      key,
      tipShownBefore: shown,
      zIndexBefore: z0,
      open,
      tipStayedShownAfterKey: stayed,
      forcedVisibleForProbe: forced,
      visibleFramesAfterKey: visIn(rd, 0),
      computed: probe.z,
      elementFromPointAtTipCentre: probe.elementFromPoint,
      stackTopDown: probe.stack,
      tipIndexInStack: probe.tipIndex,
      tipBg,
      sampledPixelInTip: sample,
      sampledPixelSamePlaceTipHidden: sampleHid,
      pixelEqualsTipBg: exact,
      pixelDiffTipVsTipHidden: dHid,
      shot: `R2d-${name}.png`,
      ok: shown && z0 === '60' && (open.palette || open.modal) && probe.z.tip === '60' && probe.tipIndex > 0 && !exact,
    });
    await P.keyboard.press('Escape');
    await sleep(300);
    await P.keyboard.press('Escape');
    await sleep(200);
  }
  const neg = !(await hasTip(P));
  await chk(
    'R2d',
    `pointer resting on a rail item with its tip, then Ctrl+K and (separately) ?: the tip is painted below the scrim (stack order with the tip made hit-testable, tip colour not on screen at its box); z-index 60`,
    P,
    async () => ({
      pass: per.length === 2 && per.every(x => x.ok),
      neg,
      ev: per,
    }),
  );
  await restore(P);
  await done(P);
});

// ---- R2e: the project row's hover controls
await group('R2e', async () => {
  const P = await mk(1280, 800, 'R2e');
  await setCollapsed(P, false);
  await park(P);
  await P.evaluate(() => {
    const e = window.__pmspace.S.ui.expanded;
    for (const k of Object.keys(e)) delete e[k];
    window.__pmspace.render();
  });
  await sleep(300);
  const inv = await P.evaluate(() =>
    [...document.querySelectorAll('nav.side .sproj > .sitem')].map(r => {
      const h = r.querySelector('.hov');
      return {
        id: r.dataset.id,
        name: r.querySelector('.trunc').textContent,
        hovAriaHidden: h.getAttribute('aria-hidden'),
        kids: [...h.querySelectorAll('[data-a]')].map(k => ({
          label: k.getAttribute('aria-label'),
          tabindex: k.getAttribute('tabindex'),
          role: k.getAttribute('role'),
        })),
        hovDisplayIdle: getComputedStyle(h).display,
      };
    }),
  );
  // the Tab walk
  await P.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('nav.side .ws').focus();
  });
  const walk = [];
  for (let i = 0; i < 90; i++) {
    await P.keyboard.press('Tab');
    const w = await P.evaluate(() => {
      const e = document.activeElement;
      const row = e.matches('.sproj > .sitem') ? e : null;
      const h = row?.querySelector('.hov'),
        sd = row?.querySelector('.sdot');
      return {
        inSide: !!e.closest('nav.side'),
        inHov: !!e.closest('.hov'),
        isRow: !!row,
        name: row?.querySelector('.trunc').textContent,
        fv: e.matches(':focus-visible'),
        hov: h ? getComputedStyle(h).display : null,
        sdot: sd ? getComputedStyle(sd).display : null,
        hovered: row ? row.matches(':hover') : null,
        desc:
          e.tagName.toLowerCase() +
          (e.dataset.a ? '[' + e.dataset.a + ']' : '') +
          (e.getAttribute('aria-label') ? '(' + e.getAttribute('aria-label') + ')' : ''),
      };
    });
    if (!w.inSide) break;
    walk.push(w);
  }
  const rowsWalk = walk.filter(w => w.isRow);
  await P.screenshot({ path: path.join(OUT, 'R2e-expanded-focus.png'), clip: { x: 0, y: 0, width: 260, height: 800 } });
  // the accessible name while hovered
  const names = [];
  await withCdp(P, async cdp => {
    for (const r of inv) {
      await park(P);
      await P.locator(`nav.side .sproj > .sitem[data-id="${r.id}"]`).hover();
      const st = await P.evaluate(id => {
        const r = document.querySelector(`nav.side .sproj > .sitem[data-id="${id}"]`);
        return {
          hovered: r.matches(':hover'),
          hov: getComputedStyle(r.querySelector('.hov')).display,
          sdot: getComputedStyle(r.querySelector('.sdot')).display,
        };
      }, r.id);
      const ax = await axOne(cdp, P, `nav.side .sproj > .sitem[data-id="${r.id}"]`);
      names.push({ name: r.name, axName: ax?.name, hovered: st.hovered, hovDisplay: st.hov, sdot: st.sdot });
    }
  });
  await park(P);
  // the rail
  await setCollapsed(P, true);
  await park(P);
  await P.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('nav.side .ws').focus();
  });
  const railWalk = [];
  for (let i = 0; i < 90; i++) {
    await P.keyboard.press('Tab');
    const w = await P.evaluate(() => {
      const e = document.activeElement;
      const row = e.matches('.sproj > .sitem') ? e : null;
      const h = row?.querySelector('.hov'),
        sd = row?.querySelector('.sdot');
      return {
        inSide: !!e.closest('nav.side'),
        inHov: !!e.closest('.hov'),
        isRow: !!row,
        name: row?.querySelector('.trunc').textContent,
        fv: e.matches(':focus-visible'),
        hov: h ? getComputedStyle(h).display : null,
        sdot: sd ? getComputedStyle(sd).display : null,
      };
    });
    if (!w.inSide) break;
    railWalk.push(w);
  }
  const railRows = railWalk.filter(w => w.isRow);
  await P.screenshot({ path: path.join(OUT, 'R2e-rail-focus.png'), clip: { x: 0, y: 0, width: 260, height: 800 } });
  const neg = inv.every(r => r.hovAriaHidden !== 'true') && names.some(n => n.axName !== n.name); // main: .hov is not aria-hidden and its text is in the row's name (the walk itself skips it while it is display:none)
  await chk(
    'R2e',
    `project rows: no Tab stop on .hov, .hov aria-hidden, row name = project name while hovered; focus-visible row shows .hov and hides .sdot; the collapsed rail keeps .hov hidden on focus`,
    P,
    async () => ({
      pass:
        inv.length >= 3 &&
        inv.every(r => r.hovAriaHidden === 'true' && r.kids.length === 2 && r.kids.every(k => k.tabindex === null && k.role === null)) &&
        walk.length > 20 &&
        !walk.some(w => w.inHov) &&
        rowsWalk.length === inv.length &&
        names.every(n => n.axName === n.name && n.hovered && n.hovDisplay !== 'none') &&
        rowsWalk.every(w => w.fv && !w.hovered && w.hov !== 'none' && w.sdot === 'none') &&
        railRows.length === inv.length &&
        railRows.every(w => w.fv && w.hov === 'none') &&
        !railWalk.some(w => w.inHov),
      neg,
      ev: {
        rows: inv.length,
        hovAriaHidden: inv.map(r => r.hovAriaHidden).join(','),
        hovKidsTabindex: inv.map(r => r.kids.map(k => k.tabindex + '/' + k.role).join('|')).join(' ; '),
        tabWalkStops: walk.length,
        stopsOnHov: walk.filter(w => w.inHov).length,
        expandedFocusVisibleRows: rowsWalk.map(w => `${w.name}: fv=${w.fv} hov=${w.hov} sdot=${w.sdot}`),
        namesWhileHovered: names.map(
          n => `${JSON.stringify(n.axName)}${n.axName === n.name ? ' ok' : ' MISMATCH(' + n.name + ')'} hov=${n.hovDisplay} sdot=${n.sdot}`,
        ),
        railWalkStops: railWalk.length,
        stopsOnHovInRail: railWalk.filter(w => w.inHov).length,
        railFocusVisibleRows: railRows.map(w => `${w.name}: fv=${w.fv} hov=${w.hov} sdot=${w.sdot}`),
      },
    }),
  );
  await restore(P);
  await done(P);
});

// ---- R2f: aria-current
await group('R2f', async () => {
  const P = await mk(1280, 800, 'R2f');
  await setCollapsed(P, false);
  await park(P);
  const PID = 'seed000000000p1',
    VID = 'seed000000000v1';
  const rowSel = `nav.side .sproj > .sitem[data-id="${PID}"]`;
  const snap = () =>
    P.evaluate(
      ([rowSel, pid]) => {
        const row = document.querySelector(rowSel);
        const others = [...document.querySelectorAll('nav.side .sproj > .sitem')].filter(r => r.dataset.id !== pid && r.hasAttribute('aria-current')).length;
        const sub = [...row.closest('.sproj').querySelectorAll('.sub .sitem')].map(b => `${b.textContent.trim()}=${b.getAttribute('aria-current')}`);
        return {
          row: row.getAttribute('aria-current'),
          subOpen: !!row.closest('.sproj').querySelector('.sub.open'),
          ariaExpanded: row.getAttribute('aria-expanded'),
          subTabs: sub,
          subMarked: sub.filter(s => !s.endsWith('=null')).length,
          otherRowsMarked: others,
          tab: window.__pmspace.S.ui.params.tab,
          route: window.__pmspace.S.ui.route,
        };
      },
      [rowSel, PID],
    );
  const ev = {};
  await P.evaluate(() => {
    const e = window.__pmspace.S.ui.expanded;
    for (const k of Object.keys(e)) delete e[k];
  });
  await goTo(P, 'project', { id: PID, tab: 'board' }, rowSel);
  await P.evaluate(pid => {
    window.__pmspace.S.ui.expanded[pid] = true;
    window.__pmspace.render();
  }, PID);
  await sleep(500);
  ev.open = await snap();
  await P.focus(rowSel);
  await P.evaluate(() => {
    /* focus is on the row */
  });
  await P.keyboard.press('ArrowLeft');
  await sleep(450);
  ev.closedByArrowLeft = await snap();
  ev.closedByArrowLeft.focusOnRow = await P.evaluate(sel => document.activeElement === document.querySelector(sel), rowSel);
  await P.keyboard.press('ArrowRight');
  await sleep(450);
  ev.reopened = await snap();
  await setCollapsed(P, true);
  await park(P);
  ev.rail = await snap();
  ev.beforeExpand = await P.evaluate(() => ({
    col: document.querySelector('.shell').classList.contains('collapsed'),
    ui: window.__pmspace.S.ui.collapsed,
    w: innerWidth,
  }));
  // Expanding right after a collapse sometimes reverts by itself within ~100 ms (the same on main: about half of the runs). That is not what this
  // check is about, so it is retried (up to 4 times) and the number of reverts is reported.
  ev.expandReverts = 0;
  for (let i = 0; i < 4; i++) {
    await setCollapsed(P, false);
    await sleep(500);
    if (!(await isCol(P))) break;
    ev.expandReverts++;
  }
  ev.colAfterExpand = await isCol(P);
  await park(P);
  ev.colAfterPark = await isCol(P);
  ev.pendingAfterExpand = (await L.settle(P, 8000)).length;
  await sleep(500);
  ev.colAfterSettle = await isCol(P);
  await goTo(P, 'project', { id: PID, tab: 'v:' + VID }, rowSel);
  ev.colAfterGo = await isCol(P);
  ev.savedViewSubClosedAtArrival = await snap();
  await P.evaluate(pid => {
    window.__pmspace.S.ui.expanded[pid] = true;
    window.__pmspace.render();
  }, PID);
  await sleep(500);
  ev.savedViewOpenSub = await snap();
  await P.screenshot({ path: path.join(OUT, 'R2f-saved-view.png'), clip: { x: 0, y: 0, width: 260, height: 800 } });
  const neg = ev.open.row === null;
  await chk(
    'R2f',
    `aria-current: Board tab, sub-list open: row "true", Board sub-tab "page"; sub-list closed by ArrowLeft: row "page"; collapsed rail: row "page"; saved view (sub-list open): row "page", no sub-tab marked`,
    P,
    async () => ({
      pass:
        ev.open.subOpen &&
        ev.open.route === 'project' &&
        ev.open.row === 'true' &&
        ev.open.subTabs.join() === 'Board=page,List=null,Timeline=null,Files=null' &&
        ev.open.otherRowsMarked === 0 &&
        !ev.closedByArrowLeft.subOpen &&
        ev.closedByArrowLeft.row === 'page' &&
        ev.closedByArrowLeft.focusOnRow &&
        ev.reopened.row === 'true' &&
        ev.rail.row === 'page' &&
        ev.rail.ariaExpanded === null &&
        ev.savedViewOpenSub.subOpen &&
        ev.savedViewOpenSub.tab === 'v:' + VID &&
        ev.savedViewOpenSub.row === 'page' &&
        ev.savedViewOpenSub.subMarked === 0 &&
        ev.savedViewOpenSub.otherRowsMarked === 0,
      neg,
      ev,
    }),
  );
  await restore(P);
  await done(P);
});

// ---- R2g: focus returns to the topbar twin
await group('R2g', async () => {
  const ev = {};
  const TOP = 'header.topbar [data-pop="user"]',
    BELL = 'header.topbar [data-r="notifications"]';
  for (const mode of ['collapsed', 'expanded']) {
    const P = await mk(1280, 800, 'R2g-' + mode);
    await setCollapsed(P, mode === 'collapsed');
    await park(P);
    await P.reload();
    await P.waitForSelector('nav.side .sproj', { state: 'attached' });
    await quiet(P);
    await P.mouse.move(900, 720);
    await goTo(P, 'home', {}, 'nav.side .sproj');
    const E = (ev[mode] = {});
    // (1) user menu from the topbar avatar, closed with Esc
    E.tabsToAvatar = await pressTo(P, TOP, 'Tab', 90);
    E.avatar = await act(P);
    await P.keyboard.press('Enter');
    await sleep(450);
    E.popOpen = await P.evaluate(() => ({
      type: window.__pmspace.S.ui.pop?.type,
      opener: window.__pmspace.S.ui.popOpener,
      focus: document.activeElement.textContent.trim().slice(0, 20),
    }));
    await P.keyboard.press('Escape');
    await sleep(500);
    E.afterEsc = await act(P);
    E.afterEscTip = await tipState(P);
    E.afterEscFrames = await visibleFrames(P, 700);
    await P.screenshot({ path: path.join(OUT, `R2g-${mode}-esc.png`), clip: { x: 0, y: 0, width: 1280, height: 120 } });
    // (2) a Theme button chosen by Enter keeps the menu open (Dark, then System again to restore the pref); then Esc
    const th0 = await P.evaluate(() => window.__pmspace.S.prefs.theme);
    await P.keyboard.press('Enter');
    await sleep(400);
    E.tabsToTheme = await pressTo(P, '.pop [data-a="setTheme"][data-v="dark"]', 'Tab', 14);
    await P.keyboard.press('Enter');
    await sleep(500);
    E.afterTheme = await act(P);
    E.afterThemePop = await P.evaluate(() => ({
      pop: window.__pmspace.S.ui.pop?.type || null,
      route: window.__pmspace.S.ui.route,
      theme: window.__pmspace.S.prefs.theme,
    }));
    E.afterThemeTip = await tipState(P);
    E.themeBefore = th0;
    if (E.afterThemePop.pop) {
      await P.evaluate(() => document.querySelector('.pop [data-a="setTheme"][data-v="system"]')?.click());
      await sleep(400);
      await P.keyboard.press('Escape');
      await sleep(500);
      E.afterThemeEsc = await act(P);
      E.afterThemeEscTip = await tipState(P);
      E.themeRestored = await P.evaluate(() => window.__pmspace.S.prefs.theme);
    }
    // (2b) "Keyboard shortcuts" in the user menu, chosen by Enter: the menu closes, a dialog opens over the page; Esc closes the dialog
    await P.keyboard.press('Enter');
    await sleep(400);
    E.tabsToShortcuts = await pressTo(P, '.pop [data-a="shortcuts"]', 'Tab', 14);
    await P.keyboard.press('Enter');
    await sleep(500);
    E.shortcutsOpen = await P.evaluate(() => ({
      modals: window.__pmspace.S.ui.modals.length,
      pop: window.__pmspace.S.ui.pop?.type || null,
      opener: window.__pmspace.S.ui.modalOpeners?.[0] ?? null,
    }));
    await P.keyboard.press('Escape');
    await sleep(600);
    E.afterShortcutsEsc = await act(P);
    E.afterShortcutsEscTip = await tipState(P);
    E.afterShortcutsEscFrames = await visibleFrames(P, 500);
    E.afterShortcutsClosed = await P.evaluate(() => ({ modals: window.__pmspace.S.ui.modals.length, pop: window.__pmspace.S.ui.pop?.type || null }));
    await P.screenshot({ path: path.join(OUT, `R2g-${mode}-shortcuts-esc.png`), clip: { x: 0, y: 0, width: 1280, height: 120 } });
    // (3) the bell, Enter: where is focus after the render
    await P.evaluate(() => document.activeElement?.blur());
    await goTo(P, 'home', {}, 'nav.side .sproj');
    await P.mouse.move(900, 720);
    E.tabsToBell = await pressTo(P, BELL, 'Tab', 90);
    E.bell = await act(P);
    await P.keyboard.press('Enter');
    await sleep(700);
    E.afterBell = await act(P);
    E.afterBellRoute = await P.evaluate(() => window.__pmspace.S.ui.route);
    E.afterBellTip = await tipState(P);
    E.afterBellFrames = await visibleFrames(P, 600);
    await P.screenshot({ path: path.join(OUT, `R2g-${mode}-bell.png`), clip: { x: 0, y: 0, width: 1280, height: 120 } });
    await restore(P);
    await done(P);
  }
  const C = ev.collapsed,
    X = ev.expanded;
  const okMode = E =>
    E.avatar.id === 'top-account' &&
    E.popOpen.type === 'user' &&
    E.afterEsc.id === 'top-account' &&
    E.afterEsc.inTop &&
    !E.afterEsc.inSide &&
    !vis(E.afterEscTip) &&
    E.afterEscFrames === 0 &&
    E.afterBell.id === 'top-notifs' &&
    E.afterBellRoute === 'notifications' &&
    !vis(E.afterBellTip) &&
    E.afterBellFrames === 0;
  const neg = !!C.afterEsc.inSide && (C.afterEsc.el.includes('pop:user') || C.afterEsc.label === 'Account');
  await chk(
    'R2g',
    `focus returns to the topbar twin: avatar (#top-account) Enter then Esc: focus on #top-account, no rail tip (rail collapsed; expanded too); bell (#top-notifs) Enter: focus after the render reported`,
    { errs: [] },
    async () => ({
      pass: okMode(C) && okMode(X),
      neg,
      ev: { collapsed: C, expanded: X },
    }),
  );
  await chk(
    'R2g2',
    `(R2g part) Theme > Dark chosen by Enter in the user menu (menu stays open), then Esc: focus on #top-account, no rail tip; theme restored (collapsed rail, then expanded)`,
    { errs: [] },
    async () => ({
      pass: [C, X].every(
        E =>
          E.afterThemePop.theme === 'dark' &&
          E.afterThemeEsc &&
          E.afterThemeEsc.id === 'top-account' &&
          !vis(E.afterThemeEscTip) &&
          E.themeRestored === E.themeBefore,
      ),
      neg,
      ev: Object.fromEntries(
        [
          ['collapsed', C],
          ['expanded', X],
        ].map(([k, E]) => [
          k,
          {
            themeBefore: E.themeBefore,
            tabsToTheme: E.tabsToTheme,
            afterTheme: E.afterTheme,
            afterThemePop: E.afterThemePop,
            afterThemeTipVisible: vis(E.afterThemeTip),
            afterThemeEsc: E.afterThemeEsc,
            afterThemeEscTipVisible: E.afterThemeEscTip ? vis(E.afterThemeEscTip) : null,
            themeRestored: E.themeRestored,
          },
        ]),
      ),
    }),
  );
  await chk(
    'R2g3',
    `(R2g part) "Keyboard shortcuts" chosen by Enter in the user menu opened from the topbar avatar (keeps you on the page), Esc closes the dialog: focus on #top-account, no rail tip`,
    { errs: [] },
    async () => ({
      pass: [C, X].every(
        E =>
          E.shortcutsOpen.modals === 1 &&
          E.afterShortcutsClosed.modals === 0 &&
          E.afterShortcutsEsc.id === 'top-account' &&
          E.afterShortcutsEsc.inTop &&
          !vis(E.afterShortcutsEscTip) &&
          E.afterShortcutsEscFrames === 0,
      ),
      neg,
      ev: Object.fromEntries(
        [
          ['collapsed', C],
          ['expanded', X],
        ].map(([k, E]) => [
          k,
          {
            tabsToShortcuts: E.tabsToShortcuts,
            open: E.shortcutsOpen,
            afterEsc: E.afterShortcutsEsc,
            closed: E.afterShortcutsClosed,
            tipVisible: vis(E.afterShortcutsEscTip),
            visibleFramesAfterEsc500ms: E.afterShortcutsEscFrames,
          },
        ]),
      ),
    }),
  );
});

// ---- R2h: arrows wait for overlays
await group('R2h', async () => {
  const P = await mk(1280, 800, 'R2h');
  await setCollapsed(P, false);
  await park(P);
  await P.evaluate(() => {
    const e = window.__pmspace.S.ui.expanded;
    for (const k of Object.keys(e)) delete e[k];
    window.__pmspace.render();
  });
  await sleep(300);
  const id = await P.evaluate(() => document.querySelectorAll('nav.side .sproj > .sitem')[1].dataset.id);
  const rowSel = `nav.side .sproj > .sitem[data-id="${id}"]`;
  const st = () =>
    P.evaluate(
      ([sel]) => {
        const r = document.querySelector(sel);
        return {
          open: !!r.closest('.sproj').querySelector('.sub.open'),
          ariaExpanded: r.getAttribute('aria-expanded'),
          exp: JSON.stringify(window.__pmspace.S.ui.expanded),
          pop: window.__pmspace.S.ui.pop?.type || null,
          pal: !!window.__pmspace.S.ui.palette,
          modals: window.__pmspace.S.ui.modals.length,
          focusOnRow: document.activeElement === r,
          ae: document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : ''),
        };
      },
      [rowSel],
    );
  const ev = {};
  const focusRow = async () => {
    await P.evaluate(() => {
      document.activeElement?.blur();
      document.querySelector('nav.side .ws').focus();
    });
    for (let i = 0; i < 60; i++) {
      await P.keyboard.press('Tab');
      if (await P.evaluate(s => document.activeElement.matches(s), rowSel)) return i + 1;
    }
    return 0;
  };
  ev.tabsToRow = await focusRow();
  ev.s0 = await st();
  // (1) the context menu from the keyboard
  await P.keyboard.press('Shift+F10');
  await sleep(400);
  ev.afterShiftF10 = await st();
  let viaKey = 'Shift+F10';
  if (ev.afterShiftF10.pop !== 'ctx') {
    await P.keyboard.press('ContextMenu');
    await sleep(400);
    ev.afterContextMenuKey = await st();
    viaKey = 'ContextMenu key';
    if (ev.afterContextMenuKey.pop !== 'ctx') {
      await P.evaluate(sel => {
        const r = document.querySelector(sel);
        const b = r.getBoundingClientRect();
        r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 10 }));
      }, rowSel);
      await sleep(400);
      viaKey = 'synthetic contextmenu event (harness fallback: the keys did not open it)';
      ev.afterSynthetic = await st();
    }
  }
  ev.menuOpenedVia = viaKey;
  ev.ctxOpen = await st();
  await P.keyboard.press('ArrowRight');
  await sleep(450);
  ev.ctxArrowRight = await st();
  await P.keyboard.press('ArrowLeft');
  await sleep(300);
  ev.ctxArrowLeft = await st();
  await P.keyboard.press('Escape');
  await sleep(450);
  ev.afterEsc = await st();
  await P.keyboard.press('ArrowRight');
  await sleep(450);
  ev.escThenRight = await st();
  await P.keyboard.press('ArrowLeft');
  await sleep(450);
  ev.escThenLeft = await st();
  // (2) the palette: focus is on its input while it is open; so the row is also focused by hand to make the guard the thing that is tested
  await P.keyboard.press('Control+k');
  await sleep(500);
  ev.palOpen = await st();
  await P.keyboard.press('ArrowRight');
  await sleep(300);
  ev.palArrowRightOnInput = await st();
  await P.focus(rowSel);
  await sleep(100);
  ev.palRowRefocused = await st();
  await P.keyboard.press('ArrowRight');
  await sleep(450);
  ev.palArrowRightOnRow = await st();
  await P.keyboard.press('Escape');
  await sleep(450);
  ev.palClosed = await st();
  if (!ev.palClosed.focusOnRow) {
    await P.focus(rowSel);
  }
  await P.keyboard.press('ArrowRight');
  await sleep(450);
  ev.palEscThenRight = await st();
  await P.screenshot({ path: path.join(OUT, 'R2h-end.png'), clip: { x: 0, y: 0, width: 260, height: 800 } });
  // (3) a dialog: ? opens the shortcuts modal with focus moved into it; the row is refocused by hand, then the same
  await P.keyboard.press('ArrowLeft');
  await sleep(400);
  const closedAgain = await st();
  await P.keyboard.press('?');
  await sleep(400);
  ev.modalOpen = await st();
  await P.focus(rowSel);
  await sleep(100);
  await P.keyboard.press('ArrowRight');
  await sleep(450);
  ev.modalArrowRightOnRow = await st();
  await P.keyboard.press('Escape');
  await sleep(450);
  ev.modalClosed = await st();
  const neg = !ev.escThenRight.open;
  await chk(
    'R2h',
    `arrows wait for overlays: with the context menu open (Shift+F10), ArrowRight on the row does not toggle its sub-list; same with the palette open; after Esc ArrowRight toggles`,
    P,
    async () => ({
      pass:
        ev.tabsToRow > 0 &&
        !ev.s0.open &&
        ev.ctxOpen.pop === 'ctx' &&
        ev.ctxOpen.focusOnRow &&
        !ev.ctxArrowRight.open &&
        ev.ctxArrowRight.exp === ev.s0.exp &&
        !ev.ctxArrowLeft.open &&
        !ev.afterEsc.pop &&
        ev.afterEsc.focusOnRow &&
        ev.escThenRight.open &&
        ev.escThenRight.ariaExpanded === 'true' &&
        ev.escThenRight.focusOnRow &&
        ev.palOpen.pal &&
        !ev.palArrowRightOnInput.open &&
        ev.palRowRefocused.focusOnRow &&
        ev.palRowRefocused.pal &&
        !ev.palArrowRightOnRow.open &&
        !ev.palClosed.pal &&
        closedAgain.open === false &&
        ev.palEscThenRight.open &&
        ev.modalOpen.modals > 0 &&
        !ev.modalArrowRightOnRow.open,
      neg,
      ev: { ...ev, closedAgain },
    }),
  );
  await restore(P);
  await done(P);
});

// =============== ROUND 3: R3a..R3e (branch dbfd78a). Run alone with RT_ONLY=R3. On main there is no #rail-tip: every check that needs a tip shown
// fails at its precondition (NEG = no #rail-tip), and the "no tip" assertions are vacuous.
// Page-side recorder (window.__r3), richer than R2's: per frame the tip's hidden state, text, opacity, its animation's currentTime and whether it
// is the same Animation object as at mark() (a restart replaces it); a MutationObserver replays every hidden/text change in order, so a tip that is
// drawn and hidden again inside one frame is still seen (`states`); animationstart count; pointer, focus and key events with isTrusted.
const R3 = {
  install: page =>
    page.evaluate(() => {
      if (window.__r3) return;
      const R = (window.__r3 = {
        frames: [],
        ev: [],
        states: [],
        starts: 0,
        simBad: 0,
        run: true,
        t0: performance.now(),
        anim0: null,
        k: null,
        k0: null,
        nav: null,
        sim: null,
      });
      const ms = (R.ms = () => Math.round(performance.now() - R.t0));
      const d = e => (e && e.tagName ? e.tagName.toLowerCase() + (e.dataset && e.dataset.r ? '[' + e.dataset.r + ']' : '') + (e.id ? '#' + e.id : '') : 'null');
      for (const n of ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointermove', 'click'])
        document.addEventListener(n, e => R.ev.push({ t: ms(), n, tg: d(e.target), x: e.clientX, y: e.clientY, tr: e.isTrusted }), true);
      document.addEventListener('focusin', e => R.ev.push({ t: ms(), n: 'focusin', tg: d(e.target), fv: e.target.matches(':focus-visible') }), true);
      document.addEventListener('focusout', e => R.ev.push({ t: ms(), n: 'focusout', tg: d(e.target) }), true);
      document.addEventListener('keydown', e => R.ev.push({ t: ms(), n: 'keydown', k: e.key }), true);
      document.addEventListener(
        'animationstart',
        e => {
          if (e.target.id === 'rail-tip') R.starts++;
        },
        true,
      );
      const tip = document.getElementById('rail-tip');
      if (tip) {
        R.sim = { hidden: tip.hidden, text: tip.textContent };
        R.k = R.k0 = R.sim.hidden ? 'H' : 'V:' + R.sim.text;
        new MutationObserver(recs => {
          for (const rec of recs) {
            if (rec.type === 'attributes') R.sim.hidden = rec.oldValue === null;
            else R.sim.text = rec.addedNodes[0] ? rec.addedNodes[0].data : '';
            const k = R.sim.hidden ? 'H' : 'V:' + R.sim.text;
            if (k !== R.k) {
              R.states.push({ t: ms(), s: k });
              R.k = k;
            }
          }
          if (R.sim.hidden !== tip.hidden || R.sim.text !== tip.textContent) R.simBad++;
        }).observe(tip, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true, childList: true });
      }
      const f = () => {
        const t = document.getElementById('rail-tip');
        if (t) {
          const a = t.getAnimations()[0],
            cs = getComputedStyle(t);
          R.frames.push({
            t: ms(),
            v: !t.hidden && cs.display !== 'none',
            x: t.textContent,
            o: +cs.opacity,
            ct: a ? a.currentTime : null,
            same: a ? a === R.anim0 : null,
          });
        } else R.frames.push({ t: ms(), v: false, x: null, o: 0, ct: null, same: null });
        if (R.run) requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }),
  mark: page =>
    page.evaluate(() => {
      const R = window.__r3;
      R.frames.length = 0;
      R.ev.length = 0;
      R.states.length = 0;
      R.starts = 0;
      R.nav = document.querySelector('nav.side');
      const t = document.getElementById('rail-tip');
      R.anim0 = t ? t.getAnimations()[0] || null : null;
      if (t) {
        R.sim.hidden = t.hidden;
        R.sim.text = t.textContent;
        R.k = R.k0 = t.hidden ? 'H' : 'V:' + t.textContent;
      }
      return R.ms();
    }),
  read: page =>
    page.evaluate(() => {
      const R = window.__r3;
      return {
        frames: R.frames.slice(),
        ev: R.ev.slice(),
        states: R.states.slice(),
        starts: R.starts,
        navReplaced: !!R.nav && !R.nav.isConnected,
        k0: R.k0,
        simBad: R.simBad,
        now: R.ms(),
      };
    }),
};
const r3vis = (rd, from = 0, to = 1e12) => rd.frames.filter(f => f.t > from && f.t <= to && f.v).length; // frames with the tip not hidden (even at opacity 0)
const r3drawn = (rd, from = 0, to = 1e12) => rd.states.filter(s => s.t > from && s.t <= to && s.s.startsWith('V:')).map(s => s.s.slice(2)); // texts it was un-hidden or re-texted with
// frames/transitions counted from the page's keydown of the key (the recorder's mark() and the CDP key press are a few ms apart, and the tip is still up before the key lands)
const r3afterKey = (rd, key) => {
  const kd = rd.ev.find(e => e.n === 'keydown' && e.k === key);
  const t = kd ? kd.t : 0;
  return {
    keyT: kd ? kd.t : null,
    visibleFrames: r3vis(rd, t),
    drawn: r3drawn(rd, t),
    framesAfter: rd.frames.filter(f => f.t > t).length,
    lastVisibleAt: (rd.frames.filter(f => f.t > t && f.v).slice(-1)[0] || {}).t !== undefined ? rd.frames.filter(f => f.t > t && f.v).slice(-1)[0].t - t : null,
    preKeyVisibleFrames: rd.frames.filter(f => f.t <= t && f.v).length,
  };
};
const mono = a => a.every((v, i) => i === 0 || v >= a[i - 1]);
const pev = rd => ({
  pointermove: rd.ev.filter(e => e.n === 'pointermove').length,
  pointerover: rd.ev.filter(e => e.n === 'pointerover').map(e => `${e.tg}@${e.x},${e.y}${e.tr ? '' : '(synthetic)'}`),
});
// fresh page: rail collapsed, module state reset by a reload, pointer parked outside the rail, recorder installed
async function r3page(tag, w = 1280, h = 800) {
  const P = await mk(w, h, tag);
  await setCollapsed(P, true);
  await park(P);
  await P.reload();
  await P.waitForSelector('nav.side .sproj', { state: 'attached' });
  await quiet(P);
  await setCollapsed(P, true);
  await P.mouse.move(900, Math.min(720, h - 60));
  await quiet(P);
  await R3.install(P);
  return P;
}
const spotOf = page =>
  page.evaluate(() => {
    const bad =
      'nav.side,button,a,input,select,textarea,summary,[data-a],[data-pop],[role="button"],[role="link"],[role="tab"],[role="menuitem"],[contenteditable]';
    for (let y = 790; y > 300; y -= 25)
      for (let x = 1270; x > 330; x -= 40) {
        const e = document.elementFromPoint(x, y);
        if (e && e !== document.documentElement && !e.closest(bad)) return { x, y, el: e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] };
      }
    return null;
  });
const shot = (page, name, clip) => page.screenshot({ path: path.join(OUT, name), clip: clip || { x: 0, y: 0, width: 320, height: 300 } });

// ---- R3a: Esc twice with both inputs live
await group('R3a', async () => {
  const P = await r3page('R3a');
  await goTo(P, 'inbox', {}, 'nav.side .sproj');
  await park(P);
  // the pointer rests inside Home's button, in its padding (no child element under it), so a 2 px move there is a pointermove only
  const hbb = await P.evaluate(sel => {
    const b = document.querySelector(sel);
    const r = b.getBoundingClientRect();
    const c = b.firstElementChild ? b.firstElementChild.getBoundingClientRect() : null;
    return { l: r.left, r: r.right, cy: (r.top + r.bottom) / 2, childL: c ? c.left : null, childR: c ? c.right : null };
  }, ITEMS.Home);
  const px = Math.round(hbb.l) + 3,
    py = Math.round(hbb.cy);
  const underAt = (x, y) =>
    P.evaluate(
      ([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return e ? e.tagName.toLowerCase() + (e.closest('[data-r]') ? '[' + e.closest('[data-r]').dataset.r + ']' : '') : null;
      },
      [x, y],
    );
  await P.mouse.move(px, py, { steps: 4 });
  const sh0 = await waitTip(P);
  const s0 = await tipState(P);
  const tabs = await pressTo(P, 'nav.side .ws');
  await P.keyboard.press('Tab');
  const aB = await act(P);
  const shB = await waitTip(P);
  const sB = await tipState(P);
  const gB = await geomActive(P);
  const pre = {
    homeTipBefore: sh0 ? s0.text : null,
    tabsToWs: tabs,
    focus: aB,
    tipAfterTab: shB ? sB.text : null,
    placedOnFocused: placed(gB, sB),
    pointerAt: [px, py],
    underPointer: await underAt(px, py),
    homeBox: hbb,
  };
  const win = async (action, ms) => {
    await R3.mark(P);
    await action();
    await sleep(ms);
    const rd = await R3.read(P);
    const ak = r3afterKey(rd, 'Escape');
    return {
      frames: rd.frames.length,
      visibleFrames: ak.visibleFrames,
      preKeyVisibleFrames: ak.preKeyVisibleFrames,
      drawn: ak.drawn,
      states: rd.states.map(s => s.s),
      keys: rd.ev.filter(e => e.n === 'keydown').map(e => e.k),
      ...pev(rd),
    };
  };
  const homeHover = () => P.evaluate(sel => document.querySelector(sel).matches(':hover'), ITEMS.Home);
  const e1 = await win(() => P.keyboard.press('Escape'), 800);
  const aE1 = await act(P);
  const hov1 = await homeHover();
  const sE1 = await tipState(P);
  await shot(P, 'R3a-after-esc1.png');
  const e2 = await win(() => P.keyboard.press('Escape'), 800);
  const aE2 = await act(P);
  const hov2 = await homeHover();
  const sE2 = await tipState(P);
  await shot(P, 'R3a-after-esc2.png');
  const m1 = await win(() => P.mouse.move(px + 2, py), 700);
  const under1 = await underAt(px + 2, py);
  const hov3 = await homeHover();
  const m2 = await win(() => P.mouse.move(px + 12, py), 700);
  const under2 = await underAt(px + 12, py);
  const sM2 = await tipState(P);
  await shot(P, 'R3a-after-moves.png');
  await P.mouse.move(900, 720, { steps: 5 });
  await sleep(200);
  const sOff = await tipState(P);
  await P.mouse.move(px, py, { steps: 5 });
  const back = await waitTip(P, 2500);
  const sBk = await tipState(P);
  const gH = await geom(P, ITEMS.Home);
  await shot(P, 'R3a-home-back.png');
  const neg = !(await hasTip(P));
  const preOk = sh0 && s0.text === 'Home' && aB.fv && aB.inSide && aB.tip !== 'Home' && shB && sB.text === aB.tip && pre.placedOnFocused;
  const clean = x => x.visibleFrames === 0 && x.drawn.length === 0 && x.frames >= 20;
  const ok1 = preOk && clean(e1) && !vis(sE1) && e1.keys.includes('Escape'),
    ok2 = preOk && clean(e2) && !vis(sE2) && e2.keys.includes('Escape');
  const ok3 = preOk && clean(m1) && clean(m2) && !vis(sM2) && m1.pointermove >= 1 && m2.pointermove >= 1;
  const ok4 = preOk && !vis(sOff) && back && sBk.text === 'Home' && placed(gH, sBk);
  const ev = {
    pre,
    esc1: { ...e1, focusAfter: aE1, homeHover: hov1, tipHidden: !vis(sE1) },
    esc2: { ...e2, focusAfter: aE2, homeHover: hov2, tipHidden: !vis(sE2) },
    move2pxInPadding: { ...m1, underNewPoint: under1, homeHover: hov3 },
    moveIntoSvg: { ...m2, underNewPoint: under2 },
    offTipHidden: !vis(sOff),
    back: { shown: back, text: sBk.text, placed: placed(gH, sBk) },
    shots: 'R3a-after-esc1.png R3a-after-esc2.png R3a-after-moves.png R3a-home-back.png',
  };
  await chk(
    'R3a',
    `Esc twice, pointer on Home (tip) and keyboard on another item (its tip): after Esc 1 no tip for 800 ms, after Esc 2 none; a real 2 px move on Home (padding only, then into its icon) keeps it dismissed; off and back onto Home shows Home's tip`,
    P,
    async () => ({ pass: ok1 && ok2 && ok3 && ok4, neg, ev }),
  );
  await chk('R3a1', `(R3a part) Esc 1: no tip in any frame or show transition for 800 ms`, P, async () => ({
    pass: ok1,
    neg,
    ev: { pre: { homeTipBefore: pre.homeTipBefore, tipAfterTab: pre.tipAfterTab }, esc1: ev.esc1 },
  }));
  await chk('R3a2', `(R3a part) Esc 2: still no tip for 800 ms`, P, async () => ({ pass: ok2, neg, ev: { esc2: ev.esc2 } }));
  await chk(
    'R3a3',
    `(R3a part) a real 2 px pointer move on Home (padding: pointermove only; then into the icon: pointerover) does not bring Home back`,
    P,
    async () => ({ pass: ok3, neg, ev: { padding: ev.move2pxInPadding, svg: ev.moveIntoSvg } }),
  );
  await chk('R3a4', `(R3a part) pointer off Home and back: Home's tip shows`, P, async () => ({
    pass: ok4,
    neg,
    ev: { offTipHidden: ev.offTipHidden, back: ev.back },
  }));
  await restore(P);
  await done(P);
});

// ---- R3b: jitter after a click (down, 1 px move, up) must not bring the tip back through the render's replays
const R3B_CASES = [
  { label: 'Inbox', sel: 'nav.side .sitem[data-r="inbox"]', from: ['settings', {}], to: 'inbox' },
  { label: 'Home', sel: 'nav.side .sitem[data-r="home"]', from: ['settings', {}], to: 'home' },
  { label: 'Project row', sel: 'nav.side .sproj > .sitem', from: ['settings', {}], to: 'project' },
];
async function r3bCase(P, c, frac) {
  await goTo(P, c.from[0], c.from[1], 'nav.side .sproj');
  await park(P);
  const bb = await bbox(P, c.sel);
  const x = Math.round(bb.cx) + (frac ? 0.5 : 0),
    y = Math.round(bb.cy) + (frac ? 0.25 : 0);
  await P.mouse.move(x, y, { steps: 4 });
  const shown = await waitTip(P);
  const s0 = await tipState(P);
  const want = await P.evaluate(sel => document.querySelector(sel).getAttribute('data-tip'), c.sel);
  await R3.mark(P);
  await P.mouse.down();
  await sleep(40);
  await P.mouse.move(x + 1, y);
  await sleep(40);
  await P.mouse.up();
  await P.waitForFunction(r => window.__pmspace.S.ui.route === r, c.to, { timeout: 4000 });
  await sleep(1100);
  const rd = await R3.read(P);
  const down = rd.ev.find(e => e.n === 'pointerdown'),
    up = rd.ev.find(e => e.n === 'pointerup'),
    click = rd.ev.find(e => e.n === 'click');
  const moves = rd.ev.filter(e => e.n === 'pointermove' && e.t >= down.t && e.t <= up.t);
  const crossings = rd.ev.filter(e => e.n === 'pointerover' && e.t >= down.t && e.t <= click.t);
  const replay = rd.ev.filter(e => e.n === 'pointerover' && e.t > click.t);
  const onItem = await P.evaluate(sel => !!document.querySelector(sel)?.matches(':hover'), c.sel);
  const vis1 = r3vis(rd, down.t),
    drawn1 = r3drawn(rd, down.t);
  await P.mouse.move(900, 720, { steps: 5 });
  await sleep(150);
  const sOff = await tipState(P);
  await P.mouse.move(x, y, { steps: 5 });
  const back = await waitTip(P, 2500);
  const sB = await tipState(P);
  const g = await geom(P, c.sel);
  return {
    label: c.label,
    xy: [x, y],
    tipBefore: shown ? s0.text : null,
    want,
    route: (await route(P)).route,
    navReplaced: rd.navReplaced,
    down: `${down.x},${down.y}`,
    pointermoveBetweenDownAndUp: moves.map(e => `${e.x},${e.y}${e.tr ? '' : '(synthetic)'}`),
    crossingsBeforeClick: crossings.map(e => `${e.tg}@${e.x},${e.y}`),
    replaysAfterClick: {
      count: replay.length,
      trusted: replay.every(e => e.tr),
      atMovePos: replay.every(e => near(e.x, x + 1) && near(e.y, y)),
      events: replay.slice(0, 4).map(e => `${e.tg}@${e.x},${e.y}+${e.t - click.t}ms-after-click`),
    },
    afterDown1s: {
      frames: rd.frames.filter(f => f.t > down.t).length,
      visibleFrames: vis1,
      drawnTransitions: drawn1,
      stateChanges: rd.states.map(s => `${s.s}@${s.t - down.t}`),
    },
    pointerOnItemAfterRender: onItem,
    offTipHidden: !vis(sOff),
    back: { shown: back, text: sB.text, placed: placed(g, sB) },
    ok:
      shown &&
      s0.text === want &&
      rd.navReplaced &&
      moves.length >= 1 &&
      vis1 === 0 &&
      drawn1.length === 0 &&
      replay.length >= 1 &&
      replay.every(e => e.tr) &&
      replay.every(e => near(e.x, x + 1) && near(e.y, y)) &&
      !vis(sOff) &&
      back &&
      sB.text === want &&
      placed(g, sB),
    vacuous: replay.length === 0,
  };
}
await group('R3b', async () => {
  const P = await r3page('R3b');
  const first = await r3bCase(P, R3B_CASES[0], false);
  await shot(P, 'R3b-inbox-end.png');
  const rest = [];
  for (const c of R3B_CASES.slice(1)) rest.push(await r3bCase(P, c, false));
  for (const c of R3B_CASES) rest.push(await r3bCase(P, c, true));
  const neg = !(await hasTip(P));
  await chk(
    'R3b',
    `mouse.down on Inbox, mouse.move 1 px, mouse.up (navigates): no tip in any frame or show transition for 1 s after the press, through the render and Chrome's replayed pointerover; off and back shows the tip`,
    P,
    async () => ({ pass: first.ok, neg, ev: first }),
  );
  await chk(
    'R3b2',
    `(extra) the same press-jitter-release on Home and a project row, and on all three with fractional coordinates (x.5, y.25)`,
    P,
    async () => ({
      pass: rest.length === 5 && rest.every(x => x.ok),
      neg,
      ev: rest.map(x => ({
        item: x.label,
        xy: x.xy,
        ok: x.ok,
        route: x.route,
        navReplaced: x.navReplaced,
        pointermoveBetween: x.pointermoveBetweenDownAndUp,
        replays: x.replaysAfterClick,
        afterDown1s: x.afterDown1s,
        back: x.back,
      })),
    }),
  );
  L.note('R3b', 'vacuity guard: replayed pointerover counts after the click ' + [first, ...rest].map(x => `${x.label}:${x.replaysAfterClick.count}`).join(' '));
  await restore(P);
  await done(P);
});

// ---- R3c: a render that restores the keyboard's focus leaves the mouse's tip alone
await group('R3c', async () => {
  const P = await r3page('R3c');
  await L.suLogin();
  await goTo(P, 'home', {}, 'nav.side .sproj');
  await park(P);
  const BSEL = 'nav.side .sitem[data-r="inbox"]';
  const tabs = await pressTo(P, BSEL);
  const aB = await act(P);
  const shB = await waitTip(P);
  const sB = await tipState(P);
  const hb = await bbox(P, ITEMS.Home);
  const hx = Math.round(hb.cx),
    hy = Math.round(hb.cy);
  await P.mouse.move(hx, hy, { steps: 4 });
  const shH = await waitTip(P);
  await sleep(300);
  const sH = await tipState(P);
  const aH = await act(P);
  const gH = await geom(P, ITEMS.Home);
  const setup = {
    tabsToB: tabs,
    focusB: aB,
    tipB: shB ? sB.text : null,
    tipHomeAfterMouse: shH ? sH.text : null,
    homePlaced: placed(gH, sH),
    focusStillOnB: aH.el === aB.el && aH.fv,
    pointerAt: [hx, hy],
  };
  const setupOk = !!(shB && sB.text === 'Inbox' && aB.fv && shH && sH.text === 'Home' && placed(gH, sH) && setup.focusStillOnB);
  const phase = async trigger => {
    await R3.mark(P);
    await trigger();
    await sleep(900); // longer than the tip's 0.35 s delay + 0.12 s fade, so an animationstart from a restart would show
    const rd = await R3.read(P);
    const a = await act(P);
    const s = await tipState(P);
    const hov = await P.evaluate(sel => !!document.querySelector(sel)?.matches(':hover'), ITEMS.Home);
    const vf = rd.frames.filter(f => f.v),
      cts = vf.map(f => f.ct).filter(c => c !== null);
    const fe = rd.ev.filter(e => e.n === 'focusin' || e.n === 'focusout').map(e => `${e.n}:${e.tg}${e.fv !== undefined ? ':fv=' + e.fv : ''}`);
    const restored = rd.ev.some(e => e.n === 'focusin' && e.tg === 'button[inbox]' && e.fv);
    return {
      navReplaced: rd.navReplaced,
      frames: rd.frames.length,
      hiddenFrames: rd.frames.length - vf.length,
      texts: [...new Set(vf.map(f => f.x))],
      stateChanges: rd.states.map(x => x.s),
      drawnTexts: [...new Set(r3drawn(rd))],
      minOpacity: vf.length ? Math.min(...vf.map(f => f.o)) : null,
      sameAnimObject: vf.length > 0 && vf.every(f => f.same === true),
      ctMonotonic: mono(cts),
      ct: cts.length ? [cts[0], cts[cts.length - 1]] : null,
      animationstart: rd.starts,
      focusEvents: fe.slice(0, 8),
      focusRestoredOnB: restored,
      pointerover: rd.ev
        .filter(e => e.n === 'pointerover')
        .map(e => `${e.tg}@${e.x},${e.y}${e.tr ? '' : '(synthetic)'}`)
        .slice(0, 6),
      focusAfter: { el: a.el, fv: a.fv },
      tipAfter: vis(s) ? s.text : null,
      homeHover: hov,
      simBad: rd.simBad,
    };
  };
  const okPhase = p =>
    setupOk &&
    p.navReplaced &&
    p.focusRestoredOnB &&
    p.frames >= 30 &&
    p.hiddenFrames === 0 &&
    p.texts.length === 1 &&
    p.texts[0] === 'Home' &&
    p.stateChanges.length === 0 &&
    p.minOpacity === 1 &&
    p.sameAnimObject &&
    p.ctMonotonic &&
    p.animationstart === 0 &&
    p.tipAfter === 'Home' &&
    p.homeHover &&
    p.focusAfter.el === aB.el;
  // (1) render() three times
  const p1 = await phase(async () => {
    for (let i = 0; i < 3; i++) {
      await P.evaluate(() => window.__pmspace.render());
      await sleep(150);
    }
  });
  await shot(P, 'R3c-after-render.png');
  // (2) a live PocketBase change that the app renders for (a task title, as RT4 does)
  const tasks = (await L.api('GET', '/collections/tasks/records?perPage=1')).body.items;
  let p2 = null,
    live = { skipped: true };
  if (tasks.length) {
    const tk = tasks[0],
      title0 = tk.doc.title,
      want = title0 + ' (r3c)';
    let seen = false,
      patch = null;
    p2 = await phase(async () => {
      patch = await L.api('PATCH', '/collections/tasks/records/' + tk.id, { doc: { ...tk.doc, title: want } });
      for (let i = 0; i < 30 && !seen; i++) {
        await sleep(200);
        seen = await P.evaluate(([, f]) => JSON.stringify(window.__pmspace.D()).includes(f), [tk.id, want]);
      }
    });
    await L.api('PATCH', '/collections/tasks/records/' + tk.id, { doc: tk.doc });
    live = { patchStatus: patch?.status, appSawChange: seen };
    await shot(P, 'R3c-after-live.png');
  }
  const neg = !(await hasTip(P));
  await chk(
    'R3c1',
    `keyboard on Inbox (tip), real mouse move onto Home (tip Home); window.__pmspace.render() x3 restores Inbox's focus: tip Home in every frame, Inbox's never drawn, Home's animation not restarted`,
    P,
    async () => ({ pass: okPhase(p1), neg, ev: { setup, render: p1 } }),
  );
  await chk(
    'R3c2',
    `same state, then a live PocketBase change the app re-renders for (task title via the API): tip Home throughout, Inbox's never drawn, no animation restart`,
    P,
    async () => ({ pass: !!p2 && okPhase(p2) && live.appSawChange === true, neg, ev: { setup, live, liveEvent: p2 } }),
  );
  await restore(P);
  await done(P);
});

// ---- R3d: the first candidate clipped by .side-scroll falls back to the other input's item
async function r3dScroll(P, A) {
  // steps .side-scroll down in 25 px; the focused item B' is the one that leaves, A (outside the scroll area) stays under the pointer
  return P.evaluate(async A => {
    if (!document.getElementById('rail-tip')) return []; // main: no #rail-tip, nothing to follow
    const s = document.querySelector('.side-scroll'),
      e = document.activeElement,
      box = s.getBoundingClientRect(),
      res = [];
    const a = [...document.querySelectorAll('nav.side [data-tip-pos="right"]')].find(x => x.dataset.tip === A);
    for (let v = 0; v <= s.scrollHeight; v += 25) {
      s.scrollTop = v;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = e.getBoundingClientRect(),
        mid = (r.top + r.bottom) / 2,
        T = document.getElementById('rail-tip'),
        tr = T.getBoundingClientRect(),
        ra = a.getBoundingClientRect();
      const cy = (tr.top + tr.bottom) / 2;
      res.push({
        st: Math.round(s.scrollTop),
        bMid: Math.round(mid),
        bInside: mid >= box.top && mid <= box.bottom,
        shown: !T.hidden,
        text: T.textContent,
        besideB: Math.abs(cy - mid) <= 2,
        besideA: Math.abs(cy - (ra.top + ra.bottom) / 2) <= 2,
      });
      if (s.scrollTop < v - 1) break;
    }
    return res;
  }, A);
}
await group('R3d', async () => {
  const P = await r3page('R3d', 1280, 500);
  await goTo(P, 'home', {}, 'nav.side .sproj');
  await P.evaluate(() => document.activeElement?.blur());
  await P.mouse.move(900, 400);
  await quiet(P);
  const sc = await P.evaluate(() => {
    const s = document.querySelector('.side-scroll');
    const r = s.getBoundingClientRect();
    return {
      scrollHeight: s.scrollHeight,
      clientHeight: s.clientHeight,
      top: r.top,
      bottom: r.bottom,
      scrollTop: s.scrollTop,
      settingsInScroll: !!document.querySelector('nav.side .sitem[data-r="settings"]').closest('.side-scroll'),
    };
  });
  // B = Home (keyboard), A = Settings (pointer; it sits below .side-scroll, so it neither scrolls nor clips), then Tab again: B' = the next stop wins
  const tabsB = await pressTo(P, ITEMS.Home);
  const aB = await act(P);
  await waitTip(P);
  const sbb = await bbox(P, ITEMS.Settings);
  const sx = Math.round(sbb.cx),
    sy = Math.round(sbb.cy);
  await P.mouse.move(sx, sy, { steps: 4 });
  const shA = await waitTip(P);
  const sA = await tipState(P);
  await P.keyboard.press('Tab');
  const aB2 = await act(P);
  const shB2 = await waitTip(P);
  const sB2 = await tipState(P);
  const gB2 = await geomActive(P);
  const pre = {
    sc,
    tabsToHome: tabsB,
    focusB: aB.el,
    pointerOn: 'Settings',
    pointerAt: [sx, sy],
    tipWhilePointerOnly: shA ? sA.text : null,
    focusBprime: aB2,
    tipAfterTab: shB2 ? sB2.text : null,
    placedOnBprime: placed(gB2, sB2),
  };
  const out = await r3dScroll(P, 'Settings');
  const under = await P.evaluate(
    ([x, y]) => {
      const e = document.elementFromPoint(x, y);
      const it = e?.closest('[data-tip-pos="right"]');
      return it ? it.dataset.tip : null;
    },
    [sx, sy],
  );
  const aAfter = await act(P);
  const sEnd = await tipState(P);
  const gS = await geom(P, ITEMS.Settings);
  await shot(P, 'R3d-after-scroll.png', { x: 0, y: 0, width: 320, height: 500 });
  const outside = out.filter(x => !x.bInside),
    inside = out.filter(x => x.bInside);
  const bad = out.filter(x => (x.bInside ? !(x.shown && x.text === aB2.tip && x.besideB) : !(x.shown && x.text === 'Settings' && x.besideA)));
  const neg = !(await hasTip(P));
  await chk(
    'R3d',
    `viewport 1280x500, rail scrolls: Tab to Home, pointer onto Settings (below the scroll area), Tab again (B' wins); scrolling B' out of .side-scroll shows Settings' tip at every step (not hidden), B' tip while it is inside`,
    P,
    async () => ({
      pass:
        sc.scrollHeight > sc.clientHeight + 100 &&
        !sc.settingsInScroll &&
        shA &&
        sA.text === 'Settings' &&
        aB2.fv &&
        aB2.inSide &&
        aB2.tip !== 'Settings' &&
        shB2 &&
        sB2.text === aB2.tip &&
        pre.placedOnBprime &&
        inside.length >= 1 &&
        outside.length >= 3 &&
        bad.length === 0 &&
        under === 'Settings' &&
        aAfter.el === aB2.el &&
        vis(sEnd) &&
        sEnd.text === 'Settings' &&
        placed(gS, sEnd),
      neg,
      ev: {
        pre,
        steps: out.length,
        insideSteps: inside.length,
        outsideSteps: outside.length,
        mismatches: bad.length,
        firstMismatch: bad[0] || null,
        firstOutside: outside[0] || null,
        lastStep: out[out.length - 1],
        underPointerAfter: under,
        focusAfter: aAfter,
        tipEnd: vis(sEnd) ? { text: sEnd.text, placedOnSettings: placed(gS, sEnd) } : null,
        shot: 'R3d-after-scroll.png',
      },
    }),
  );
  // R3d2 (extra): A inside .side-scroll, lower down. A scrolls with the list, so the pointer is no longer on it once the list moves (Chrome re-targets the
  // pointer's hover after the scroll); what is checked is the app's fallback in the frames right after the scroll, before and after that re-target.
  await P.evaluate(() => {
    document.querySelector('.side-scroll').scrollTop = 0;
    document.activeElement?.blur();
  });
  await P.mouse.move(900, 400);
  await quiet(P);
  await sleep(300);
  await pressTo(P, ITEMS.Home);
  const A2 = await P.evaluate(() => {
    const s = document.querySelector('.side-scroll'),
      box = s.getBoundingClientRect();
    const its = [...s.querySelectorAll('[data-tip-pos="right"]')]
      .map(e => {
        const r = e.getBoundingClientRect();
        return { tip: e.dataset.tip, mid: (r.top + r.bottom) / 2, x: (r.left + r.right) / 2 };
      })
      .filter(x => x.mid < box.bottom - 18 && x.mid > box.top + 110);
    return its[its.length - 1] || null;
  });
  let d2 = { skipped: 'no item low enough in view' },
    ok2 = false;
  if (A2 && neg) {
    d2 = { skipped: 'no #rail-tip (main): nothing to follow' };
  } else if (A2) {
    await P.mouse.move(Math.round(A2.x), Math.round(A2.mid), { steps: 4 });
    const shA2 = await waitTip(P);
    const sA2 = await tipState(P);
    await P.keyboard.press('Tab');
    const aK = await act(P);
    const shK = await waitTip(P);
    const sK = await tipState(P);
    const bGeo = await P.evaluate(() => {
      const e = document.activeElement,
        r = e.getBoundingClientRect(),
        box = document.querySelector('.side-scroll').getBoundingClientRect();
      return { mid: (r.top + r.bottom) / 2, boxTop: box.top };
    });
    const delta = Math.ceil(bGeo.mid - bGeo.boxTop) + 14;
    const feasible = A2.mid - delta > bGeo.boxTop + 10;
    if (feasible) {
      await R3.mark(P);
      let after = await P.evaluate(
        async ([delta, aTip, px, py]) => {
          const s = document.querySelector('.side-scroll'),
            e = document.activeElement,
            box = s.getBoundingClientRect(),
            res = [];
          const a = () => [...document.querySelectorAll('nav.side [data-tip-pos="right"]')].find(x => x.dataset.tip === aTip);
          const snap = k => {
            const r = e.getBoundingClientRect(),
              mid = (r.top + r.bottom) / 2,
              T = document.getElementById('rail-tip'),
              tr = T.getBoundingClientRect(),
              tc = (tr.top + tr.bottom) / 2,
              ra = a().getBoundingClientRect();
            const u = document.elementFromPoint(px, py)?.closest('[data-tip-pos="right"]');
            const ru = u ? u.getBoundingClientRect() : null;
            res.push({
              k,
              bClipped: mid < box.top || mid > box.bottom,
              shown: !T.hidden,
              text: T.textContent,
              besideA: Math.abs(tc - (ra.top + ra.bottom) / 2) <= 2,
              underPointer: u ? u.dataset.tip : null,
              besideUnderPointer: ru ? Math.abs(tc - (ru.top + ru.bottom) / 2) <= 2 : null,
            });
          };
          res.t0 = window.__r3.ms();
          s.scrollTop += delta;
          snap('sync');
          for (let i = 0; i < 4; i++) {
            await new Promise(r => requestAnimationFrame(r));
            snap('f' + i);
          }
          await new Promise(r => setTimeout(r, 700));
          snap('after700ms');
          return { samples: res, t0: res.t0 };
        },
        [delta, A2.tip, Math.round(A2.x), Math.round(A2.mid)],
      );
      const rd = await R3.read(P);
      const t0 = after.t0;
      after = after.samples;
      const fr = rd.frames.filter(f => f.t > t0),
        post = after.filter(x => x.k !== 'sync'),
        vf = fr.filter(f => f.v);
      d2 = {
        A: A2,
        tipWithPointerOnly: shA2 ? sA2.text : null,
        bPrime: { focus: aK, tipAfterTab: shK ? sK.text : null },
        scrolledBy: delta,
        note: 'A scrolls with the list, so after the scroll the pointer sits over another item (underPointer); sync = same task as the scrollTop write, before the scroll event/frame',
        samples: after,
        renderedFramesAfterScroll: {
          n: fr.length,
          hidden: fr.length - vf.length,
          texts: [...new Set(vf.map(f => f.x))],
          firstFrames: fr.slice(0, 4).map(f => `${f.t - t0}ms:${f.v ? f.x : 'hidden'}`),
        },
      };
      // criterion: B' is clipped, so from the first frame on the tip is the hovered item's (the one under the pointer now), beside it, never B', never hidden
      ok2 =
        shA2 &&
        sA2.text === A2.tip &&
        shK &&
        sK.text === aK.tip &&
        aK.tip !== A2.tip &&
        after.every(x => x.bClipped) &&
        post.length === 5 &&
        post.every(x => x.shown && x.text === x.underPointer && x.besideUnderPointer && x.text !== aK.tip) &&
        d2.renderedFramesAfterScroll.n >= 20 &&
        d2.renderedFramesAfterScroll.hidden === 0 &&
        !d2.renderedFramesAfterScroll.texts.includes(aK.tip);
    } else d2 = { skipped: 'infeasible geometry', A: A2, bPrime: bGeo, delta };
  }
  await chk(
    'R3d2',
    `(extra) A inside .side-scroll (lower down), B' scrolled out through the top: A moves out from under the pointer, so the fallback tip is that of the item now under it, beside it, from the first frame (never B', never hidden)`,
    P,
    async () => ({ pass: ok2, neg, ev: d2 }),
  );
  await restore(P);
  await done(P);
});

// ---- R3e: Tab back after a click on the page
await group('R3e', async () => {
  const P = await r3page('R3e');
  const per = [];
  for (let [label, sel] of [
    ['Inbox', 'nav.side .sitem[data-r="inbox"]'],
    ['Settings', 'nav.side .sitem[data-r="settings"]'],
    ['Project row', 'nav.side .sproj > .sitem'],
  ]) {
    await goTo(P, 'home', {}, 'nav.side .sproj');
    await P.evaluate(() => document.activeElement?.blur());
    await P.mouse.move(900, 400);
    await quiet(P);
    const tabs = await pressTo(P, sel);
    const a0 = await act(P);
    const rid = await P.evaluate(() => (document.activeElement.matches('.sproj > .sitem') ? document.activeElement.dataset.id : null));
    sel = rid ? `nav.side .sproj > .sitem[data-id="${rid}"]` : sel;
    const sh0 = await waitTip(P);
    const s0 = await tipState(P);
    const spot = await spotOf(P);
    const escWin = async () => {
      await R3.mark(P);
      await P.keyboard.press('Escape');
      await sleep(500);
      const rd = await R3.read(P);
      const ak = r3afterKey(rd, 'Escape');
      return {
        visibleFrames: ak.visibleFrames,
        drawn: ak.drawn,
        frames: ak.framesAfter,
        preKeyVisibleFrames: ak.preKeyVisibleFrames,
        lastVisibleAfterKeyMs: ak.lastVisibleAt,
      };
    };
    const e1 = await escWin();
    const sE = await tipState(P);
    await P.mouse.click(spot.x, spot.y);
    await sleep(250);
    const afterClick = await act(P);
    const sC = await tipState(P);
    const back = await pressTo(P, sel, 'Shift+Tab', 90);
    const a1 = await act(P);
    const sh1 = await waitTip(P);
    const s1 = await tipState(P);
    const g = await geomActive(P);
    await shot(P, `R3e-${label.replace(/\W+/g, '_')}-back.png`, { x: 0, y: 0, width: 320, height: 800 });
    // and forward: Esc again, click the page, Tab round to the item
    const e2 = await escWin();
    const sE2 = await tipState(P);
    await P.mouse.click(spot.x, spot.y);
    await sleep(250);
    const fwd = await pressTo(P, sel, 'Tab', 120);
    const a2 = await act(P);
    const sh2 = await waitTip(P);
    const s2 = await tipState(P);
    const g2 = await geomActive(P);
    per.push({
      label,
      tabsToItem: tabs,
      tipBefore: sh0 ? s0.text : null,
      esc1: e1,
      esc2: e2,
      escHidden: e1.visibleFrames === 0 && e1.drawn.length === 0 && !vis(sE),
      escFrames: e1.frames,
      clickSpot: spot,
      focusAfterClick: afterClick.el,
      tipVisibleAfterClick: vis(sC),
      shiftTabPresses: back,
      returned: a1.el,
      fv: a1.fv,
      tipOnReturn: sh1 ? s1.text : null,
      placed: placed(g, s1),
      fwd: {
        escHidden: e2.visibleFrames === 0 && e2.drawn.length === 0 && !vis(sE2),
        tabPresses: fwd,
        returned: a2.el,
        fv: a2.fv,
        tipOnReturn: sh2 ? s2.text : null,
        placed: placed(g2, s2),
      },
      ok:
        tabs > 0 &&
        sh0 &&
        s0.text === a0.tip &&
        e1.visibleFrames === 0 &&
        e1.drawn.length === 0 &&
        !vis(sE) &&
        !vis(sC) &&
        back > 0 &&
        a1.fv &&
        sh1 &&
        s1.text === a1.tip &&
        placed(g, s1),
      okFwd: e2.visibleFrames === 0 && e2.drawn.length === 0 && !vis(sE2) && fwd > 0 && a2.fv && sh2 && s2.text === a2.tip && placed(g2, s2),
    });
  }
  const neg = !(await hasTip(P));
  await chk(
    'R3e',
    `Tab to a rail item (tip), Esc (hidden), click the empty content area (focus leaves the rail), Shift+Tab back to the item: its tip shows (Inbox, Settings, a project row); and forward with Tab after a second Esc and click (extra)`,
    P,
    async () => ({ pass: per.length === 3 && per.every(x => x.ok && x.okFwd), neg, ev: per }),
  );
  await restore(P);
  await done(P);
});

await b.close();
// C1
await L.check('C1', `no console errors or page errors in any run (${allErrs.length})`, { errs: allErrs }, async () => ({
  pass: allErrs.length === 0,
  ev: { count: allErrs.length, first: allErrs.slice(0, 5) },
}));
// ---- totals from the results file
const recs = fs
  .readFileSync(RES, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l))
  .filter(r => !r.note);
const pass = recs.filter(r => r.pass),
  fail = recs.filter(r => !r.pass);
console.log(`TOTAL ${recs.length} checks: ${pass.length} PASS, ${fail.length} FAIL (build ${BUILD})`);
console.log('PASS: ' + pass.map(r => r.id).join(' '));
console.log('FAIL: ' + fail.map(r => r.id).join(' '));
console.log(
  'NEG (main symptom observed): ' +
    recs
      .filter(r => r.ev && r.ev.NEG === true)
      .map(r => r.id)
      .join(' '),
);
console.log('console errors: ' + allErrs.length);
