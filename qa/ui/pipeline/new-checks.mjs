// Round-2 independent QA: new checks (a)-(f).
import * as L from './lib.mjs';
const only = (process.env.ONLY || 'a,b,c,d,e,f,x').split(',');
const b = await L.launch();

const SNAP = Object.fromEntries((await L.pbList('projects')).map(p => [p.id, p]));
const restoreProjects = async () => {
  for (const p of await L.pbList('projects')) {
    const s = SNAP[p.id];
    if (JSON.stringify(p.doc) !== JSON.stringify(s.doc)) await L.api('PATCH', '/collections/projects/records/' + p.id, { doc: s.doc });
  }
  await L.sleep(1200);
};
async function fresh(opts = {}, tag = 'adm') {
  const ctx = await L.newCtx(b, opts);
  const page = await L.open(ctx, tag);
  await L.login(page, 'hello@example.com');
  return { ctx, page };
}
const toBoard = async page => {
  await L.goProjects(page);
  await page.locator('.seg button', { hasText: 'Board' }).click();
  await L.sleep(500);
};
const setSL = (page, v) =>
  page.evaluate(v => {
    document.querySelector('.pboard').scrollLeft = v;
  }, v);
const sl = page => page.evaluate(() => Math.round(document.querySelector('.pboard').scrollLeft));
const srvDoc = async id => (await L.pbGet('projects', id)).doc;

// A workspace with any custom set stops using the built-in one, so make two: a copy of the built-in stages (the default) and a second set.
const mkTwoSets = async () => {
  const def = await L.defSet();
  const main = await L.mkSet(
    L.W1,
    'QA main',
    def.stages.map(x => ({ ...x })),
  );
  await L.sleep(1100);
  const second = await L.mkSet(L.W1, 'QA second set', [
    { id: 'alpha', name: 'Alpha', color: 'blue', finished: false },
    { id: 'beta', name: 'Beta', color: 'green', finished: false },
    { id: 'omega', name: 'Omega', color: 'gray', finished: true },
  ]);
  return { main, second };
};
const rmSets = async (...sets) => {
  for (const s of sets)
    await L.api('DELETE', '/collections/stage_sets/records/' + s.id).catch(e => console.log(`WARNING: stage set ${s.id} not deleted: ${e.message}`));
  await L.sleep(600);
};
// what has focus, and is it really visible (not clipped by the board, a column, or the viewport)?
const focusInfo = page =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { body: true };
    const r = a.getBoundingClientRect();
    const bd = a.closest('.pboard') ? document.querySelector('.pboard').getBoundingClientRect() : null;
    const bdAny = document.querySelector('.pboard')?.getBoundingClientRect();
    // the part of the element that is inside the viewport and (if any) the board
    const x0 = Math.max(r.left, 0, bd ? bd.left : 0),
      x1 = Math.min(r.right, innerWidth, bd ? bd.right : innerWidth);
    const y0 = Math.max(r.top, 0, bd ? bd.top : 0),
      y1 = Math.min(r.bottom, innerHeight, bd ? bd.bottom : innerHeight);
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const hit = area > 0 ? document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2) : null;
    const w = r.width * r.height;
    return {
      tag: a.tagName.toLowerCase(),
      label: (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
      k: a.dataset.k,
      v: a.dataset.v,
      pop: a.dataset.pop,
      id: a.dataset.id,
      inPboard: !!a.closest('.pboard'),
      fracVisible: w ? +(area / w).toFixed(2) : 0,
      fullyInBoardX: bdAny ? r.left >= bdAny.left - 1 && r.right <= bdAny.right + 1 : null,
      hit: !!hit && (hit === a || a.contains(hit)),
    };
  });
const fi = o => (o.body ? 'BODY' : `${o.tag}:"${o.label}" visible=${o.fracVisible} hit=${o.hit} xInBoard=${o.fullyInBoardX}`);

// ---------- (a)
if (only.includes('a')) {
  const { ctx, page } = await fresh();
  await toBoard(page);
  await L.check(
    'N-a',
    'keyboard pick of Closed under the Active filter: focus lands on the visible Closed strip (board scrolled to 0 first)',
    page,
    async () => {
      await setSL(page, 0);
      await L.sleep(200);
      const filter = await page.evaluate(() => document.querySelector('select[data-in="projStatus"]')?.value);
      const before = await page.locator('button.bcol.collapsed[aria-label^="Expand Closed"]').getAttribute('aria-label');
      const sBefore = await page.evaluate(() => {
        const bd = document.querySelector('.pboard').getBoundingClientRect();
        const s = document.querySelector('button.bcol.collapsed[aria-label^="Expand Closed"]').getBoundingClientRect();
        return s.left >= bd.left && s.right <= bd.right;
      });
      await page.locator('.pbcard[data-id="seed000000000p3"] [data-pop="pstage"]').focus();
      await page.keyboard.press('Enter');
      await L.sleep(300);
      await page.keyboard.press('End');
      await L.sleep(100);
      let cur = await focusInfo(page),
        steps = 0;
      while (!/Closed/.test(cur.label || '') && steps < 14) {
        await page.keyboard.press('ArrowUp');
        steps++;
        cur = await focusInfo(page);
      }
      await page.keyboard.press('Enter');
      await L.sleep(900);
      const f = await focusInfo(page);
      const s = await sl(page);
      await L.shot(page, 'N-a-focus-closed-strip');
      const gone = (await page.locator('.pbcard[data-id="seed000000000p3"]').count()) === 0;
      const srv = (await srvDoc('seed000000000p3')).stage;
      const after = await page.locator('button.bcol.collapsed[aria-label^="Expand Closed"]').getAttribute('aria-label');
      // the focus is real: Enter on it expands the column
      await page.keyboard.press('Enter');
      await L.sleep(500);
      const expanded = await page.locator('section.bcol[aria-label="Closed"]').count();
      const f2 = await focusInfo(page);
      const pass =
        gone &&
        srv === 'closed' &&
        !f.body &&
        f.tag === 'button' &&
        /^Expand Closed/.test(f.label) &&
        f.fracVisible >= 0.5 &&
        f.hit &&
        f.fullyInBoardX &&
        expanded === 1 &&
        /^Collapse Closed/.test(f2.label || '') &&
        f2.fracVisible >= 0.9 &&
        f2.hit;
      return {
        pass,
        ev: `filter=${filter}; strip before "${before}" fully visible at sl=0: ${sBefore}; picked "${cur.label}"; card left board=${gone}; server stage=${srv}; focus after: ${fi(f)}; scrollLeft 0 -> ${s}; strip now "${after}"; (Active hides finished projects, so the strip counts 0) Enter on it -> Closed column present=${expanded}, focus then ${fi(f2)}`,
      };
    },
  );
  await L.check('N-a2', 'same pick when the Closed strip is already in view (scrollLeft at max): focus still on the strip, no jump back', page, async () => {
    await restoreProjects();
    await page.reload();
    await L.sleep(1800);
    await toBoard(page);
    const mx = await page.evaluate(() => {
      const bd = document.querySelector('.pboard');
      return bd.scrollWidth - bd.clientWidth;
    });
    await setSL(page, mx);
    await L.sleep(200);
    await page
      .locator('.pbcard[data-id="seed000000000p3"] [data-pop="pstage"]')
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    // Marketing Campaign sits at the far left; focus it without scrolling the board
    await page.evaluate(() => document.querySelector('.pbcard[data-id="seed000000000p3"] [data-pop="pstage"]').focus({ preventScroll: true }));
    await setSL(page, mx);
    await page.keyboard.press('Enter');
    await L.sleep(300);
    await page.keyboard.press('End');
    await L.sleep(100);
    let cur = await focusInfo(page),
      steps = 0;
    while (!/Closed/.test(cur.label || '') && steps < 14) {
      await page.keyboard.press('ArrowUp');
      steps++;
      cur = await focusInfo(page);
    }
    await page.keyboard.press('Enter');
    await L.sleep(900);
    const f = await focusInfo(page);
    const s = await sl(page);
    const gone = (await page.locator('.pbcard[data-id="seed000000000p3"]').count()) === 0;
    return {
      pass: gone && /^Expand Closed/.test(f.label || '') && f.fracVisible >= 0.5 && f.hit && s === mx,
      ev: `scrollLeft before=${mx}, after=${s}; focus: ${fi(f)}; card left=${gone}`,
    };
  });
  await L.check(
    'N-a3',
    "Closed expanded already: keyboard pick of Closed under Active puts focus on that column's header collapse button, visible",
    page,
    async () => {
      await restoreProjects();
      await page.reload();
      await L.sleep(1800);
      await toBoard(page);
      await page.locator('button.bcol.collapsed[aria-label^="Expand Closed"]').click();
      await L.sleep(400);
      await setSL(page, 0);
      await L.sleep(200);
      await page.evaluate(() => document.querySelector('.pbcard[data-id="seed000000000p3"] [data-pop="pstage"]').focus({ preventScroll: true }));
      await page.keyboard.press('Enter');
      await L.sleep(300);
      await page.keyboard.press('End');
      await L.sleep(100);
      let cur = await focusInfo(page),
        steps = 0;
      while (!/Closed/.test(cur.label || '') && steps < 14) {
        await page.keyboard.press('ArrowUp');
        steps++;
        cur = await focusInfo(page);
      }
      await page.keyboard.press('Enter');
      await L.sleep(900);
      const f = await focusInfo(page);
      const s = await sl(page);
      return { pass: /^Collapse Closed/.test(f.label || '') && f.fracVisible >= 0.9 && f.hit && s > 0, ev: `scrollLeft 0 -> ${s}; focus: ${fi(f)}` };
    },
  );
  await restoreProjects();
  console.log('a errors:', JSON.stringify(page.errs));
  await ctx.close();
}

// ---------- (b)
if (only.includes('b')) {
  const { ctx, page } = await fresh();
  const { main, second: set } = await mkTwoSets();
  await L.sleep(1500);
  await page.reload();
  await L.sleep(1800);
  await toBoard(page);
  await L.check(
    'N-b',
    'card picker > "Change stage set…" > other set > Alpha (keyboard): card leaves board, focus lands on the Board toggle',
    page,
    async () => {
      await setSL(page, 0);
      const startBtn = page.locator('.pbcard[data-id="seed000000000p3"] [data-pop="pstage"]');
      await startBtn.focus();
      await page.keyboard.press('Enter');
      await L.sleep(300);
      const items0 = await L.popItems(page);
      // Change stage set… is the last item: End, Enter
      await page.keyboard.press('End');
      await L.sleep(100);
      const lab = await focusInfo(page);
      await page.keyboard.press('Enter');
      await L.sleep(300);
      const items1 = await L.popItems(page);
      // pick the other set
      await page.locator('.pop.floating .mi', { hasText: 'QA second set' }).focus();
      await page.keyboard.press('Enter');
      await L.sleep(300);
      const items2 = await L.popItems(page);
      await page.locator('.pop.floating .mi', { hasText: 'Alpha' }).focus();
      await page.keyboard.press('Enter');
      await L.sleep(1000);
      const f = await focusInfo(page);
      const gone = (await page.locator('.pbcard[data-id="seed000000000p3"]').count()) === 0;
      const note = (await page.locator('.pboard').evaluate(el => el.previousElementSibling?.textContent?.trim())) || '';
      const d = await srvDoc('seed000000000p3');
      await L.shot(page, 'N-b-focus-board-toggle');
      const popLeft = await page.locator('.pop.floating').count();
      const inView = await page.evaluate(() => {
        const r = document.activeElement.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      });
      const pass =
        gone &&
        d.stageSet === set.id &&
        d.stage === 'alpha' &&
        !f.body &&
        f.tag === 'button' &&
        f.k === 'projView' &&
        f.v === 'board' &&
        inView &&
        popLeft === 0;
      return {
        pass,
        ev: `picker items=${items0.length} (last focus: "${lab.label}"), sets=${JSON.stringify(items1)}, other-set stages=${JSON.stringify(items2)}; server stageSet=${d.stageSet === set.id ? 'new set' : d.stageSet} stage=${d.stage}; card left board=${gone}; note above board="${note}"; focus: ${fi(f)} k=${f.k} v=${f.v} inViewport=${inView}; stray popover=${popLeft}`,
      };
    },
  );
  // pointer variant, same destination: click through the menus
  await L.check('N-b2', 'same move by mouse (second card, Beta): focus lands on the Board toggle, card gone', page, async () => {
    await page.locator('.pbcard[data-id="seed000000000p2"] [data-pop="pstage"]').click();
    await L.sleep(300);
    await page.locator('.pop.floating .mi', { hasText: 'Change stage set' }).click();
    await L.sleep(300);
    await page.locator('.pop.floating .mi', { hasText: 'QA second set' }).click();
    await L.sleep(300);
    await page.locator('.pop.floating .mi', { hasText: 'Beta' }).click();
    await L.sleep(900);
    const f = await focusInfo(page);
    const gone = (await page.locator('.pbcard[data-id="seed000000000p2"]').count()) === 0;
    const d = await srvDoc('seed000000000p2');
    return {
      pass: gone && d.stageSet === set.id && d.stage === 'beta' && f.k === 'projView' && f.v === 'board',
      ev: `card left=${gone}; server stage=${d.stage} set=${d.stageSet === set.id ? 'new' : d.stageSet}; focus: ${fi(f)} k=${f.k} v=${f.v}`,
    };
  });
  // the board can show the other set: a card in that set picked into one of its columns stays on the board and keeps its button
  await L.check(
    'N-b3',
    'switch the board to the new set, move the card within it by keyboard: the card stays, its own stage button keeps focus (visible)',
    page,
    async () => {
      await page.locator('select[data-in="projBoardSet"]').selectOption(set.id);
      await L.sleep(500);
      const cols = await page.evaluate(() => [...document.querySelectorAll('.bcol')].map(c => c.getAttribute('aria-label')));
      const btn = page.locator('.pbcard[data-id="seed000000000p3"] [data-pop="pstage"]');
      await btn.focus();
      await page.keyboard.press('Enter');
      await L.sleep(300);
      await page.locator('.pop.floating .mi', { hasText: 'Beta' }).focus();
      await page.keyboard.press('Enter');
      await L.sleep(900);
      const f = await focusInfo(page);
      const inCol = await page.evaluate(() => document.querySelector('.pbcard[data-id="seed000000000p3"]')?.closest('section')?.getAttribute('aria-label'));
      return {
        pass: inCol === 'Beta' && f.pop === 'pstage' && f.id === 'seed000000000p3' && f.fracVisible >= 0.9 && f.hit,
        ev: `columns=${JSON.stringify(cols)}; card now in "${inCol}"; focus: ${fi(f)}`,
      };
    },
  );
  await restoreProjects();
  await rmSets(set, main);
  console.log('b errors:', JSON.stringify(page.errs));
  await ctx.close();
}

// ---------- (c)
if (only.includes('c')) {
  const { ctx, page } = await fresh();
  await L.goProj(page, 'seed000000000p1', 'overview');
  const hdrBtn = () => page.locator('.pillbtn[data-pop="pstage"][aria-label^="Project stage"]');
  await L.check('N-c', 'project page: keyboard pick from the header stage picker returns focus to the header stage button', page, async () => {
    const before = await hdrBtn().getAttribute('aria-label');
    await hdrBtn().focus();
    await page.keyboard.press('Enter');
    await L.sleep(300);
    const openFocus = await focusInfo(page);
    let cur = openFocus,
      steps = 0;
    while (!/Procurement/.test(cur.label || '') && steps < 14) {
      await page.keyboard.press('ArrowDown');
      steps++;
      cur = await focusInfo(page);
    }
    await page.keyboard.press('Enter');
    await L.sleep(900);
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        lab: a.getAttribute('aria-label'),
        pop: a.dataset.pop,
        id: a.dataset.id,
        cls: a.className,
        inHeader: !!a.closest('header, .phead, .page-h, .ph'),
        isFirst: a === document.querySelector('[data-pop="pstage"]'),
      };
    });
    const d = await srvDoc('seed000000000p1');
    return {
      pass: d.stage === 'procurement' && f.pop === 'pstage' && f.id === 'seed000000000p1' && /^Project stage: Procurement/.test(f.lab || ''),
      ev: `header "${before}" > picker > picked "${cur.label}"; server stage=${d.stage}; focus: aria-label="${f.lab}" data-pop=${f.pop}; first pstage button on page=${f.isFirst}`,
    };
  });
  await L.check('N-c2', 'project page: mouse pick from the header picker also returns focus to the header stage button', page, async () => {
    await hdrBtn().click();
    await L.sleep(300);
    await L.popPick(page, 'Handover');
    await L.sleep(700);
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      return { lab: a.getAttribute('aria-label'), pop: a.dataset.pop, id: a.dataset.id };
    });
    const d = await srvDoc('seed000000000p1');
    return {
      pass: d.stage === 'handover' && f.pop === 'pstage' && /^Project stage: Handover/.test(f.lab || ''),
      ev: `server stage=${d.stage}; focus: aria-label="${f.lab}" data-pop=${f.pop}; board on page=${await page.locator('.pboard').count()}`,
    };
  });
  await L.check('N-c3', 'project page: health picker still returns focus (On track removes the pill: focus goes to the stage button)', page, async () => {
    const hb = page.locator('[data-pop="phealth"]').first();
    const n = await hb.count();
    if (!n) return { pass: true, ev: 'no health pill on this project (nothing to test)' };
    await hb.click();
    await L.sleep(300);
    await L.popPick(page, 'At risk');
    await L.sleep(600);
    await page.locator('[data-pop="phealth"]').first().click();
    await L.sleep(300);
    await L.popPick(page, 'On track');
    await L.sleep(700);
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        tag: a.tagName.toLowerCase(),
        lab: a.getAttribute('aria-label'),
        txt: a.textContent.trim().slice(0, 30),
        pop: a.dataset.pop,
        body: a === document.body,
        inHeader: !!a.closest('.pillbtn') && !!a.closest('.ph, .phead, header, .page-h'),
        hdrPills: document.querySelectorAll('.pillbtn[data-pop="phealth"]').length,
        allPhealth: document.querySelectorAll('[data-pop="phealth"]').length,
      };
    });
    return {
      pass: !f.body && (f.pop === 'pstage' || f.pop === 'phealth'),
      ev: `[informational: unchanged logic from main] focus after On track: ${JSON.stringify(f)} (not on <body>)`,
    };
  });
  await restoreProjects();
  await L.api('PATCH', '/collections/projects/records/seed000000000p1', { doc: SNAP['seed000000000p1'].doc });
  console.log('c errors:', JSON.stringify(page.errs));
  await ctx.close();
}

// ---------- (d)
if (only.includes('d')) {
  const { ctx, page } = await fresh();
  await L.goProj(page, 'seed000000000p1', 'board');
  const taskSnap = Object.fromEntries((await L.pbList('tasks')).map(t => [t.id, t]));
  const colOf = id => page.evaluate(id => document.querySelector(`.kcard[data-drag-card="${id}"]`)?.closest('[data-drop-col]')?.dataset.dropCol, id);
  const dragTo = async (cardId, col, { release = true } = {}) => {
    const bb = await page.locator(`.kcard[data-drag-card="${cardId}"]`).boundingBox();
    const tb = await page.locator(`[data-drop-col="${col}"]`).boundingBox();
    await page.mouse.move(bb.x + 40, bb.y + 15);
    await page.mouse.down();
    await page.mouse.move(bb.x + 70, bb.y + 25, { steps: 4 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 140, { steps: 10 });
    await page.mouse.move(tb.x + tb.width / 2 + 2, tb.y + 142);
    await L.sleep(250);
    if (release) {
      await page.mouse.up();
      await L.sleep(900);
    }
  };
  await L.check(
    'N-d',
    'task board: drag a task card todo -> progress still moves it; no stray popover, no .dragging/.drop-line left, no console error',
    page,
    async () => {
      const errs0 = page.errs.length;
      const id = await page.evaluate(() => document.querySelector('[data-drop-col="todo"] .kcard')?.dataset.dragCard);
      const before = await colOf(id);
      await dragTo(id, 'progress');
      const after = await colOf(id);
      const srv = (await L.pbGet('tasks', id)).status;
      const leftovers = await page.evaluate(() => ({
        pop: document.querySelectorAll('.pop.floating').length,
        dragging: document.querySelectorAll('.dragging').length,
        line: document.querySelectorAll('.drop-line').length,
        over: document.querySelectorAll('.bcol.drop-over').length,
      }));
      return {
        pass:
          before === 'todo' &&
          after === 'progress' &&
          srv === 'progress' &&
          !leftovers.pop &&
          !leftovers.dragging &&
          !leftovers.line &&
          !leftovers.over &&
          page.errs.length === errs0,
        ev: `${id}: ${before} -> ${after}; server status=${srv}; leftovers=${JSON.stringify(leftovers)}; new console errors=${JSON.stringify(page.errs.slice(errs0))}; toast=${JSON.stringify(await L.toastsTxt(page))}`,
      };
    },
  );
  await L.check(
    'N-d2',
    'task board: a popover open when a task drag starts and ends in no column (cancelled drop) is not left stranded; no error',
    page,
    async () => {
      const errs0 = page.errs.length;
      const id = await page.evaluate(() => document.querySelector('[data-drop-col="review"] .kcard')?.dataset.dragCard);
      // open any floating popover on the page (the board's sort/filter or a card menu), then start the drag
      const trig = page.locator('[data-a="pop"]:visible, [data-pop]:visible').first();
      const trigDesc = await trig.evaluate(e => e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30));
      await trig.click();
      await L.sleep(300);
      const popBefore = await page.locator('.pop.floating').count();
      const bb = await page.locator(`.kcard[data-drag-card="${id}"]`).boundingBox();
      await page.mouse.move(bb.x + 40, bb.y + 15);
      await page.mouse.down();
      await page.mouse.move(bb.x + 70, bb.y + 25, { steps: 4 });
      await page.mouse.move(bb.x + 90, 8, { steps: 6 }); // up in the page header: no column
      await L.sleep(250);
      const popMid = await page.locator('.pop.floating').count();
      await page.mouse.up();
      await L.sleep(700);
      const popAfter = await page.locator('.pop.floating').count();
      const col = await colOf(id);
      const leftovers = await page.evaluate(() => ({
        dragging: document.querySelectorAll('.dragging').length,
        line: document.querySelectorAll('.drop-line').length,
      }));
      await L.shot(page, 'N-d2-after-cancelled-task-drag');
      return {
        pass: popBefore === 1 && popAfter === 0 && col === 'review' && !leftovers.dragging && !leftovers.line && page.errs.length === errs0,
        ev: `trigger "${trigDesc}": popovers before drag=${popBefore}, mid-drag=${popMid}, after drop-nowhere=${popAfter}; card still in ${col}; leftovers=${JSON.stringify(leftovers)}; new console errors=${JSON.stringify(page.errs.slice(errs0))}`,
      };
    },
  );
  await L.check(
    'N-d3',
    'task board: a normal move still works right after the cancelled one (todo -> backlog; the Done column is off-screen at 1280), no stray popover',
    page,
    async () => {
      const id = await page.evaluate(() => document.querySelector('[data-drop-col="todo"] .kcard')?.dataset.dragCard);
      await dragTo(id, 'backlog');
      const after = await colOf(id);
      const srv = (await L.pbGet('tasks', id)).status;
      return {
        pass: after === 'backlog' && srv === 'backlog' && (await page.locator('.pop.floating').count()) === 0,
        ev: `${id} now in ${after}; server=${srv}`,
      };
    },
  );
  for (const [id, t] of Object.entries(taskSnap)) {
    const cur = await L.pbGet('tasks', id);
    if (JSON.stringify(cur.doc) !== JSON.stringify(t.doc) || cur.status !== t.status)
      await L.api('PATCH', '/collections/tasks/records/' + id, { status: t.status, doc: t.doc }).catch(() => {});
  }
  console.log('d errors:', JSON.stringify(page.errs));
  await ctx.close();
}

// ---------- (e)
if (only.includes('e')) {
  const { ctx, page } = await fresh();
  await toBoard(page);
  const upCount = async name => (await L.pbList('files', `project="seed000000000p1"`)).filter(f => f.doc.name === name).length;
  const dropFile = async name => {
    const dt = await page.evaluateHandle(name => {
      const dt = new DataTransfer();
      dt.items.add(new File(['qa round 2 ' + name], name, { type: 'text/plain' }));
      return dt;
    }, name);
    const sel = '.dropzone[data-dropzone="seed000000000p1"]';
    await page.waitForSelector(sel, { timeout: 8000 });
    await page.dispatchEvent(sel, 'dragenter', { dataTransfer: dt });
    await page.dispatchEvent(sel, 'dragover', { dataTransfer: dt });
    const overClass = await page.locator(sel).evaluate(e => e.classList.contains('drop-over'));
    await page.dispatchEvent(sel, 'drop', { dataTransfer: dt });
    await L.sleep(2000);
    return overClass;
  };
  await page.evaluate(() => {
    window.__de = 0;
    document.addEventListener(
      'dragend',
      () => {
        window.__de++;
      },
      true,
    );
  });
  await L.check('N-e0', 'control: file drop onto the Files dropzone uploads (no Board drag before it)', page, async () => {
    await L.goProj(page, 'seed000000000p1', 'files');
    const over = await dropFile('qa-r2-control.txt');
    const n = await upCount('qa-r2-control.txt');
    return {
      pass: n === 1,
      ev: `dropzone got .over=${over}; server file records named qa-r2-control.txt=${n}; toast=${JSON.stringify(await L.toastsTxt(page))}`,
    };
  });
  await L.check('N-e', 'file drop still uploads after a Board pcard drag was cancelled with Escape (in-app navigation, no reload)', page, async () => {
    await toBoard(page);
    const bb = await page.locator('.pbcard[data-id="seed000000000p3"]').boundingBox();
    await page.mouse.move(bb.x + 60, bb.y + 20);
    await page.mouse.down();
    await page.mouse.move(bb.x + 100, bb.y + 30, { steps: 5 });
    await page.mouse.move(bb.x + 400, bb.y + 90, { steps: 6 });
    await L.sleep(300);
    const mid = await page.evaluate(() => ({
      dragging: document.querySelectorAll('.pbcard.dragging').length,
      over: document.querySelectorAll('.bcol.drop-over').length,
    }));
    await page.keyboard.press('Escape');
    await L.sleep(300);
    const deAtEsc = await page.evaluate(() => window.__de);
    await page.mouse.up();
    await L.sleep(600);
    const afterEsc = await page.evaluate(() => ({
      dragend: window.__de,
      dragging: document.querySelectorAll('.dragging').length,
      over: document.querySelectorAll('.bcol.drop-over').length,
      pop: document.querySelectorAll('.pop.floating').length,
    }));
    const stage = (await srvDoc('seed000000000p3')).stage;
    await L.goProj(page, 'seed000000000p1', 'files');
    const over = await dropFile('qa-r2-after-escape.txt');
    const n = await upCount('qa-r2-after-escape.txt');
    return {
      pass: stage === 'tender' && deAtEsc >= 1 && afterEsc.dragend >= 1 && afterEsc.dragging === 0 && n === 1,
      ev: `mid-drag ${JSON.stringify(mid)}; dragend events right after Escape (before mouse-up)=${deAtEsc}; after Escape: ${JSON.stringify(afterEsc)}; card server stage=${stage} (unchanged=tender); dropzone .over=${over}; uploaded records=${n}; toast=${JSON.stringify(await L.toastsTxt(page))}`,
    };
  });
  // sensitivity: if dragend never came (stale DRAG), a file drop would be swallowed
  await L.check('N-e1', 'sensitivity control: with a pcard dragstart and NO dragend, the same file drop is swallowed (shows N-e can fail)', page, async () => {
    await toBoard(page);
    await page.evaluate(() => {
      const c = document.querySelector('.pbcard');
      c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
    });
    await L.goProj(page, 'seed000000000p1', 'files');
    await dropFile('qa-r2-stale.txt');
    const stale = await upCount('qa-r2-stale.txt');
    // recover: a real dragend, then it works
    await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true })));
    await dropFile('qa-r2-stale2.txt');
    const ok = await upCount('qa-r2-stale2.txt');
    return { pass: stale === 0 && ok === 1, ev: `with stale drag state: uploads=${stale} (expected 0); after a dragend: uploads=${ok} (expected 1)` };
  });
  for (const f of await L.pbList('files', `project="seed000000000p1"`))
    if (/^qa-r2-/.test(f.doc.name)) await L.api('DELETE', '/collections/files/records/' + f.id).catch(() => {});
  await restoreProjects();
  console.log('e errors:', JSON.stringify(page.errs));
  await ctx.close();
}

// ---------- (f)
if (only.includes('f')) {
  const { main, second: set } = await mkTwoSets();
  for (const dark of [false, true]) {
    for (const w of [390, 768, 1024, 1440]) {
      const { ctx, page } = await fresh({ w, h: w < 700 ? 844 : 900, dark }, 'w' + w);
      await toBoard(page);
      await L.sleep(300);
      const measure = async () => {
        const m = await page.evaluate(() => {
          const de = document.documentElement,
            bd = document.body;
          const before = window.scrollX;
          window.scrollTo(300, 0);
          const sx = window.scrollX;
          window.scrollTo(before, 0);
          const pb = document.querySelector('.pboard');
          const wide = [...document.querySelectorAll('body *')]
            .filter(e => {
              const r = e.getBoundingClientRect();
              return r.right > innerWidth + 1 && !e.closest('.pboard') && getComputedStyle(e).position !== 'fixed' && r.width > 0;
            })
            .slice(0, 3)
            .map(e => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 30));
          return {
            iw: innerWidth,
            deSW: de.scrollWidth,
            deCW: de.clientWidth,
            bodySW: bd.scrollWidth,
            sx,
            boardSW: pb?.scrollWidth,
            boardCW: pb?.clientWidth,
            wide,
            cols: document.querySelectorAll('.pboard > .bcol').length,
          };
        });
        return m;
      };
      await L.check(`N-f-${w}${dark ? 'd' : ''}`, `Board at ${w}px (${dark ? 'dark' : 'light'}): no page-level horizontal scroll`, page, async () => {
        const m1 = await measure('base');
        await L.shot(page, `N-f-${w}${dark ? '-dark' : ''}`);
        // expand the finished strips too (widest board)
        for (const n of ['Closed', 'Cancelled', 'Lost tender']) {
          const s = page.locator(`button.bcol.collapsed[aria-label^="Expand ${n}"]`);
          if (await s.count()) {
            await s.click();
            await L.sleep(200);
          }
        }
        const m2 = await measure('expanded');
        // two sets: toolbar gets a "Stage set" select
        const withSel = await page.locator('select[data-in="projBoardSet"]').count();
        const ok = m => m.deSW <= m.deCW && m.bodySW <= m.iw && m.sx === 0;
        return {
          pass: ok(m1) && ok(m2),
          ev: `base: docScrollW=${m1.deSW}/clientW=${m1.deCW}, bodySW=${m1.bodySW}, scrollX after scrollTo(300)=${m1.sx}, board ${m1.boardSW}/${m1.boardCW} (${m1.cols} cols); all strips expanded: docScrollW=${m2.deSW}/${m2.deCW}, bodySW=${m2.bodySW}, sx=${m2.sx}, board ${m2.boardSW}/${m2.boardCW}; set select present=${withSel}; overflowing non-board elements=${JSON.stringify(m1.wide.concat(m2.wide))}`,
        };
      });
      await ctx.close();
    }
  }
  await rmSets(set, main);
}
await restoreProjects();
await b.close();
