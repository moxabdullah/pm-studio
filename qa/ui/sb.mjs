// Sidebar names suite (a11y of the collapsed 52 px rail). Each check passes when the FIXED behaviour holds, so on main the bug checks fail.
// N0 collapse through the real UI; N1 every Tab stop in the rail has an accessible name (CDP, the browser's own computation); N1b the name is
// the tooltip (data-tip), the workspace switcher is "Switch workspace"; N2/N3 expanded sidebar and phone drawer (saved; compared with sb-main's
// when this suite runs against another PM_OUT that has a sibling "sb-main" folder); S1 Settings' own nav is unaffected by the rail (names,
// boxes, pixel-identical collapsed vs expanded); D1 the design-system sample sidebar likewise; P1 rail screenshot; P2 Profile avatar shows;
// P3 a project icon click opens the project; T1 tooltip on hover and keyboard focus; K1 Tab + Enter on a project row opens it;
// K2 focus on a project's icon (expanded sidebar, by Tab) and "[": the rail leaves focus on that project's row, not on <body> (render()'s fallback
// to the closest [data-a] ancestor); K3 focus on "Collapse sidebar" and "[": focus is on "Expand sidebar".
// Only PM_BASE and PM_OUT are read (lib.mjs). Everything is written under PM_OUT. Needs the scratch PocketBase on PM_PB (login only).
import * as L from '../lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rawRgba } from '../lib/png.mjs';
const { sleep, check, note, OUT } = L;
const RES = OUT + '/results.jsonl';
fs.writeFileSync(RES, '');
const REF =
  [path.join(path.dirname(OUT), 'sb-main'), path.join(OUT, 'sb-main')].find(d => path.basename(OUT) !== 'sb-main' && fs.existsSync(path.join(d, 'N2.json'))) ||
  null; // main's run: a sibling of PM_OUT, or a sb-main folder inside it
note('SETUP', `base=${L.BASE} out=${OUT} ref=${REF || 'none (this is the reference run)'}`);
const W = (f, o) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(o, null, 1));
const R = f => JSON.parse(fs.readFileSync(path.join(REF, f), 'utf8'));
const sha = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
const b = await L.launch();
const group = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    await check('ERR-' + name, `group ${name} crashed`, { errs: [] }, async () => ({
      pass: false,
      ev: String(e.stack || e)
        .split('\n')
        .slice(0, 3)
        .join(' | ')
        .slice(0, 400),
    }));
  }
};

// ---- helpers
async function mk(w, h, tag) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await L.open(ctx, tag);
  await L.login(page, 'hello@example.com');
  await page.waitForSelector('nav.side .sproj', { state: 'attached', timeout: 15000 });
  page.ctx = ctx;
  return page;
}
const isCol = p => p.evaluate(() => document.querySelector('.shell')?.classList.contains('collapsed'));
// the collapsed state is a saved preference (it is written to the user's prefs), so it is set explicitly each time and put back at the end
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
  await page.mouse.move(900, 700);
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
    if (left.length) note('RESTORE', 'pending after restore: ' + JSON.stringify(left).slice(0, 200));
  } catch (e) {
    note('RESTORE', 'failed: ' + String(e).split('\n')[0]);
  }
}

// Tag the elements (a data-qa-i attribute), ask Chromium's accessibility tree for each one's role and name, optionally walk the real Tab order.
// mode 'tab': the tabbable, visible elements under rootSel; mode 'all': every element matching rootSel (visible or not)
async function axList(page, rootSel, mode = 'tab', { walk = true } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const items = await page.evaluate(
    ([rootSel, mode]) => {
      const vis = e => e.checkVisibility({ checkVisibilityCSS: true }) && (r => r.width > 0 && r.height > 0)(e.getBoundingClientRect());
      const sig = e => {
        const cls = [...e.classList]
          .filter(c => !['on', 'open', 'active'].includes(c))
          .map(c => '.' + c)
          .join('');
        const at = ['data-a', 'data-r', 'data-id', 'data-sec', 'data-pop', 'data-tab']
          .filter(a => e.hasAttribute(a))
          .map(a => `[${a}="${e.getAttribute(a)}"]`)
          .join('');
        return e.tagName.toLowerCase() + cls + at;
      };
      const path = e => {
        const out = [];
        for (let n = e; n && n.tagName !== 'BODY'; n = n.parentElement) {
          const i = [...n.parentElement.children].indexOf(n) + 1;
          out.unshift(`${sig(n)}:nth-child(${i})`);
          if (n.matches('nav.side')) break;
        }
        return out.join(' > ');
      };
      let els;
      if (mode === 'tab') {
        const root = document.querySelector(rootSel);
        const sel = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]:not([contenteditable="false"])';
        els = [...root.querySelectorAll(sel)].filter(e => !e.matches(':disabled') && e.tabIndex >= 0 && !e.closest('[inert]') && vis(e));
      } else els = [...document.querySelectorAll(rootSel)];
      return els.map((e, i) => {
        e.setAttribute('data-qa-i', i);
        let s = (mode === 'tab' ? 'nav.side ' : '') + sig(e);
        if (document.querySelectorAll(s).length !== 1) s = path(e);
        const r = e.getBoundingClientRect();
        return {
          idx: i,
          tag: e.tagName.toLowerCase(),
          selector: s,
          dataTip: e.getAttribute('data-tip'),
          ariaLabel: e.getAttribute('aria-label'),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          visible: vis(e),
        };
      });
    },
    [rootSel, mode],
  );
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  for (const it of items) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-qa-i="${it.idx}"]` });
    const { node } = await cdp.send('DOM.describeNode', { nodeId });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = nodes.find(x => x.backendDOMNodeId === node.backendNodeId) || nodes[0];
    it.role = n?.role?.value ?? null;
    it.ignored = !!n?.ignored;
    it.name = (n?.name?.value ?? '').toString();
    const src = (n?.name?.sources || []).find(s => s.value?.value && !s.superseded);
    it.nameFrom = src ? src.type + (src.attribute ? ':' + src.attribute : '') : null;
  }
  let walkInfo = null;
  if (walk && mode === 'tab' && items.length) {
    await page.evaluate(() => document.querySelector('[data-qa-i="0"]').focus());
    const seq = [0];
    for (let k = 1; k < items.length; k++) {
      await page.keyboard.press('Tab');
      seq.push(
        await page.evaluate(() => {
          const a = document.activeElement;
          return a?.hasAttribute?.('data-qa-i') ? +a.getAttribute('data-qa-i') : -1;
        }),
      );
    }
    await page.keyboard.press('Tab');
    const next = await page.evaluate(
      ([rootSel]) => {
        const a = document.activeElement;
        const root = document.querySelector(rootSel);
        return { inRoot: !!root?.contains(a), tag: a?.tagName, cls: a?.className?.toString().slice(0, 40) };
      },
      [rootSel],
    );
    walkInfo = { sameOrder: seq.every((v, i) => v === i), seq: seq.join(','), nextLeavesRoot: !next.inRoot, next };
  }
  await page.evaluate(() => document.querySelectorAll('[data-qa-i]').forEach(e => e.removeAttribute('data-qa-i')));
  await cdp.detach();
  return { items, walkInfo };
}
const slim = items => items.map(i => ({ role: i.role, name: i.name, dataTip: i.dataTip, selector: i.selector }));
const norm = s =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const firstDiff = (a, c) => {
  if (a.length !== c.length) return `count ${c.length} vs ref ${a.length}`;
  for (let i = 0; i < a.length; i++) if (JSON.stringify(a[i]) !== JSON.stringify(c[i])) return `#${i} ${JSON.stringify(c[i])} vs ref ${JSON.stringify(a[i])}`;
  return null;
};
async function pixelDiff(fileA, fileB) {
  const [a, c] = await Promise.all([rawRgba(fileA), rawRgba(fileB)]);
  if (a.info.width !== c.info.width || a.info.height !== c.info.height)
    return { sameSize: false, a: [a.info.width, a.info.height], b: [c.info.width, c.info.height] };
  let n = 0,
    x0 = 1e9,
    y0 = 1e9,
    x1 = -1,
    y1 = -1;
  const w = a.info.width;
  for (let i = 0; i < a.data.length; i += 4)
    if (a.data[i] !== c.data[i] || a.data[i + 1] !== c.data[i + 1] || a.data[i + 2] !== c.data[i + 2] || a.data[i + 3] !== c.data[i + 3]) {
      n++;
      const p = i / 4,
        x = p % w,
        y = (p / w) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  return { sameSize: true, size: [w, a.info.height], diffPixels: n, bbox: n ? [x0, y0, x1, y1] : null };
}

// ================= group A: 1280 x 800 -- N2 (expanded), N0 (collapse), N1, N1b, P1, P2
await group('A', async () => {
  const A = await mk(1280, 800, 'A');
  const start = await isCol(A);
  note('A', `state at login: collapsed=${start}; viewport 1280x800`);
  await setCollapsed(A, false, 'button');
  await park(A);
  // N2: expanded sidebar
  const n2 = await axList(A, 'nav.side');
  W('N2.json', slim(n2.items));
  W('N2.detail.json', n2);
  await check('N2', `expanded 1280: the Tab stops of nav.side with role and computed name saved (N2.json, ${n2.items.length} stops)`, A, async () => {
    const empty = n2.items.filter(i => !i.name.trim()).length;
    if (REF) {
      const d = firstDiff(R('N2.json'), slim(n2.items));
      return { pass: !d, ev: d ? 'differs from sb-main: ' + d : `identical to sb-main's N2.json (${n2.items.length} stops)` };
    }
    return { pass: n2.items.length > 0, ev: `${n2.items.length} stops, ${empty} with an empty name, tab walk ${JSON.stringify(n2.walkInfo)}` };
  });
  // N0: collapse by the real "Collapse sidebar" button
  await check('N0', `the "Collapse sidebar" button puts .shell.collapsed on and the sidebar at the rail width`, A, async () => {
    const btn = await A.locator('nav.side [data-a="toggleSide"]:visible').first().getAttribute('aria-label');
    const r = await setCollapsed(A, true, 'button');
    await park(A);
    const w = await A.evaluate(() => ({
      cls: document.querySelector('.shell').className,
      width: Math.round(document.querySelector('nav.side').getBoundingClientRect().width),
      uiCollapsed: window.__pmspace.S.ui.collapsed,
    }));
    return { pass: r.changed && w.cls.split(/\s+/).includes('collapsed') && w.width < 70 && w.uiCollapsed === true, ev: { button: btn, ...w } };
  });
  // N1: every Tab stop in the rail has a name
  const n1 = await axList(A, 'nav.side');
  W('N1.json', slim(n1.items));
  W('N1.detail.json', n1);
  const empties = n1.items.filter(i => !i.name.trim());
  note(
    'N1',
    `${n1.items.length} Tab stops in nav.side (rail), ${empties.length} with an empty accessible name; empty dataTips: ${JSON.stringify(empties.map(e => e.dataTip))}; tab walk ${JSON.stringify(n1.walkInfo)}`,
  );
  await check('N1', `collapsed rail 1280: every Tab stop in nav.side has a non-empty accessible name (CDP AX tree)`, A, async () => ({
    pass: n1.items.length > 0 && empties.length === 0,
    ev: {
      stops: n1.items.length,
      empty: empties.length,
      emptyDataTips: empties.map(e => e.dataTip),
      emptyRoles: [...new Set(empties.map(e => e.role))],
      tabWalkSameOrder: n1.walkInfo?.sameOrder,
    },
  }));
  // N1b
  await check('N1b', `collapsed rail: for every stop with data-tip the computed name equals the data-tip; button.ws is "Switch workspace"`, A, async () => {
    const tipped = n1.items.filter(i => i.dataTip != null);
    const bad = tipped.filter(i => norm(i.name) !== norm(i.dataTip));
    const ws = n1.items.find(i => i.selector.includes('.ws'));
    const wsOk = !!ws && ws.name === 'Switch workspace';
    return {
      pass: tipped.length > 0 && bad.length === 0 && wsOk,
      ev: {
        tipped: tipped.length,
        mismatched: bad.length,
        mismatches: bad.slice(0, 12).map(i => ({ dataTip: i.dataTip, name: i.name, role: i.role, from: i.nameFrom })),
        ws: ws && ws.name,
      },
    };
  });
  // P1: the rail
  await park(A);
  const rail = await A.locator('nav.side').screenshot({ path: path.join(OUT, 'P1-rail.png'), animations: 'disabled' });
  const prof = await A.evaluate(() => {
    const r = document.querySelector('nav.side .side-bot [data-pop="user"]').getBoundingClientRect(),
      n = document.querySelector('nav.side').getBoundingClientRect();
    return { btn: [r.x - n.x, r.y - n.y, r.width, r.height], nav: [n.x, n.y, n.width, n.height] };
  });
  W('P1.json', { sha: sha(rail), profileBtnInRailPx: prof.btn, nav: prof.nav });
  await check('P1', `rail screenshot P1-rail.png saved${REF ? ' and compared with sb-main (only the Profile button may differ)' : ''}`, A, async () => {
    if (!REF) return { pass: true, ev: { sha: sha(rail), size: prof.nav.slice(2) } };
    const d = await pixelDiff(path.join(REF, 'P1-rail.png'), path.join(OUT, 'P1-rail.png'));
    if (!d.sameSize) return { pass: false, ev: d };
    const [px, py, pw, ph] = prof.btn;
    const [x0, y0, x1, y1] = d.bbox || [0, 0, -1, -1];
    const inside = !d.diffPixels || (x0 >= Math.floor(px) && x1 <= Math.ceil(px + pw) && y0 >= Math.floor(py) && y1 <= Math.ceil(py + ph));
    return { pass: inside, ev: { diffPixels: d.diffPixels, bbox: d.bbox, profileBtn: prof.btn.map(Math.round) } };
  });
  // P2: the Profile avatar
  await check('P2', `rail: the Profile button's span.av has a non-zero, visible box (screenshot P2-profile.png)`, A, async () => {
    const m = await A.evaluate(() => {
      const btn = document.querySelector('nav.side .side-bot [data-pop="user"]');
      const av = btn.querySelector('span.av');
      if (!av) return { present: false };
      const cs = getComputedStyle(av),
        r = av.getBoundingClientRect(),
        br = btn.getBoundingClientRect();
      return {
        present: true,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        btnRect: [Math.round(br.x), Math.round(br.y), Math.round(br.width), Math.round(br.height)],
        text: av.textContent,
        kids: [...btn.children].map(c => c.className + ':' + getComputedStyle(c).display),
      };
    });
    await park(A);
    const bb = m.btnRect || [0, 0, 52, 36];
    await A.screenshot({
      path: path.join(OUT, 'P2-profile.png'),
      clip: { x: Math.max(0, bb[0] - 8), y: Math.max(0, bb[1] - 8), width: 52 + 16, height: bb[3] + 16 },
    });
    const inside = m.present && m.rect[0] >= m.btnRect[0] && m.rect[0] + m.rect[2] <= m.btnRect[0] + m.btnRect[2];
    return { pass: m.present && m.display !== 'none' && m.visibility === 'visible' && +m.opacity > 0 && m.rect[2] > 0 && m.rect[3] > 0 && inside, ev: m };
  });
  await restore(A);
  await A.ctx.close();
});

// ================= group B: phone drawer, 390 x 844 -- N3
await group('B', async () => {
  const B = await mk(390, 844, 'B');
  if (await isCol(B)) note('B', 'collapsed was on at login (a saved preference); the drawer is never the rail');
  await B.click('#mnav-btn');
  await B.waitForSelector('.shell.mnav', { timeout: 5000 });
  await B.waitForFunction(
    () => {
      const s = document.querySelector('nav.side'),
        r = s.getBoundingClientRect();
      return getComputedStyle(s).visibility === 'visible' && r.left >= 0 && r.width > 200;
    },
    null,
    { timeout: 5000 },
  );
  await quiet(B);
  const n3 = await axList(B, 'nav.side');
  W('N3.json', slim(n3.items));
  W('N3.detail.json', n3);
  await check(
    'N3',
    `phone drawer open (390x844 via #mnav-btn): the Tab stops of nav.side with role and computed name saved (N3.json, ${n3.items.length} stops)`,
    B,
    async () => {
      const empty = n3.items.filter(i => !i.name.trim()).length;
      if (REF) {
        const d = firstDiff(R('N3.json'), slim(n3.items));
        return { pass: !d, ev: d ? 'differs from sb-main: ' + d : `identical to sb-main's N3.json (${n3.items.length} stops)` };
      }
      return {
        pass: n3.items.length > 0,
        ev: `${n3.items.length} stops, ${empty} with an empty name, tab walk ${JSON.stringify(n3.walkInfo)}, shell class "${await B.evaluate(() => document.querySelector('.shell').className.replace(/\s+/g, ' ').trim())}"`,
      };
    },
  );
  await B.ctx.close();
});

// ================= group C: Settings (S1) and the design-system page (D1), 1280 x 800; the rail is collapsed with the "[" key
await group('C', async () => {
  const C = await mk(1280, 800, 'C');
  await setCollapsed(C, false, 'button');
  const k = await setCollapsed(C, true, 'key');
  note('C', `collapsed with the "[" key: ${JSON.stringify(k)}, .shell.collapsed=${await isCol(C)}`);
  const labelState = sel =>
    C.evaluate(
      sel =>
        [...document.querySelectorAll(sel)].map(it => ({
          item: (it.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28),
          spans: [...it.children]
            .filter(c => c.tagName === 'SPAN')
            .map(c => {
              const r = c.getBoundingClientRect();
              return {
                cls: c.className,
                text: (c.textContent || '').trim().slice(0, 20),
                display: getComputedStyle(c).display,
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            }),
        })),
      sel,
    );
  const isLabel = s => !/\b(pico|ct|sdot|fav|hov|chev|dotc)\b/.test(s.cls);
  // --- S1
  await goTo(C, 'settings', { sec: 'appearance' }, '.set-nav .sitem');
  await park(C);
  const colItems = await labelState('.set-nav .sitem');
  const colNames = await axList(C, '.set-nav .sitem', 'all');
  await C.locator('.set-nav').screenshot({ path: path.join(OUT, 'S1-collapsed.png'), animations: 'disabled' });
  await setCollapsed(C, false, 'key');
  await goTo(C, 'settings', { sec: 'appearance' }, '.set-nav .sitem');
  await park(C);
  const expItems = await labelState('.set-nav .sitem');
  await C.locator('.set-nav').screenshot({ path: path.join(OUT, 'S1-expanded.png'), animations: 'disabled' });
  const px = await pixelDiff(path.join(OUT, 'S1-collapsed.png'), path.join(OUT, 'S1-expanded.png'));
  const hidden = colItems.filter(i => !i.spans.filter(isLabel).length || i.spans.filter(isLabel).some(s => s.w === 0 || s.h === 0 || s.display === 'none'));
  const emptyN = colNames.items.filter(i => !i.name.trim());
  const expHidden = expItems.filter(i => i.spans.filter(isLabel).some(s => s.w === 0 || s.h === 0 || s.display === 'none'));
  W('S1.json', { collapsed: colItems, expandedHidden: expHidden.length, names: slim(colNames.items), px });
  await check(
    'S1',
    `Settings with the rail collapsed: every .set-nav .sitem label span visible and named; .set-nav pixel-identical to the expanded-sidebar one`,
    C,
    async () => ({
      pass: colItems.length > 0 && hidden.length === 0 && emptyN.length === 0 && px.sameSize && px.diffPixels === 0,
      ev: {
        items: colItems.length,
        labelsHiddenInRail: hidden.length,
        firstHidden: hidden.slice(0, 2).map(h => h.item),
        emptyNames: emptyN.length,
        emptyNameFirst: emptyN.slice(0, 3).map(e => e.selector),
        expandedControlHidden: expHidden.length,
        pixel: px,
      },
    }),
  );
  // --- D1
  await goTo(C, 'system', {}, '.content .side .sitem');
  await park(C);
  const dExp = await labelState('.content .side .sitem');
  await setCollapsed(C, true, 'key');
  await goTo(C, 'system', {}, '.content .side .sitem');
  await park(C);
  const dCol = await labelState('.content .side .sitem');
  await C.locator('.content .side')
    .first()
    .screenshot({ path: path.join(OUT, 'D1-collapsed.png'), animations: 'disabled' });
  const hiddenLabels = dCol.flatMap(i =>
    i.spans
      .filter(isLabel)
      .filter(s => s.w === 0 || s.h === 0 || s.display === 'none')
      .map(s => s.text),
  );
  const nLabels = dCol.reduce((n, i) => n + i.spans.filter(isLabel).length, 0),
    nLabelsExp = dExp.reduce((n, i) => n + i.spans.filter(isLabel).length, 0);
  const extra = dCol.flatMap(i => i.spans.filter(s => !isLabel(s)).map(s => `${s.cls.split(' ')[0]}:${s.display}`));
  await check('D1', `design-system page with the rail collapsed: the sample sidebar's labels are visible`, C, async () => ({
    pass: nLabels >= 4 && hiddenLabels.length === 0,
    ev: {
      sampleItems: dCol.length,
      labelSpans: nLabels,
      labelSpansExpandedControl: nLabelsExp,
      hiddenLabels,
      nonLabelSpansDisplay: extra.join(' '),
      shot: 'D1-collapsed.png',
    },
  }));
  await restore(C);
  await C.ctx.close();
});

// ================= group D: P3, a click on a project icon in the rail
await group('D', async () => {
  const D = await mk(1280, 800, 'D');
  await setCollapsed(D, true, 'button');
  await park(D);
  const row = D.locator('nav.side .sproj .sitem[data-drag-proj]').first();
  const pid = await row.getAttribute('data-drag-proj');
  const pico = row.locator('span.pico');
  const bb = await pico.boundingBox();
  const cx = bb.x + bb.width / 2,
    cy = bb.y + bb.height / 2;
  const hit = await D.evaluate(
    ([x, y]) => {
      const e = document.elementFromPoint(x, y);
      const a = e?.closest('[data-a]');
      return {
        el: e?.tagName.toLowerCase() + '.' + (e?.className?.baseVal ?? e?.className),
        act: a?.dataset.a,
        actEl: a?.tagName.toLowerCase() + '.' + a?.className,
      };
    },
    [cx, cy],
  );
  const before = await route(D);
  await D.mouse.click(cx, cy);
  let routed = true;
  await D.waitForFunction(() => window.__pmspace.S.ui.route === 'project', null, { timeout: 2500 }).catch(() => {
    routed = false;
  });
  await quiet(D);
  const after = await route(D);
  await D.screenshot({ path: path.join(OUT, 'P3-after.png') });
  note(
    'P3',
    `project ${pid}: click at (${Math.round(cx)},${Math.round(cy)}) hit ${JSON.stringify(hit)}; before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );
  await check('P3', `rail: a click on a project row's span.pico opens the project (S.ui.route==='project' with params.id)`, D, async () => ({
    pass: after.route === 'project' && after.params.id === pid,
    ev: {
      projectId: pid,
      hit: hit.act + ' on ' + hit.actEl,
      routeBefore: before.route,
      routeAfter: after.route,
      paramsAfter: after.params,
      expandedBefore: before.expanded[pid] ?? false,
      expandedAfter: after.expanded[pid] ?? false,
      routedWithin2_5s: routed,
    },
  }));
  await restore(D);
  await D.ctx.close();
});

// ================= group E: tooltip (T1) and keyboard (K1), 1280 x 800, rail collapsed
await group('E', async () => {
  const E = await mk(1280, 800, 'E');
  await setCollapsed(E, true, 'button');
  await park(E);
  // The tip is #rail-tip (a fixed element in body) once the fix is in; on older builds it is the item's ::after. near: the floating tip sits right of the item, centred on it.
  const tip = sel =>
    E.evaluate(sel => {
      const e = document.querySelector(sel);
      const ft = document.getElementById('rail-tip');
      if (ft) {
        const r = e.getBoundingClientRect(),
          t = ft.getBoundingClientRect(),
          cs = getComputedStyle(ft);
        return {
          floating: true,
          content: ft.hidden ? 'none' : JSON.stringify(ft.textContent),
          opacity: ft.hidden ? '0' : cs.opacity,
          display: cs.display,
          near: !ft.hidden && t.left >= r.right && t.left <= r.right + 16 && Math.abs((t.top + t.bottom) / 2 - (r.top + r.bottom) / 2) <= 2,
          focusVisible: e.matches(':focus-visible'),
          hover: e.matches(':hover'),
        };
      }
      const cs = getComputedStyle(e, '::after');
      return {
        floating: false,
        content: cs.content,
        opacity: cs.opacity,
        display: cs.display,
        focusVisible: e.matches(':focus-visible'),
        hover: e.matches(':hover'),
      };
    }, sel);
  const tipOn = sel => {
    const ft = document.getElementById('rail-tip');
    return ft ? !ft.hidden && getComputedStyle(ft).opacity === '1' : getComputedStyle(document.querySelector(sel), '::after').opacity === '1';
  };
  const unq = c => String(c).replace(/^["']|["']$/g, '');
  const HOME = 'nav.side .sitem[data-r="home"]';
  // hover
  await E.hover(HOME);
  await E.waitForFunction(tipOn, HOME, { timeout: 3000 }).catch(() => {});
  const th = await tip(HOME);
  await E.screenshot({ path: path.join(OUT, 'T1-hover.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  // keyboard focus: mouse parked, Tab from the start of the page until Home has focus
  await E.mouse.move(900, 700);
  await E.evaluate(() => document.activeElement?.blur());
  let tabs = 0;
  let onHome = false;
  for (; tabs < 12 && !onHome; tabs++) {
    await E.keyboard.press('Tab');
    onHome = await E.evaluate(sel => document.activeElement === document.querySelector(sel), HOME);
  }
  await E.waitForFunction(tipOn, HOME, { timeout: 3000 }).catch(() => {});
  const tf = await tip(HOME);
  await E.screenshot({ path: path.join(OUT, 'T1-focus.png'), clip: { x: 0, y: 0, width: 320, height: 300 } });
  // informational: every tipped rail stop on keyboard focus
  const all = await E.evaluate(async () => {
    const out = [];
    const els = [...document.querySelectorAll('nav.side [data-tip]')].filter(e => e.checkVisibility({ checkVisibilityCSS: true }) && e.tabIndex >= 0);
    for (const e of els) {
      e.focus({ focusVisible: true });
      await new Promise(r => requestAnimationFrame(r));
      const ft = document.getElementById('rail-tip');
      const c = ft ? (ft.hidden ? 'none' : JSON.stringify(ft.textContent)) : getComputedStyle(e, '::after').content;
      out.push([e.getAttribute('data-tip'), c, e.matches(':focus-visible')]);
    }
    return out;
  });
  const allOk = all.filter(([t, c, fv]) => fv && unq(c) === t).length;
  await check('T1', `rail: Home shows its tooltip ("Home") on hover and on keyboard focus-visible`, E, async () => ({
    pass:
      (!th.floating || (th.near && tf.near)) &&
      unq(th.content) === 'Home' &&
      th.opacity === '1' &&
      onHome &&
      tf.focusVisible &&
      unq(tf.content) === 'Home' &&
      tf.opacity === '1',
    ev: { hover: th, focus: tf, tabsToHome: tabs, allTippedStopsOnFocus: `${allOk}/${all.length}`, shots: 'T1-hover.png T1-focus.png' },
  }));
  // X1 (extra, not in the brief): the tooltip is actually painted. The strip just right of the rail is compared with and without the hover.
  {
    await E.mouse.move(900, 700);
    await E.evaluate(() => {
      document.activeElement?.blur();
      document.querySelector('.side-scroll').scrollTop = 0;
    });
    await quiet(E); // sbx: the focus loop above scrolled the rail, so Home was off-screen at y=-76
    const r = await E.locator(HOME).boundingBox(),
      rail = await E.evaluate(() => document.querySelector('nav.side').getBoundingClientRect().width);
    const clip = { x: Math.ceil(rail), y: Math.max(0, Math.floor(r.y - 12)), width: 140, height: Math.ceil(r.height + 24) };
    const off = await E.screenshot({ clip });
    await E.hover(HOME);
    await E.waitForFunction(tipOn, HOME, { timeout: 3000 }).catch(() => {});
    const on = await E.screenshot({ clip });
    fs.writeFileSync(path.join(OUT, 'X1-off.png'), off);
    fs.writeFileSync(path.join(OUT, 'X1-on.png'), on);
    const d = await pixelDiff(path.join(OUT, 'X1-off.png'), path.join(OUT, 'X1-on.png'));
    const css = await E.evaluate(() => ({
      nav: getComputedStyle(document.querySelector('nav.side')).overflowX,
      scroll: getComputedStyle(document.querySelector('.side-scroll')).overflowX,
    }));
    await check('X1', `(extra) rail: Home's tooltip is painted outside the rail (pixels change in the strip right of it on hover)`, E, async () => ({
      pass: !!d.sameSize && d.diffPixels > 50,
      ev: { diffPixels: d.diffPixels, bbox: d.bbox, overflowX: css, shots: 'X1-off.png X1-on.png' },
    }));
    await E.mouse.move(900, 700);
  }
  // K1
  await E.goto(L.BASE + '/');
  await E.waitForSelector('nav.side .sproj', { state: 'attached', timeout: 15000 });
  await quiet(E);
  await setCollapsed(E, true, 'button');
  await park(E);
  const walk = [];
  let focusedId = null;
  for (let i = 0; i < 40; i++) {
    await E.keyboard.press('Tab');
    const f = await E.evaluate(() => {
      const a = document.activeElement;
      return {
        id: a?.dataset?.dragProj || null,
        desc: (a?.tagName || '').toLowerCase() + '.' + String(a?.className || '').split(' ')[0] + (a?.dataset?.r ? '[' + a.dataset.r + ']' : ''),
      };
    });
    walk.push(f.desc);
    if (f.id) {
      focusedId = f.id;
      break;
    }
  }
  let opened = false,
    r1 = null;
  if (focusedId) {
    await E.keyboard.press('Enter');
    opened = await E.waitForFunction(id => window.__pmspace.S.ui.route === 'project' && window.__pmspace.S.ui.params.id === id, focusedId, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    r1 = await route(E);
  }
  await check('K1', `Tab into the rail and press Enter on a project row: the project opens`, E, async () => ({
    pass: !!focusedId && opened,
    ev: { focusedProject: focusedId, tabStops: walk.length, walk: walk.join(' '), route: r1 && r1.route, params: r1 && r1.params },
  }));
  await restore(E);
  await E.ctx.close();
});

// ================= group F: focus across the collapse, 1280 x 800, expanded sidebar -- K2 (a project's icon), K3 (the "Collapse sidebar" button)
await group('F', async () => {
  const F = await mk(1280, 800, 'F');
  await setCollapsed(F, false, 'button');
  await park(F);
  // what has focus, in the terms of the brief: tag, classes, data-*, plus where it sits
  const focusInfo = () =>
    F.evaluate(() => {
      const a = document.activeElement;
      if (!a) return { el: null };
      const row = a.closest?.('.sitem[data-r="project"]');
      return {
        el: a === document.body ? 'body' : a.tagName.toLowerCase(),
        cls:
          a === document.body
            ? ''
            : String(a.className || '')
                .replace(/\s+/g, ' ')
                .trim(),
        data: { ...(a.dataset || {}) },
        role: a.getAttribute?.('role') || null,
        ariaLabel: a.getAttribute?.('aria-label') || null,
        inRail: !!a.closest?.('nav.side'),
        isProjectRow: !!a.matches?.('div.sitem[data-a="go"][data-r="project"]'),
        rowId: row?.dataset.id || null,
        focusVisible: !!a.matches?.(':focus-visible'),
      };
    });
  const tabUntil = async (sel, max = 60) => {
    let n = 0;
    for (; n < max; n++) {
      await F.keyboard.press('Tab');
      if (await F.evaluate(s => !!document.activeElement?.matches?.(s), sel)) return n + 1;
    }
    return -1;
  };
  const afterCollapse = async () => {
    await F.waitForFunction(() => document.querySelector('.shell').classList.contains('collapsed'), null, { timeout: 5000 }).catch(() => {});
    await F.waitForFunction(
      () => {
        const r = document.querySelector('nav.side').getBoundingClientRect().width;
        return r > 20 && r < 70;
      },
      null,
      { timeout: 5000 },
    ).catch(() => {});
    await quiet(F);
    await sleep(200);
  };
  // K2
  await check(
    'K2',
    `1280, expanded: keyboard focus on a project's row (its icon until the rail-tooltips PR, which took the icon out of the Tab order) and "[" -> .shell.collapsed and focus on that project's row in the rail (not <body>)`,
    F,
    async () => {
      const tabs = await tabUntil(
        'nav.side .sproj .sitem[data-r="project"] span.pico[data-a="toggleExpand"], nav.side .sproj > .sitem[data-r="project"]:not(:has(span.pico[tabindex]))',
      );
      const before = await focusInfo();
      const pid = before.rowId;
      const picoAria = before.ariaLabel;
      await F.keyboard.press('[');
      await afterCollapse();
      const col = await isCol(F);
      const after = await focusInfo();
      note('K2', `tabs=${tabs} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
      return {
        pass: tabs > 0 && before.focusVisible && !!pid && col && after.isProjectRow && after.inRail && after.data.id === pid,
        ev: {
          tabs,
          pico: { id: pid, role: before.role, ariaLabel: picoAria, focusVisible: before.focusVisible },
          collapsed: col,
          activeElement: { tag: after.el, classes: after.cls, data: after.data, inRail: after.inRail, focusVisible: after.focusVisible },
        },
      };
    },
  );
  await restore(F);
  // K3 (a fresh load: Tab continues from where the last focus was, which is the project row in the sidebar, past the button)
  await F.goto(L.BASE + '/');
  await F.waitForSelector('nav.side .sproj', { state: 'attached', timeout: 15000 });
  await quiet(F);
  await park(F);
  await check('K3', `1280, expanded: keyboard focus on "Collapse sidebar" and "[" -> .shell.collapsed and focus on "Expand sidebar"`, F, async () => {
    const tabs = await tabUntil('nav.side button[data-a="toggleSide"][aria-label="Collapse sidebar"]');
    const before = await focusInfo();
    await F.keyboard.press('[');
    await afterCollapse();
    const col = await isCol(F);
    const after = await F.evaluate(() => {
      const a = document.activeElement;
      return {
        tag: a === document.body ? 'body' : a?.tagName.toLowerCase(),
        cls: String(a?.className || ''),
        data: { ...(a?.dataset || {}) },
        tip: a?.getAttribute?.('data-tip') || null,
        ariaLabel: a?.getAttribute?.('aria-label') || null,
        inRail: !!a?.closest?.('nav.side'),
        focusVisible: !!a?.matches?.(':focus-visible'),
      };
    });
    note('K3', `tabs=${tabs} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    return {
      pass:
        tabs > 0 &&
        before.focusVisible &&
        col &&
        after.tag === 'button' &&
        after.data.a === 'toggleSide' &&
        after.ariaLabel === 'Expand sidebar' &&
        after.inRail,
      ev: { tabs, before: { aria: before.ariaLabel, focusVisible: before.focusVisible }, collapsed: col, activeElement: after },
    };
  });
  await restore(F);
  await F.ctx.close();
});

await b.close();
// ---- totals from the results file
const recs = fs
  .readFileSync(RES, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l))
  .filter(r => !r.note);
const pass = recs.filter(r => r.pass),
  fail = recs.filter(r => !r.pass);
console.log(`TOTAL ${recs.length} checks: ${pass.length} PASS, ${fail.length} FAIL`);
console.log('PASS: ' + pass.map(r => r.id).join(' '));
console.log('FAIL: ' + fail.map(r => r.id).join(' '));
console.log('console errors: ' + recs.reduce((n, r) => n + (r.errs || 0), 0));
