// Part 2 a + c: real-mouse drags across a board wider than the viewport; scroll retention
import * as L from './lib.mjs';
const b = await L.launch();
const ctx = await L.newCtx(b);
const page = await L.open(ctx, 'adm');
await L.login(page, 'hello@example.com');
await L.goProjects(page);
await page.locator('.seg button', { hasText: 'Board' }).click();
await L.sleep(500);
const st = () =>
  page.evaluate(() => {
    const bd = document.querySelector('.pboard');
    return {
      sl: Math.round(bd.scrollLeft),
      max: bd.scrollWidth - bd.clientWidth,
      drag: document.querySelectorAll('.pbcard.dragging').length,
      over: [...document.querySelectorAll('.bcol.drop-over')].map(c => (c.getAttribute('aria-label') || '').replace(/^Expand /, '')),
    };
  });
const setSL = v =>
  page.evaluate(v => {
    document.querySelector('.pboard').scrollLeft = v;
  }, v);
const srvStage = async name => (await L.pbList('projects')).find(p => p.doc.name === name)?.doc.stage;
const startDrag = async name => {
  const bb = await page.locator('.pbcard', { hasText: name }).boundingBox();
  await page.mouse.move(bb.x + 60, bb.y + 20);
  await page.mouse.down();
  await page.mouse.move(bb.x + 100, bb.y + 30, { steps: 5 });
};
const settle = async (x, y) => {
  await page.mouse.move(x + 3, y + 3);
  await page.mouse.move(x, y);
  await L.sleep(300);
}; // headless drag dispatches dragover sparsely: nudge so .over reflects the pointer
const holdAt = async (x, y, ms, stopAtMax = true) => {
  const t0 = Date.now();
  const samples = [];
  let i = 0;
  while (Date.now() - t0 < ms) {
    await page.mouse.move(x - (i % 2) * 6, y + (i % 2));
    await L.sleep(200);
    const s = await st();
    samples.push(s.sl);
    i++;
    if (stopAtMax && s.sl >= s.max) break;
  }
  return samples;
};
const SNAP = Object.fromEntries((await L.pbList('projects')).map(p => [p.id, p.doc]));
const restore = async () => {
  for (const p of await L.pbList('projects'))
    if (p.doc.stage !== SNAP[p.id].stage) await L.api('PATCH', '/collections/projects/records/' + p.id, { doc: SNAP[p.id] });
  await L.sleep(1200);
  await setSL(0);
  await L.sleep(300);
};

await L.check('a1', 'real drag held at the board right edge auto-scrolls the board horizontally (headless Chromium)', page, async () => {
  await startDrag('Marketing Campaign');
  await page.mouse.move(700, 300, { steps: 6 });
  const s0 = await st();
  await page.mouse.move(1240, 300, { steps: 3 });
  // [ADAPTED] headless dispatches dragover only on some moves (a real drag repeats it by itself, ~20 Hz): the same y and a 1px nudge, as in a6, produce one each time
  const smp = [];
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(1240 - (i % 2), 301);
    await L.sleep(150);
    smp.push((await st()).sl);
  }
  await page.mouse.up();
  await L.sleep(400);
  const toast = await L.toastsTxt(page);
  return {
    pass: s0.sl === 0 && s0.drag === 1 && smp[smp.length - 1] > 30,
    ev: `drag active=${s0.drag}; scrollLeft 0 -> ${smp.join(',')} over ${smp.length} samples at 16px from edge (~${Math.round(smp[smp.length - 1] / (smp.length * 0.2))} px/s); released over a column; toast=${JSON.stringify(toast)}`,
  };
});
await L.sleep(400);
// put it back for the next check
await restore();

await L.check('a2', 'drag to the far strip: edge-hold to the end, drop on the collapsed "Closed" strip', page, async () => {
  const before = await srvStage('Marketing Campaign');
  await startDrag('Marketing Campaign');
  await page.mouse.move(700, 300, { steps: 6 });
  await page.mouse.move(1250, 300, { steps: 4 });
  const t0 = Date.now();
  await holdAt(1250, 300, 6000, true);
  const s1 = await st();
  const strip = page.locator('button.bcol.collapsed[aria-label^="Expand Closed"]');
  const sb = await strip.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 80, { steps: 6 });
  await settle(sb.x + sb.width / 2, sb.y + 80);
  const s2 = await st();
  await page.mouse.up();
  await L.sleep(900);
  const after = await srvStage('Marketing Campaign');
  const toast = await L.toastsTxt(page);
  const pend = await L.pend(page);
  const left = (await page.locator('.pbcard', { hasText: 'Marketing Campaign' }).count()) === 0;
  const cnt = await page.locator('button.bcol.collapsed[aria-label^="Expand Closed"]').getAttribute('aria-label');
  return {
    pass: s1.sl === s1.max && s2.over.join() === 'Closed, 0 projects' && after === 'closed' && left && !pend.length,
    ev: `reached end in ${Date.now() - t0} ms (scrollLeft ${s1.sl}/${s1.max}); .over on strip=${s2.over}; server stage ${before} -> ${after}; card left Active board=${left}; strip now "${cnt}"; toast=${JSON.stringify(toast)}; pending=${pend.length}; scrollLeft after drop=${(await st()).sl}`,
  };
});
await restore();
await L.sleep(800);

await L.check('a3', 'left edge: holding a drag at the left edge scrolls back', page, async () => {
  await setSL(1860);
  await L.sleep(300);
  // a card visible at max scroll: none under Active except... use the Warranty strip? cards sit in cols 0-5, so scroll partway
  await setSL(1000);
  await L.sleep(300);
  const vis = await page.evaluate(() => {
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    return [...document.querySelectorAll('.pbcard')]
      .filter(c => {
        const r = c.getBoundingClientRect();
        return r.left >= bd.left && r.right <= bd.right;
      })
      .map(c => c.getAttribute('aria-label'));
  });
  if (!vis.length) return { pass: false, ev: 'no fully visible card at scrollLeft 1000' };
  await startDrag(vis[0]);
  await page.mouse.move(600, 300, { steps: 6 });
  await page.mouse.move(284, 300, { steps: 6 });
  const smp = await holdAt(284, 300, 3000, false);
  await page.mouse.move(120, 500, { steps: 3 });
  await page.mouse.up();
  await L.sleep(300);
  return {
    pass: smp[smp.length - 1] < 1000 - 200,
    ev: `dragging "${vis[0]}" held at x=284 (8px inside board left edge): scrollLeft ${smp.join(',')}; end=${(await st()).sl}`,
  };
});

await L.check('a4', 'wheel scrolling during a drag (scroll mid-drag), then drop on a far column', page, async () => {
  await setSL(0);
  await L.sleep(300);
  await startDrag('Product Launch');
  await page.mouse.move(700, 300, { steps: 6 });
  await page.mouse.wheel(500, 0);
  await L.sleep(500);
  const s1 = await st();
  await page.mouse.wheel(500, 0);
  await L.sleep(500);
  const s2 = await st();
  // move onto whatever column is under x=900
  await page.mouse.move(900, 330, { steps: 4 });
  await settle(900, 330);
  const s3 = await st();
  await page.mouse.up();
  await L.sleep(800);
  const toast = await L.toastsTxt(page);
  const after = await srvStage('Product Launch');
  return {
    pass: s2.sl >= 800 && s3.over.length === 1 && after === 'installation' && /Product Launch moved to Installation/.test(toast.join()),
    ev: `wheel x2 mid-drag: scrollLeft 0 -> ${s1.sl} -> ${s2.sl}; over=${s3.over}; drop -> server stage ${after}; toast=${JSON.stringify(toast)}`,
  };
});
await restore();
await L.sleep(800);

await L.check('a5', 'scroll first (wheel), then drag a visible card to a column that was off-screen at the start', page, async () => {
  await setSL(0);
  await L.sleep(300);
  const offBefore = await page.evaluate(() => {
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    const c = document.querySelector('section.bcol[aria-label="Handover"]').getBoundingClientRect();
    return c.left >= bd.right;
  });
  await page.mouse.move(800, 300);
  await page.mouse.wheel(1400, 0);
  await L.sleep(700);
  const s0 = await st();
  const vis = await page.evaluate(() => {
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    const ok = e => {
      const r = e.getBoundingClientRect();
      return r.left >= bd.left && r.right <= bd.right;
    };
    return { card: ok(document.querySelector('.pbcard[aria-label="Design System"]')), tgt: ok(document.querySelector('section.bcol[aria-label="Handover"]')) };
  });
  await startDrag('Design System');
  const tb = await page.locator('section.bcol[aria-label="Handover"]').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 100, { steps: 8 });
  await settle(tb.x + tb.width / 2, tb.y + 100);
  const s1 = await st();
  await page.mouse.up();
  await L.sleep(800);
  const toast = await L.toastsTxt(page);
  const after = await srvStage('Design System');
  const s2 = await st();
  return {
    pass: offBefore && vis.card && vis.tgt && s1.over.join() === 'Handover' && after === 'handover' && s2.sl === s0.sl,
    ev: `Handover was off-screen at scrollLeft 0 (${offBefore}); wheel to ${s0.sl}: card visible=${vis.card}, Handover visible=${vis.tgt}; over=${s1.over}; server stage Design System=${after}; toast=${JSON.stringify(toast)}; scrollLeft after drop ${s2.sl}`,
  };
});
await restore();

// ---- c: scroll retention
await L.check('c1', 'board keeps scrollLeft after a drag-drop move (drop at scrollLeft 1860 in a2/a1: re-checked at mid scroll)', page, async () => {
  await setSL(700);
  await L.sleep(300);
  // pick a card that is fully visible
  const vn = await page.evaluate(() => {
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    const c = [...document.querySelectorAll('.pbcard')].find(c => {
      const r = c.getBoundingClientRect();
      return r.left >= bd.left && r.right <= bd.right;
    });
    return c?.getAttribute('aria-label');
  });
  await startDrag(vn);
  const cols = await page.evaluate(() => {
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    return [...document.querySelectorAll('section.bcol')]
      .map(c => {
        const r = c.getBoundingClientRect();
        return {
          n: c.getAttribute('aria-label'),
          x: r.left + r.width / 2,
          y: r.top + 100,
          ok: r.left >= bd.left && r.right <= bd.right,
          cards: c.querySelectorAll('.pbcard').length,
        };
      })
      .filter(c => c.ok);
  });
  const own = await page.evaluate(n => document.querySelector(`.pbcard[aria-label="${n}"]`).closest('section').getAttribute('aria-label'), vn);
  const tgt = cols.find(c => c.n !== own);
  await page.mouse.move(tgt.x, tgt.y, { steps: 8 });
  await settle(tgt.x, tgt.y);
  const sBefore = await st();
  await page.mouse.up();
  await L.sleep(800);
  const sAfter = await st();
  const toast = await L.toastsTxt(page);
  return {
    pass: sBefore.sl === 700 && sAfter.sl === 700 && /moved to/.test(toast.join()),
    ev: `dragged "${vn}" ${own} -> ${tgt.n} at scrollLeft ${sBefore.sl}; after the re-render scrollLeft=${sAfter.sl}; toast=${JSON.stringify(toast)}`,
  };
});

await restore();
await L.check('c2', 'board keeps scrollLeft after a move through the stage picker (button) at scrollLeft 900', page, async () => {
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
  if (!vn) return { pass: false, ev: 'no visible card at 900' };
  await page.locator('.pbcard', { hasText: vn }).locator('[data-pop="pstage"]').click();
  await L.sleep(300);
  const items = await L.popItems(page);
  await L.popPick(page, 'Warranty');
  await L.sleep(600);
  const s = await st();
  const vis = await page.evaluate(() => {
    const bd = document.querySelector('.pboard').getBoundingClientRect();
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    return { inBoard: !!a.closest('.pboard'), visible: r.left >= bd.left - 1 && r.right <= bd.right + 1, lbl: a.getAttribute('aria-label') };
  });
  return {
    pass: s.sl > 0 && vis.inBoard && vis.visible && /^Move /.test(vis.lbl),
    ev: `[ADAPTED: focus now scrolls the moved card's button into view] picker for "${vn}" items=${items.length}; picked Warranty; scrollLeft after=${s.sl} (was 900); focus=${JSON.stringify(vis)}; toast=${JSON.stringify(await L.toastsTxt(page))}`,
  };
});

await restore();
await L.check('c3', 'board keeps scrollLeft after collapse / expand of a column and after a live change from another client', page, async () => {
  await setSL(1200);
  await L.sleep(300);
  await page.locator('section.bcol[aria-label="Commissioning / SAT"] [data-a="togglePipeCol"]').click();
  await L.sleep(400);
  const s1 = await st();
  await page.locator('button.bcol.collapsed[aria-label^="Expand Commissioning"]').click();
  await L.sleep(400);
  const s2 = await st();
  // another client moves a project: live event re-renders the page
  const rec = await L.pbGet('projects', 'seed000000000p5');
  await L.api('PATCH', '/collections/projects/records/seed000000000p5', { doc: { ...rec.doc, stage: 'commissioning' } });
  await L.sleep(1500);
  const s3 = await st();
  const where = await page.evaluate(() => document.querySelector('.pbcard[aria-label="Design System"]')?.closest('section')?.getAttribute('aria-label'));
  return {
    pass: s1.sl === 1200 && s2.sl === 1200 && s3.sl === 1200 && where === 'Commissioning / SAT',
    ev: `scrollLeft after collapse=${s1.sl}, expand=${s2.sl}, live event (API move of Design System)=${s3.sl}; Design System card now in "${where}"`,
  };
});

// observation: how wide is the auto-scroll zone, and does the page gutter beyond the board count
{
  await restore();
  await setSL(0);
  await startDrag('Marketing Campaign');
  await page.mouse.move(700, 300, { steps: 6 });
  const res = [];
  for (const x of [1226, 1236, 1240, 1245, 1262, 1272, 1279]) {
    const s0 = (await st()).sl;
    await page.mouse.move(x, 300, { steps: 3 });
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(x - (i % 2), 301);
      await L.sleep(150);
    }
    res.push(`${1256 - x}px:${(await st()).sl - s0}`);
    await page.mouse.move(700, 300, { steps: 4 });
    await setSL(0);
    await L.sleep(200);
  }
  await page.mouse.move(120, 500, { steps: 3 });
  await page.mouse.up();
  await L.sleep(300);
  const geo = await page.evaluate(() => {
    const r = document.querySelector('.pboard').getBoundingClientRect();
    return `board ${Math.round(r.left)}..${Math.round(r.right)} of viewport ${innerWidth}`;
  });
  L.note(
    'a6',
    `auto-scroll zone (px from the board's right edge : px scrolled in ~0.9 s): ${res.join('  ')}; ${geo}. Negative distance = pointer in the page gutter beyond the board.`,
  );
}

console.log('console errors:', JSON.stringify(page.errs));
await L.shot(page, 'p2a-final');
await b.close();
