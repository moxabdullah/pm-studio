// Round 3 own checks: edge scroll only beside the board, picker gone during a drag, togglePipeCol's scroll, bottom-nav scroll padding,
// scroll-margin for the focus ring, landscape phones. It seeds clones of a project and removes them.
import * as L from './lib.mjs';
const { sleep } = L;
const W = 'seed000000000';
const b = await L.launch();

// ---- seed: Tender 9 cards (p3 + 8), Design 5 cards (p1 + 4 clones... the seed already has 2), a "Zeta late card" in Procurement
const base = await L.pbGet('projects', W + 'p1');
const made = [];
const clone = async (n, name, stage) => {
  const rec = Object.fromEntries(Object.entries(base).filter(([k]) => !['id', 'created', 'updated', 'collectionId', 'collectionName'].includes(k)));
  const nid = 'r3seed' + String(n).padStart(9, '0');
  await L.api('POST', '/collections/projects/records', { ...rec, id: nid, doc: { ...base.doc, name, key: 'R3' + n, stage, stageHistory: [] } });
  made.push(nid);
};
for (let i = 1; i <= 8; i++) await clone(i, 'Extra project ' + i, 'tender');
for (let i = 1; i <= 3; i++) await clone(20 + i, 'Design clone ' + i, 'design');
await clone(40, 'Zeta late card', 'procurement');
const SNAP = Object.fromEntries((await L.pbList('projects')).map(p => [p.id, p.doc]));
const restore = async () => {
  for (const p of await L.pbList('projects'))
    if (JSON.stringify(p.doc) !== JSON.stringify(SNAP[p.id])) await L.api('PATCH', '/collections/projects/records/' + p.id, { doc: SNAP[p.id] });
  await sleep(900);
};
const srvStage = async name => (await L.pbList('projects')).find(p => p.doc.name === name)?.doc.stage;

const openBoard = async (ctx, tag, { sort } = {}) => {
  const page = await L.open(ctx, tag);
  await L.login(page, 'hello@example.com');
  await L.goProjects(page);
  await page.evaluate(() => window.__pmspace.A.set({ dataset: { k: 'projView', v: 'board' } }));
  await sleep(600);
  if (sort) {
    await page.selectOption('select[data-in="projSort"]', sort);
    await sleep(500);
  }
  return page;
};
const boardRect = page =>
  page.evaluate(() => {
    const r = document.querySelector('.pboard').getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };
  });
const setSL = (page, v) =>
  page.evaluate(v => {
    document.querySelector('.pboard').scrollLeft = v;
  }, v);
const sl = page => page.evaluate(() => Math.round(document.querySelector('.pboard').scrollLeft));
const instrument = page =>
  page.evaluate(() => {
    window.__do = [];
    document.addEventListener('dragover', e => window.__do.push({ x: e.clientX, y: e.clientY }), true);
  });
const startDrag = async (page, name) => {
  const bb = await page.locator('.pbcard', { hasText: name }).first().boundingBox();
  await page.mouse.move(bb.x + 60, bb.y + 20);
  await page.mouse.down();
  await page.mouse.move(bb.x + 100, bb.y + 30, { steps: 5 });
};
// the first card fully in view of the board (a card low in a column that scrolls inside itself is not)
const viewCard = page =>
  page.evaluate(() => {
    const br = document.querySelector('.pboard').getBoundingClientRect();
    for (const c of document.querySelectorAll('.pbcard')) {
      const r = c.getBoundingClientRect();
      if (r.left >= br.left && r.right <= br.right && r.top >= br.top + 20 && r.bottom <= Math.min(br.bottom, innerHeight) - 20)
        return c.getAttribute('aria-label');
    }
  });
// a held pointer: `n` moves at (x, y), a pixel apart so that each makes a dragover; the board's scrollLeft before and after
const hold = async (page, x, y, n) => {
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(250);
  const s0 = await sl(page);
  await page.evaluate(() => {
    window.__do.length = 0;
  });
  for (let i = 0; i < n; i++) {
    await page.mouse.move(x - (i % 2), y + (i % 2));
    await sleep(70);
  }
  return { s0, s1: await sl(page), ev: await page.evaluate(() => window.__do.length) };
};
// is `r` (inflated by `by` px) inside `box`?

// ======================= desktop 1280x800
const ctx = await L.newCtx(b);
const page = await openBoard(ctx, 'adm');
await instrument(page);
const BR = await boardRect(page);
const SB = await page.evaluate(() => {
  const r = document.querySelector('.side').getBoundingClientRect();
  return { r: r.right };
});
const yMid = Math.round(BR.t + 120);

await L.check(
  'R1a',
  "a card dragged over the sidebar at the board's height (x=100 and x=250, 22px from the board edge) for 20 dragover events: scrollLeft unchanged; cancelled drag leaves it",
  page,
  async () => {
    await setSL(page, 0);
    await sleep(300);
    await startDrag(page, await viewCard(page));
    await setSL(page, 500);
    await sleep(200);
    const a = await hold(page, 100, yMid, 20);
    const c = await hold(page, 250, yMid, 20);
    await page.mouse.up();
    await sleep(400);
    const after = await sl(page);
    await restore();
    return {
      pass: a.s0 === a.s1 && c.s0 === c.s1 && c.s0 === a.s0 && after === 500 && a.ev >= 18 && c.ev >= 18 && 250 < SB.r,
      ev: `sidebar right=${Math.round(SB.r)}, board ${Math.round(BR.l)}..${Math.round(BR.r)}; x=100: scrollLeft ${a.s0} -> ${a.s1} (${a.ev} dragovers); x=250: ${c.s0} -> ${c.s1} (${c.ev} dragovers); after the cancelled drop ${after}`,
    };
  },
);

await L.check(
  'R1b',
  'same height, in the page gutter past the board edge (right: x=board.r+12, left: x=board.l-12) for 20 dragover events: it scrolls',
  page,
  async () => {
    await setSL(page, 0);
    await sleep(300);
    await startDrag(page, await viewCard(page));
    await setSL(page, 500);
    await sleep(200);
    const r = await hold(page, Math.round(BR.r + 12), yMid, 20);
    const l = await hold(page, Math.round(BR.l - 12), yMid, 20);
    await page.mouse.up();
    await sleep(400);
    await restore();
    return {
      pass: r.s1 > r.s0 && l.s1 < l.s0,
      ev: `right gutter x=${Math.round(BR.r + 12)}: scrollLeft ${r.s0} -> ${r.s1} (${r.ev} dragovers); left gutter x=${Math.round(BR.l - 12)}: ${l.s0} -> ${l.s1} (${l.ev} dragovers)`,
    };
  },
);

await L.check('R1c', 'the vertical guard stays: in the gutter but below the board nothing scrolls', page, async () => {
  await setSL(page, 0);
  await sleep(300);
  await startDrag(page, await viewCard(page));
  await setSL(page, 500);
  await sleep(200);
  const y = Math.min(BR.b + 20, 790);
  const r = await hold(page, Math.round(BR.r + 12), y, 14);
  await page.mouse.up();
  await sleep(400);
  await restore();
  return { pass: y > BR.b && r.s0 === r.s1, ev: `y=${Math.round(y)} (board bottom ${Math.round(BR.b)}): scrollLeft ${r.s0} -> ${r.s1} (${r.ev} dragovers)` };
});

await L.check(
  'R2',
  'a picker open on one card, a drag of another starts: no .pop.floating during the drag; a drop onto the spot the picker covered moves the card',
  page,
  async () => {
    await setSL(page, 0);
    await sleep(300);
    let info = null;
    for (const a of ['Extra project 3', 'Design clone 1', 'Extra project 5', 'Marketing Campaign']) {
      await page.locator('.pbcard', { hasText: a }).first().locator('.pmove').click();
      await sleep(400);
      info = await page.evaluate(() => {
        const pr = document.querySelector('.pop.floating')?.getBoundingClientRect();
        if (!pr) return null;
        const cx = Math.round(pr.left + pr.width / 2),
          cy = Math.round(pr.top + 60);
        const under = document.elementsFromPoint(cx, cy).find(e => !e.closest('.pop') && e.closest('[data-drop-stage]'));
        return {
          cx,
          cy,
          col: under?.closest('[data-drop-stage]').dataset.dropStage,
          covered: !!document.elementFromPoint(cx, cy).closest('.pop'),
          box: [pr.left, pr.top, pr.right, pr.bottom].map(Math.round),
        };
      });
      if (info?.col) {
        info.a = a;
        break;
      }
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    if (!info?.col) return { pass: false, ev: 'no picker position over a column found: ' + JSON.stringify(info) };
    // B: a visible card of another column, outside the picker
    const B = await page.evaluate(({ col, box }) => {
      const bd = document.querySelector('.pboard').getBoundingClientRect();
      for (const c of document.querySelectorAll('.pbcard')) {
        const r = c.getBoundingClientRect();
        const cc = c.closest('[data-drop-stage]').dataset.dropStage;
        if (
          cc !== col &&
          r.left >= bd.left &&
          r.right <= bd.right &&
          r.top >= bd.top &&
          r.bottom <= bd.bottom &&
          (r.right < box[0] || r.left > box[2] || r.bottom < box[1] || r.top > box[3])
        )
          return { name: c.getAttribute('aria-label'), from: cc };
      }
    }, info);
    if (!B) return { pass: false, ev: 'no card of another column to drag: ' + JSON.stringify(info) };
    await startDrag(page, B.name);
    await page.mouse.move(info.cx + 30, info.cy + 20, { steps: 3 });
    await sleep(250);
    const during = await page.evaluate(
      ({ cx, cy }) => ({
        pops: document.querySelectorAll('.pop.floating').length,
        col: document.elementFromPoint(cx, cy)?.closest('[data-drop-stage]')?.dataset.dropStage,
      }),
      info,
    );
    await page.mouse.move(info.cx, info.cy, { steps: 4 });
    await sleep(250);
    const over = await page.evaluate(() => document.querySelector('.bcol.drop-over')?.dataset.dropStage);
    await page.mouse.up();
    await sleep(900);
    const stage = await srvStage(B.name);
    const toast = await L.toastsTxt(page);
    await restore();
    return {
      pass: info.covered && during.pops === 0 && during.col === info.col && over === info.col && stage === info.col && B.from !== info.col,
      ev: `picker of "${info.a}" at ${JSON.stringify(info.box)} covered the point (${info.cx},${info.cy}) of column ${info.col}=${info.covered}; dragging "${B.name}" (from ${B.from}): .pop.floating during=${during.pops}, column under the old picker spot=${during.col}, .over=${over}; server stage after drop=${stage}; toast=${JSON.stringify(toast)}`,
    };
  },
);

await L.check(
  'R3a',
  "focus on a Move button in a far column, then el.click() (no focus move) on another column's collapse button: the focused button is not scrolled to",
  page,
  async () => {
    await setSL(page, 0);
    await sleep(300);
    const r = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const bd = () => document.querySelector('.pboard'); // the board is drawn anew by each render
      const mv = bd().querySelector('[data-drop-stage="installation"] .pmove');
      mv.focus({ preventScroll: true });
      const before = { sl: bd().scrollLeft, out: mv.getBoundingClientRect().left > bd().getBoundingClientRect().right };
      bd().querySelector('[data-drop-stage="tender"] .bcol-h [data-a="togglePipeCol"]').click();
      await sleep(400);
      const a = document.activeElement;
      const after = {
        sl: bd().scrollLeft,
        label: a.getAttribute('aria-label'),
        isMv: a.classList.contains('pmove'),
        tenderStrip: bd().querySelector('[data-drop-stage="tender"]').matches('button.collapsed'),
        stillOut: a.getBoundingClientRect().left > bd().getBoundingClientRect().right,
      };
      bd().querySelector('[data-drop-stage="tender"]').click(); // back
      await sleep(300);
      return { before, after, sl2: bd().scrollLeft };
    });
    return {
      pass: r.before.out && r.before.sl === 0 && r.after.sl === 0 && r.after.isMv && r.after.stillOut && r.after.tenderStrip && r.sl2 === 0,
      ev: JSON.stringify(r),
    };
  },
);

await L.check(
  'R3b',
  "keyboard expand of a strip (focus put there off screen, Enter): focus is on the column's header button and it is visible; Enter again collapses",
  page,
  async () => {
    await setSL(page, 0);
    await sleep(300);
    await page.evaluate(() => document.querySelector('.pboard [data-drop-stage="closed"]').focus({ preventScroll: true }));
    const before = await sl(page);
    await page.keyboard.press('Enter');
    await sleep(500);
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      const ar = a.getBoundingClientRect();
      const br = document.querySelector('.pboard').getBoundingClientRect();
      return {
        label: a.getAttribute('aria-label'),
        key: a.dataset.key,
        sl: Math.round(document.querySelector('.pboard').scrollLeft),
        inBoard: ar.left >= br.left && ar.right <= br.right,
        inView: ar.top >= 0 && ar.bottom <= innerHeight,
        to: a.dataset.to,
      };
    });
    await page.keyboard.press('Enter');
    await sleep(500);
    const back = await page.evaluate(() => ({
      label: document.activeElement.getAttribute('aria-label'),
      strip: document.activeElement.matches('button.collapsed'),
    }));
    return {
      pass: before === 0 && r.sl > 0 && r.inBoard && r.inView && /^pipe:.*:closed$/.test(r.key) && r.to === 'collapse' && back.strip,
      ev: `board scrollLeft 0 -> ${r.sl}; focus "${r.label}" in board=${r.inBoard}, in viewport=${r.inView}; after the second Enter: "${back.label}" strip=${back.strip}`,
    };
  },
);

// ---- outline inside the scrollport (with and without the scroll-margin, as a control)
const outlineRun = async (tag, css) => {
  const ctxO = await L.newCtx(b);
  const p = await openBoard(ctxO, tag, { sort: 'name' });
  if (css) await p.addStyleTag({ content: css });
  const out = {};
  // horizontal: a card picked into a far column at the edge of the board
  await setSL(p, 900);
  await sleep(300);
  await p.locator('.pbcard', { hasText: 'Customer Portal' }).locator('.pmove').click();
  await sleep(300);
  await p.locator('.pop.floating .mi', { hasText: 'Warranty' }).first().click();
  await sleep(700);
  out.h = await p.evaluate(() => {
    const a = document.activeElement;
    const c = a.closest('.pbcard');
    const r = c.getBoundingClientRect();
    const br = document.querySelector('.pboard').getBoundingClientRect();
    return { label: a.getAttribute('aria-label'), l: r.left - br.left, rr: br.right - r.right, btnIn: a.getBoundingClientRect().right <= br.right };
  });
  // and to the left: scrolled right first, a card in view is picked into Tender, which is off screen to the left
  await setSL(p, 900);
  await sleep(300);
  const vc = await viewCard(p);
  await p.locator('.pbcard', { hasText: vc }).locator('.pmove').click();
  await sleep(300);
  await p.locator('.pop.floating .mi', { hasText: 'Tender' }).first().click();
  await sleep(700);
  out.hl = await p.evaluate(() => {
    const a = document.activeElement;
    const c = a.closest('.pbcard');
    const r = c.getBoundingClientRect();
    const br = document.querySelector('.pboard').getBoundingClientRect();
    return {
      label: a.getAttribute('aria-label'),
      col: a.closest('[data-drop-stage]')?.dataset.dropStage,
      l: r.left - br.left,
      rr: br.right - r.right,
      sl: Math.round(document.querySelector('.pboard').scrollLeft),
      btnFocus: a.classList.contains('pmove'),
    };
  });
  await restore();
  // vertical: Zeta (the last by name) picked into the 9-card Tender column, which scrolls inside itself
  await setSL(p, 0);
  await sleep(300);
  await p.locator('.pbcard', { hasText: 'Zeta late card' }).locator('.pmove').focus();
  await p.keyboard.press('Enter');
  await sleep(300);
  await p.locator('.pop.floating .mi', { hasText: 'Tender' }).first().focus();
  await p.keyboard.press('Enter');
  await sleep(700);
  out.v = await p.evaluate(() => {
    const a = document.activeElement;
    const r = a.closest('.pbcard').getBoundingClientRect();
    const cb = a.closest('.bcol-b').getBoundingClientRect();
    return {
      label: a.getAttribute('aria-label'),
      col: a.closest('[data-drop-stage]')?.dataset.dropStage,
      top: r.top - cb.top,
      bot: cb.bottom - r.bottom,
      scrolled: a.closest('.bcol-b').scrollTop,
      rr: [r.left, r.top, r.right, r.bottom],
    };
  });
  await restore();
  const errs = p.errs.slice();
  await ctxO.close();
  return { out, errs };
};
const o1 = await outlineRun('adm-o1');
await L.check(
  'R5',
  'after a pick that scrolls the board (sideways, and inside a 9-card column) the whole card (not just its Move button) lies inside the scrollport, 4px clear of the edge',
  page,
  async () => {
    const { h, v } = o1.out;
    return {
      pass:
        h.l >= 3 &&
        h.rr >= 3 &&
        h.btnIn &&
        /^Move Customer Portal/.test(h.label) &&
        /^Move Zeta/.test(v.label) &&
        v.col === 'tender' &&
        v.scrolled > 0 &&
        v.top >= 3 &&
        v.bot >= 3,
      ev: `[ADAPTED: the card's gaps, not the button's] sideways: card gap to the board's left ${h.l.toFixed(1)}px, right ${h.rr.toFixed(1)}px; in Tender (scrollTop ${v.scrolled}): card gap to the column body's top ${v.top.toFixed(1)}px, bottom ${v.bot.toFixed(1)}px (need >= 3 each)`,
    };
  },
);
await L.check(
  'R7b',
  "1280, board scrolled right first (900): a keyboard-less pick of a card in view into Tender (off screen to the left) leaves the whole card inside the board's scrollport (left >= board left, right <= board right), focus on its Move button",
  page,
  async () => {
    const h = o1.out.hl;
    return {
      pass: h.col === 'tender' && h.btnFocus && /^Move /.test(h.label) && h.l >= 3 && h.rr >= 0 && h.sl < 900,
      ev: `"${h.label}": card ${h.l.toFixed(1)}px right of the board's left edge, ${h.rr.toFixed(1)}px left of its right edge; board scrollLeft 900 -> ${h.sl}`,
    };
  },
);
const o0 = await outlineRun('adm-o0', '.pbcard,.pbcard .pmove{scroll-margin:0 !important}');
await L.check('R5c', 'control: with the scroll-margin taken away the same picks leave the button flush (the check can fail)', page, async () => {
  const { h, v } = o0.out;
  const flush = Math.min(h.l, h.rr) < 3 || Math.min(v.top, v.bot) < 3;
  return {
    pass: flush,
    ev: `without the margin on the card: sideways gaps ${h.l.toFixed(1)}/${h.rr.toFixed(1)}px, vertical gaps ${v.top.toFixed(1)}/${v.bot.toFixed(1)}px`,
  };
});
page.errs.push(...o1.errs, ...o0.errs);
await ctx.close();

// ======================= phone 390x844 (hasTouch)
const PH = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const phoneRun = async (tag, css, shotName) => {
  const ctxP = await b.newContext(PH);
  const p = await openBoard(ctxP, tag, { sort: 'name' });
  if (css) await p.addStyleTag({ content: css });
  const out = {};
  out.nav = await p.evaluate(() => {
    const n = document.querySelector('.bottomnav');
    const c = document.querySelector('.content');
    return { h: n.getBoundingClientRect().height, sp: getComputedStyle(c).scrollPaddingBottom, pad: parseFloat(getComputedStyle(c).scrollPaddingBottom) || 0 };
  });
  // (a) Move path: Zeta (last by name) picked into Tender, 9 cards tall, by keyboard
  await p.locator('.pbcard', { hasText: 'Zeta late card' }).locator('.pmove').focus();
  out.slBefore = await sl(p); // the board was scrolled right by that focus: Tender is off screen to the left
  await p.keyboard.press('Enter');
  await sleep(300);
  await p.locator('.pop.floating .mi', { hasText: 'Tender' }).first().focus();
  await p.keyboard.press('Enter');
  await sleep(800);
  out.move = await p.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    const n = document.querySelector('.bottomnav').getBoundingClientRect();
    const cards = [...a.closest('.bcol-b').querySelectorAll('.pbcard')];
    const card = a.closest('.pbcard').getBoundingClientRect();
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    const t = document.querySelector('#toasts .toast:not(.out)')?.getBoundingClientRect();
    return {
      card: { l: Math.round(card.left - bd.left), rr: Math.round(bd.right - card.right), bottom: Math.round(card.bottom), top: Math.round(card.top) },
      toast: t && { top: Math.round(t.top), bottom: Math.round(t.bottom), h: Math.round(t.height) },
      sl: Math.round(document.querySelector('.pboard').scrollLeft),
      label: a.getAttribute('aria-label'),
      col: a.closest('[data-drop-stage]')?.dataset.dropStage,
      idx: cards.indexOf(a.closest('.pbcard')) + 1,
      of: cards.length,
      bottom: Math.round(r.bottom),
      navTop: Math.round(n.top),
      top: Math.round(r.top),
      sc: Math.round(document.querySelector('.content').scrollTop),
    };
  });
  if (shotName) await L.shot(p, shotName);
  await restore();
  const errs = p.errs.slice();
  await ctxP.close();
  return { out, errs };
};
const ph1 = await phoneRun('ph1', null, 'board-390-after-low-pick');
await L.check(
  'R4a',
  "390x844, Sort by name: after a keyboard pick the Move button of the card that landed last in a 9-card column is above the bottom nav's top",
  page,
  async () => {
    const m = ph1.out.move;
    return {
      pass: /^Move Zeta/.test(m.label) && m.col === 'tender' && m.idx === m.of && m.of >= 9 && m.bottom <= m.navTop - 12 + 1 && m.top >= 0,
      ev: `focus "${m.label}" is card ${m.idx} of ${m.of} in ${m.col}; button bottom ${m.bottom}px, bottom nav top ${m.navTop}px (gap ${m.navTop - m.bottom}px); .content scrollTop ${m.sc}`,
    };
  },
);
await L.check(
  'R7',
  "390x844, board scrolled right first: a keyboard pick into Tender leaves the whole card inside the board's scrollport (left >= board left, right <= board right) and its bottom above the toast's top",
  page,
  async () => {
    const m = ph1.out.move;
    return {
      pass:
        ph1.out.slBefore > 0 &&
        m.sl < ph1.out.slBefore &&
        m.card.l >= 3 &&
        m.card.rr >= 0 &&
        !!m.toast &&
        m.card.bottom <= m.toast.top &&
        m.card.bottom <= m.navTop,
      ev: `board scrollLeft ${ph1.out.slBefore} -> ${m.sl}; card ${m.card.l}px from the board's left edge, ${m.card.rr}px from its right edge; card ${m.card.top}..${m.card.bottom}px, toast ${m.toast ? m.toast.top + '..' + m.toast.bottom + 'px (' + m.toast.h + 'px high)' : 'none'}, nav top ${m.navTop}px`,
    };
  },
);
await L.check(
  'R8',
  "390x844: where the toast stack sits (bottom toast's top edge against the nav top) and that the scroll padding clears one toast + 8px",
  page,
  async () => {
    const ctxP = await b.newContext(PH);
    const p = await openBoard(ctxP, 'ph-t');
    // the "Signed in as ..." toast lasts about 4 s: with it still up there are two toasts and the padding rightly clears both
    await p.waitForFunction(() => !document.querySelector('#toasts .toast'), null, { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => (window.__pmspace.toast ? window.__pmspace.toast('A moved to B') : null));
    const have = await p.evaluate(() => !!window.__pmspace.toast);
    if (!have) {
      await p.locator('.pbcard').first().locator('.pmove').click();
      await sleep(300);
      await p.locator('.pop.floating .mi').nth(3).click();
      await sleep(500);
    }
    const m = await p.evaluate(() => {
      const t = [...document.querySelectorAll('#toasts .toast')].pop().getBoundingClientRect();
      const n = document.querySelector('.bottomnav').getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(document.querySelector('.content')).scrollPaddingBottom);
      return { top: t.top, bottom: t.bottom, h: t.height, navTop: n.top, ih: innerHeight, pad };
    });
    await restore();
    await ctxP.close();
    return {
      pass: m.bottom <= m.navTop && m.pad >= m.ih - m.top + 8 - 0.5 && m.pad <= m.ih - m.top + 10,
      ev: `toast ${Math.round(m.top)}..${Math.round(m.bottom)}px (${Math.round(m.h)}px high), ${Math.round(m.navTop - m.bottom)}px above the nav top (${Math.round(m.navTop)}); its top edge is ${Math.round(m.ih - m.top)}px above the viewport's foot; scroll-padding-bottom ${m.pad}px`,
    };
  },
);
const ph0 = await phoneRun('ph0', '.content{scroll-padding-bottom:0 !important}');
await L.check('R4c', 'control: without the scroll padding the same pick leaves the button under the nav (the check can fail)', page, async () => {
  const m = ph0.out.move;
  return { pass: m.bottom > m.navTop - 12 + 1, ev: `without the padding: button bottom ${m.bottom}px, nav top ${m.navTop}px` };
});
await L.check(
  'R4n',
  "the padding is at least the nav's height + 12 (nav measured; it also clears a toast, R8), and normal scrolling to the end is unchanged by it",
  page,
  async () => {
    const ctxP = await b.newContext(PH);
    const p = await openBoard(ctxP, 'ph-n', { sort: 'name' });
    const m = await p.evaluate(() => {
      const c = document.querySelector('.content');
      const n = document.querySelector('.bottomnav').getBoundingClientRect().height;
      c.scrollTop = 1e6;
      const withPad = c.scrollTop;
      const pad = parseFloat(getComputedStyle(c).scrollPaddingBottom);
      c.style.scrollPaddingBottom = '0px';
      c.scrollTop = 0;
      c.scrollTop = 1e6;
      const without = c.scrollTop;
      c.style.scrollPaddingBottom = '';
      return { n, pad, withPad, without, max: c.scrollHeight - c.clientHeight };
    });
    await ctxP.close();
    return {
      pass: m.pad >= m.n + 12 - 0.5 && m.withPad === m.without && Math.abs(m.withPad - m.max) <= 1,
      ev: `nav ${m.n}px high, scroll-padding-bottom ${m.pad}px; scrolled to the end: ${m.withPad} with, ${m.without} without (max ${Math.round(m.max)})`,
    };
  },
);

// (b) collapse path: Tender collapsed first, so that the board is Design's 5 cards tall; collapsing Procurement leaves a strip as tall as the
// board, with its bottom below the fold
const collapseRun = async (tag, css) => {
  const ctxP = await b.newContext(PH);
  const p = await openBoard(ctxP, tag);
  if (css) await p.addStyleTag({ content: css });
  await p.evaluate(() => document.querySelector('.pboard [data-drop-stage="tender"] .bcol-h [data-a="togglePipeCol"]').click());
  await sleep(500);
  await p.evaluate(() => {
    document.querySelector('.content').scrollTop = 0;
  });
  await sleep(200);
  const pre = await p.evaluate(() => {
    const c = document.querySelector('.pboard [data-drop-stage="procurement"]').getBoundingClientRect();
    return { bottom: Math.round(c.bottom), h: Math.round(c.height), ih: innerHeight };
  });
  await p.evaluate(() => document.querySelector('.pboard [data-drop-stage="procurement"] .bcol-h [data-a="togglePipeCol"]').focus({ preventScroll: true }));
  await p.keyboard.press('Enter');
  await sleep(700);
  const col = await p.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    const n = document.querySelector('.bottomnav').getBoundingClientRect();
    return {
      label: a.getAttribute('aria-label'),
      strip: a.matches('button.collapsed'),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      navTop: Math.round(n.top),
      sc: Math.round(document.querySelector('.content').scrollTop),
    };
  });
  // expand path: the page scrolled to the end first, so the header of the column is above the view
  await p.evaluate(() => {
    document.querySelector('.content').scrollTop = 1e6;
  });
  await sleep(200);
  await p.keyboard.press('Enter');
  await sleep(700);
  const exp = await p.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    const n = document.querySelector('.bottomnav').getBoundingClientRect();
    const tb = document.querySelector('.content').getBoundingClientRect();
    return {
      label: a.getAttribute('aria-label'),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      navTop: Math.round(n.top),
      contentTop: Math.round(tb.top),
    };
  });
  const errs = p.errs.slice();
  await ctxP.close();
  return { pre, col, exp, errs };
};
const c1 = await collapseRun('ph-c1');
await L.check(
  'R4b',
  '390x844, collapse/expand by keyboard: the strip that takes the focus (its bottom below the fold before) ends above the bottom nav; the header button after expand is in view and above the nav',
  page,
  async () => {
    return {
      pass:
        c1.pre.bottom > c1.pre.ih - 69 &&
        c1.col.strip &&
        c1.col.bottom <= c1.col.navTop - 12 + 1 &&
        c1.exp.top >= c1.exp.contentTop - 1 &&
        c1.exp.bottom <= c1.exp.navTop &&
        /^Collapse /.test(c1.exp.label),
      ev: `strip before: bottom ${c1.pre.bottom}px of ${c1.pre.ih}px, ${c1.pre.h}px tall; after collapse: "${c1.col.label}" bottom ${c1.col.bottom}px, nav top ${c1.col.navTop}px (gap ${c1.col.navTop - c1.col.bottom}px); after expand: "${c1.exp.label}" ${c1.exp.top}..${c1.exp.bottom}px, nav top ${c1.exp.navTop}px`,
    };
  },
);
const c0 = await collapseRun('ph-c0', '.content{scroll-padding-bottom:0 !important}');
await L.check('R4d', 'control: without the scroll padding the strip ends under the nav (the check can fail)', page, async () => {
  return { pass: c0.col.bottom > c0.col.navTop - 12 + 1, ev: `without the padding: strip bottom ${c0.col.bottom}px, nav top ${c0.col.navTop}px` };
});
page.errs.push(...ph1.errs, ...ph0.errs, ...c1.errs, ...c0.errs);

// ======================= landscape phone 844x390 (hasTouch)
{
  const ctxL = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await openBoard(ctxL, 'land');
  await L.check(
    'R6',
    '844x390 landscape (hasTouch): no max-height cap on the columns, no inner vertical scroll; no page-level horizontal scroll; the board scrolls inside',
    p,
    async () => {
      const m = await p.evaluate(() => {
        const cols = [...document.querySelectorAll('.pboard .bcol')];
        const bodies = [...document.querySelectorAll('.pboard .bcol-b')];
        return {
          n: cols.length,
          maxH: [...new Set(cols.map(c => getComputedStyle(c).maxHeight))],
          ovY: [...new Set(bodies.map(c => getComputedStyle(c).overflowY))],
          sw: document.documentElement.scrollWidth,
          iw: innerWidth,
          boardScroll: document.querySelector('.pboard').scrollWidth > document.querySelector('.pboard').clientWidth,
          coarse: matchMedia('(pointer: coarse)').matches,
          tall: Math.round(document.querySelector('.pboard [data-drop-stage="tender"]').getBoundingClientRect().height),
        };
      });
      return {
        pass:
          m.n >= 9 && m.maxH.length === 1 && m.maxH[0] === 'none' && m.ovY.length === 1 && m.ovY[0] === 'visible' && m.sw <= m.iw && m.boardScroll && m.coarse,
        ev: JSON.stringify(m),
      };
    },
  );
  await L.shot(p, 'board-844x390-landscape');
  await p.evaluate(() => {
    document.querySelector('.content').scrollTop = 300;
  });
  await sleep(300);
  await L.shot(p, 'board-844x390-landscape-scrolled');
  page.errs.push(...p.errs);
  await ctxL.close();
}

console.log('console errors:', JSON.stringify(page.errs));
await restore();
for (const id of made) await L.api('DELETE', '/collections/projects/records/' + id).catch(() => {});
await b.close();
