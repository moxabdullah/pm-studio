// Stricter replacements for the loosened adaptations (a1 threshold, c2 scroll assertion).
import * as L from './lib.mjs';
const b = await L.launch();
const ctx = await L.newCtx(b);
const page = await L.open(ctx, 'adm');
await L.login(page, 'hello@example.com');
await L.goProjects(page);
await page.locator('.seg button', { hasText: 'Board' }).click();
await L.sleep(500);
const SNAP = Object.fromEntries((await L.pbList('projects')).map(p => [p.id, p.doc]));
const restore = async () => {
  for (const p of await L.pbList('projects'))
    if (JSON.stringify(p.doc) !== JSON.stringify(SNAP[p.id])) await L.api('PATCH', '/collections/projects/records/' + p.id, { doc: SNAP[p.id] });
  await L.sleep(1200);
};
const setSL = v =>
  page.evaluate(v => {
    document.querySelector('.pboard').scrollLeft = v;
  }, v);
const sl = () => page.evaluate(() => Math.round(document.querySelector('.pboard').scrollLeft));
const EDGE = 56;
const instrument = () =>
  page.evaluate(() => {
    window.__do = [];
    const bd = document.querySelector('.pboard');
    document.addEventListener('dragover', e => window.__do.push({ x: e.clientX, y: e.clientY, sl: bd.scrollLeft }), true);
  });
const startDrag = async name => {
  const bb = await page.locator('.pbcard', { hasText: name }).boundingBox();
  await page.mouse.move(bb.x + 60, bb.y + 20);
  await page.mouse.down();
  await page.mouse.move(bb.x + 100, bb.y + 30, { steps: 5 });
};
await instrument();
const board = await page.evaluate(() => {
  const r = document.querySelector('.pboard').getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom };
});
// expected scroll applied by one dragover at (x, y): the spec's rule
const expected = ev => {
  if (ev.y < board.t || ev.y > board.b) return 0;
  const dl = Math.max(0, ev.x - board.l),
    dr = Math.max(0, board.r - ev.x);
  if (dl < EDGE) return -Math.ceil((EDGE - dl) / 3);
  if (dr < EDGE) return Math.ceil((EDGE - dr) / 3);
  return 0;
};
const analyse = evs => {
  let bad = 0,
    n = 0,
    sum = 0;
  const rows = [];
  for (let i = 0; i + 1 < evs.length; i++) {
    const exp = expected(evs[i]);
    const got = Math.round(evs[i + 1].sl - evs[i].sl);
    // clamp at the ends of the scroll range makes got smaller than exp: only count when not clamped
    n++;
    sum += got;
    if (got !== exp) {
      bad++;
      rows.push(`${evs[i].x},${evs[i].y}: expected ${exp} got ${got}`);
    }
  }
  return { n, bad, sum, rows: rows.slice(0, 4) };
};

await L.check(
  'S1',
  'edge scroll arithmetic: 24 dragover events 20px inside the right edge scroll by exactly ceil((56-d)/3) each (>= 200 px total)',
  page,
  async () => {
    await setSL(0);
    await L.sleep(300);
    await page.evaluate(() => {
      window.__do.length = 0;
    });
    await startDrag('Marketing Campaign');
    await page.mouse.move(700, 300, { steps: 6 });
    await page.mouse.move(board.r - 20, 300, { steps: 3 });
    const s0 = await sl();
    for (let i = 0; i < 24; i++) {
      await page.mouse.move(board.r - 20 - (i % 2) * 3, 301 + (i % 2));
      await L.sleep(120);
    }
    const s1 = await sl();
    const evs = await page.evaluate(() => window.__do.slice());
    const near = evs.filter(e => board.r - e.x < EDGE && e.x <= board.r);
    const a = analyse(evs.slice(evs.indexOf(near[0]) >= 0 ? evs.indexOf(near[0]) : 0));
    await page.mouse.up();
    await L.sleep(500);
    await restore();
    return {
      pass: s0 === 0 && s1 - s0 >= 200 && a.bad === 0 && near.length >= 12,
      ev: `scrollLeft ${s0} -> ${s1} (+${s1 - s0}); ${evs.length} dragover events, ${near.length} inside the 56px zone; step check over ${a.n} consecutive events: mismatches=${a.bad} ${JSON.stringify(a.rows)}`,
    };
  },
);

await L.check('S2', 'negative control: a drag held 70px inside the right edge (outside the 56px zone) does not scroll the board', page, async () => {
  await setSL(0);
  await L.sleep(300);
  await page.evaluate(() => {
    window.__do.length = 0;
  });
  await startDrag('Marketing Campaign');
  await page.mouse.move(700, 300, { steps: 6 });
  await page.mouse.move(board.r - 70, 300, { steps: 3 });
  const s0 = await sl();
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(board.r - 70 - (i % 2) * 3, 301 + (i % 2));
    await L.sleep(120);
  }
  const s1 = await sl();
  const n = await page.evaluate(() => window.__do.length);
  // also: pointer inside the zone but BELOW the board (y > board bottom): the rule requires the pointer to be level with the board
  await page.evaluate(() => {
    window.__do.length = 0;
  });
  const yBelow = Math.min(board.b + 20, 790);
  const belowPossible = yBelow > board.b;
  let s2 = s1;
  if (belowPossible) {
    await page.mouse.move(700, yBelow, { steps: 4 });
    await page.mouse.move(board.r - 20, yBelow, { steps: 4 });
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(board.r - 20 - (i % 2) * 3, yBelow + (i % 2));
      await L.sleep(120);
    }
    s2 = await sl();
  }
  await page.mouse.up();
  await L.sleep(500);
  await restore();
  return {
    pass: s0 === s1 && s1 === 0 && s2 === s1 && n > 8,
    ev: `70px inside: scrollLeft ${s0} -> ${s1} over ${n} dragover events (stays at 0); in-zone x but below the board (y=${yBelow}, boardBottom=${Math.round(board.b)}, tested=${belowPossible}): ${s2}`,
  };
});

await L.check(
  'S3',
  'c2 strict: after a picker move to a far column the focused button is fully visible and the board scrolled only as far as "nearest" needs (flush to the edge, not past it, not to 0)',
  page,
  async () => {
    await setSL(900);
    await L.sleep(300);
    const vn = await page.evaluate(() => {
      const bd = document.querySelector('.pboard').getBoundingClientRect();
      const c = [...document.querySelectorAll('.pbcard')].find(c => {
        const r = c.getBoundingClientRect();
        return r.left >= bd.left && r.right <= bd.right;
      });
      return c?.getAttribute('aria-label');
    });
    await page.locator('.pbcard', { hasText: vn }).locator('[data-pop="pstage"]').click();
    await L.sleep(300);
    await L.popPick(page, 'Warranty');
    await L.sleep(700);
    const r = await page.evaluate(() => {
      const bd = document.querySelector('.pboard');
      const br = bd.getBoundingClientRect();
      const a = document.activeElement;
      const ar = a.getBoundingClientRect();
      const cr = a.closest('.pbcard').getBoundingClientRect();
      const top = document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2);
      return {
        sl: Math.round(bd.scrollLeft),
        max: bd.scrollWidth - bd.clientWidth,
        lbl: a.getAttribute('aria-label'),
        left: Math.round(cr.left - br.left),
        right: Math.round(br.right - cr.right),
        /* [ADAPTED r3: the CARD is what is flush with the board edge now; the button sits inside its padding] */ fullX:
          ar.left >= br.left - 1 && ar.right <= br.right + 1,
        inViewY: ar.top >= 0 && ar.bottom <= innerHeight,
        hit: !!top && (top === a || a.contains(top)),
      };
    });
    // nearest: a button that was to the right of the view ends flush with the board's right edge (within the board's 4px padding + rounding)
    const flush = r.right <= 12;
    await restore();
    return {
      pass: r.sl > 900 && r.sl <= r.max && r.fullX && r.inViewY && r.hit && flush && /^Move /.test(r.lbl),
      ev: `scrollLeft 900 -> ${r.sl} (max ${r.max}); card gap to board left=${r.left}px, right=${r.right}px; fully inside board=${r.fullX}, inside viewport vertically=${r.inViewY}, hit-test=${r.hit}`,
    };
  },
);
console.log('errors:', JSON.stringify(page.errs));
await restore();
await b.close();
