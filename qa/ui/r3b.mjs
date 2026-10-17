// Round 3, suite B: the Projects table says when columns are hidden (fade on the edge with more beyond it, tab stop only while it scrolls)
import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
import * as X from '../lib/fixtures.mjs';
const { sleep } = H;
const check = L.check;
await L.suLogin();
await X.putFields();
const b = await L.launch();
const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 'adminA');
const shot = (pg, n) => pg.screenshot({ path: `${L.OUT}/${n}.png` });
const fade = pg =>
  pg.evaluate(() => {
    const el = document.getElementById('proj-table');
    if (!el) return null;
    const w = el.parentElement;
    const op = p => getComputedStyle(w, p).opacity;
    const pe = p => getComputedStyle(w, p).pointerEvents;
    return {
      sw: el.scrollWidth,
      cw: el.clientWidth,
      x: Math.round(el.scrollLeft),
      l: w.classList.contains('sf-l'),
      r: w.classList.contains('sf-r'),
      opL: op('::before'),
      opR: op('::after'),
      peL: pe('::before'),
      peR: pe('::after'),
      tab: el.getAttribute('tabindex'),
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      keep: el.dataset.keep,
    };
  });
const active = pg =>
  pg.evaluate(() => {
    const e = document.activeElement;
    return e ? e.id || e.tagName.toLowerCase() : null;
  });
const tabTo = async (pg, id, max = 60) => {
  for (let i = 0; i < max; i++) {
    await pg.keyboard.press('Tab');
    if ((await active(pg)) === id) return i + 1;
  }
  return 0;
};
const page_ = async (pg, w, h) => {
  await pg.setViewportSize({ width: w, height: h });
  await sleep(500);
};
try {
  await sleep(1500);
  await H.goProjects(A, 'table');
  await sleep(600);
  // ---- 1280 x 800
  let f = await fade(A);
  await check(
    'T1',
    '1280x800: the panel overflows; the right fade shows (not the left); it is a labelled region with a tab stop; data-keep kept',
    A,
    async () => ({
      pass:
        f.sw > f.cw &&
        f.r &&
        !f.l &&
        f.opR === '1' &&
        f.opL === '0' &&
        f.tab === '0' &&
        f.role === 'region' &&
        f.label === 'Projects table' &&
        f.keep === 'proj-table',
      ev: f,
    }),
  );
  await check('T1b', 'the fades take no clicks (pointer-events none)', A, async () => ({ pass: f.peL === 'none' && f.peR === 'none', ev: [f.peL, f.peR] }));
  await shot(A, 't1-1280-light-start');
  await A.evaluate(() => {
    document.getElementById('proj-table').scrollLeft = 150;
  });
  await sleep(400);
  f = await fade(A);
  await check('T2', 'scrolled part-way: both fades', A, async () => ({ pass: f.l && f.r && f.opL === '1' && f.opR === '1', ev: f }));
  await A.evaluate(() => {
    const e = document.getElementById('proj-table');
    e.scrollLeft = e.scrollWidth;
  });
  await sleep(400);
  f = await fade(A);
  await check('T3', 'scrolled to the end: the right fade is gone and the left one shows', A, async () => ({
    pass: f.l && !f.r && f.opL === '1' && f.opR === '0',
    ev: f,
  }));
  await shot(A, 't3-1280-light-end');
  await A.evaluate(() => {
    document.getElementById('proj-table').scrollLeft = 0;
  });
  await sleep(300);
  // keyboard: Tab reaches the panel, arrow keys scroll it
  await A.evaluate(() => document.body.focus());
  await A.evaluate(() => document.querySelector('#proj-q').focus());
  const tabs = await tabTo(A, 'proj-table');
  const x0 = (await fade(A)).x;
  for (let i = 0; i < 5; i++) await A.keyboard.press('ArrowRight');
  await sleep(500);
  const x1 = (await fade(A)).x;
  await check('T4', '1280: Tab from the search box reaches the panel; ArrowRight scrolls it', A, async () => ({
    pass: tabs > 0 && x1 > x0,
    ev: { tabs, x0, x1 },
  }));
  await shot(A, 't4-focus-ring');
  // a render keeps focus and scroll
  await A.evaluate(() => window.__pmspace.render());
  await sleep(300);
  f = await fade(A);
  await check('T5', 'after a render the panel still has focus and its scroll, and the left fade still shows', A, async () => ({
    pass: (await active(A)) === 'proj-table' && f.x === x1 && f.l,
    ev: { act: await active(A), x: f.x, x1, l: f.l },
  }));
  // ---- 1920
  await page_(A, 1920, 1080);
  f = await fade(A);
  await check(
    'T6',
    'resized wider with the panel focused: no fade, but the panel keeps focus and its tab stop (focus does not drop to the page)',
    A,
    async () => ({ pass: f.sw <= f.cw + 1 && !f.l && !f.r && (await active(A)) === 'proj-table' && f.tab === '0', ev: { f, act: await active(A) } }),
  );
  await A.keyboard.press('Tab');
  await sleep(300);
  f = await fade(A);
  await check('T7', 'after Tab moves focus away, the panel is no longer a tab stop (no tabindex, role, label)', A, async () => ({
    pass: f.tab === null && f.role === null && f.label === null && (await active(A)) !== 'body',
    ev: { f, act: await active(A) },
  }));
  await H.goProjects(A, 'table');
  await sleep(400);
  f = await fade(A);
  const tabs2 = await (async () => {
    await A.evaluate(() => document.querySelector('#proj-q').focus());
    for (let i = 0; i < 40; i++) {
      await A.keyboard.press('Tab');
      if ((await active(A)) === 'proj-table') return i + 1;
    }
    return 0;
  })();
  await check('T8', '1920x1080: no fade, no tab stop (Tab never lands on the panel)', A, async () => ({
    pass: !f.l && !f.r && f.opL === '0' && f.opR === '0' && f.tab === null && tabs2 === 0,
    ev: { f, tabs2 },
  }));
  await shot(A, 't8-1920-light');
  await page_(A, 1280, 800);
  f = await fade(A);
  await check('T9', 'back to 1280 (resize only, no render): the right fade and the tab stop come back', A, async () => ({
    pass: f.r && !f.l && f.tab === '0' && f.opR === '1',
    ev: f,
  }));
  // a filter change re-renders: the fade is still right
  await A.selectOption('select[aria-label="Sort"]', 'name');
  await sleep(500);
  f = await fade(A);
  await check('T10', 'after a sort change (a render) the fade and tab stop are still right', A, async () => ({ pass: f.r && !f.l && f.tab === '0', ev: f }));
  // ---- dark
  await H.setTheme(A, 'dark');
  await sleep(500);
  f = await fade(A);
  const bg = await A.evaluate(() => getComputedStyle(document.getElementById('proj-table')).backgroundColor);
  const grad = await A.evaluate(() => getComputedStyle(document.getElementById('proj-table').parentElement, '::after').backgroundImage);
  await shot(A, 't11-1280-dark-start');
  await A.evaluate(() => {
    const e = document.getElementById('proj-table');
    e.scrollLeft = e.scrollWidth;
  });
  await sleep(400);
  await shot(A, 't11-1280-dark-end');
  await check('T11', "dark: the fade colour is the panel's own surface (gradient starts from the dark surface)", A, async () => ({
    pass: f.r && /rgb\(29, 29, 28\)/.test(grad) && bg === 'rgb(29, 29, 28)',
    ev: { bg, grad: grad.slice(0, 120) },
  }));
  await H.setTheme(A, 'light');
  await sleep(400);
  // ---- phones: no page-level horizontal scroll
  for (const w of [390, 320]) {
    await page_(A, w, 800);
    await H.goProjects(A, 'table');
    await sleep(500);
    const sc = await H.noHScroll(A);
    f = await fade(A);
    await check(`T12-${w}`, `${w}px: no horizontal scroll of the page; the panel scrolls (fade right, tab stop)`, A, async () => ({
      pass: sc.sw <= sc.cw && sc.bsw <= sc.cw && f.r && f.tab === '0',
      ev: { sc, f },
    }));
    await shot(A, `t12-${w}`);
  }
  await check('T13', 'zero console errors; nothing pending', A, async () => {
    const p = await L.settle(A);
    return { pass: A.errs.length === 0 && p.length === 0, ev: { errs: A.errs.slice(0, 4), p } };
  });
} catch (e) {
  console.log('SUITE ERROR', e);
}
console.log(`RESULT ${L.results.pass} pass ${L.results.fail} fail`);
await b.close();
