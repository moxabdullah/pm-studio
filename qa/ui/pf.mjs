// Pipeline follow-ups (fix/pipeline-followups): 1 pickerClosed reset per drag, 2 the drag highlight is "drop-over" (the overdue "over" is
// left alone), 3 a stage or health pick from the Details panel returns focus there, 4 the phone sidebar is out of the Tab order while closed
// and modal while open. Round 2 (section R, PF_ONLY=R): R1 tryFocus tries every match, R2 a dialog over the open sidebar, R3 the palette
// shuts the sidebar, R4 the sidebar is never the collapsed rail, R5 a Close navigation button, R6 no slide (F4g1 is replaced by R6a).
// Round 3 (section T, PF_ONLY=T): T1 crossing 900 px keeps what is being typed (and T4 the focus), T2 Ctrl+K over a dialog from the sidebar,
// T3 "[" at sidebar width, T5 the Close button's size, T6 the task panel behind the open sidebar.
// Round 4 (section U, PF_ONLY=U): U1 crossing 900 px puts the shell right at once, U2 Esc closes a dialog before what is hidden under the
// sidebar, U3 Tab stays in the open sidebar (toasts, the panel), U4 a crossing leaves focus behind a dialog alone, U5 no "Toggle sidebar" at
// sidebar width, U6 one 900 px breakpoint in go().
import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
const { sleep } = H;
const check = L.check;
const only = process.env.PF_ONLY || ''; // e.g. PF_ONLY=3 runs one section
const want = n => !only || only.split(',').includes(String(n));
await L.suLogin();
const P = n => H.P(n);
const b = await L.launch();
// a step that cannot be done (a control that is not on the page) is a failed check, not the end of the suite
const attempt = async (id, name, page, fn) => {
  try {
    await fn();
  } catch (e) {
    await check(id, name, page, async () => ({ pass: false, ev: 'step failed: ' + String(e).split('\n')[0].slice(0, 140) }));
  }
};
const note_ = (id, t) => L.note(id, t);
const goP = async (page, pid, tab = 'overview') => {
  await page.evaluate(([i, t]) => window.__pmspace.go('project', { id: i, tab: t }), [pid, tab]);
  await sleep(600);
};

// ---- 1 and 2: drag and drop (synthetic DragEvents with one DataTransfer for the drag; the page's own handlers do the rest)
const dnd = {
  start: (page, sel) =>
    page.evaluate(s => {
      window.__dt = new DataTransfer();
      document.querySelector(s).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    }, sel),
  over: (page, sel, y) =>
    page.evaluate(
      ([s, yy]) => {
        const el = document.querySelector(s);
        const r = el.getBoundingClientRect();
        el.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: window.__dt,
            clientX: r.left + r.width / 2,
            clientY: yy ?? r.top + r.height / 2,
          }),
        );
      },
      [sel, y],
    ),
  drop: (page, sel) =>
    page.evaluate(s => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.left + 5, clientY: r.top + 5 }));
    }, sel),
  end: (page, sel) =>
    page.evaluate(s => {
      document.querySelector(s).dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    }, sel),
};
// the overdue labels the page has, with their class and colour; probes are real classes (.due.over, .pillbtn.over) added to a page that has none
const overdue = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.due, .pillbtn, [data-probe]')]
      .filter(e => e.classList.contains('over') || e.dataset.probe)
      .map(e => ({ cls: e.classList.contains('over'), color: getComputedStyle(e).color, probe: !!e.dataset.probe })),
  );
const addProbes = page =>
  page.evaluate(() => {
    const c = document.querySelector('.content');
    c.insertAdjacentHTML(
      'beforeend',
      '<div id="probes"><span class="due over" data-probe="due">Yesterday</span><button class="pillbtn over" data-probe="pill">Oct 1</button></div>',
    );
  });
const dropOvers = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.drop-over')].map(
      e => e.className.split(' ')[0] + (e.dataset.dropCol ? ':col' : e.dataset.dropDay ? ':day' : e.dataset.dropStage ? ':stage' : ''),
    ),
  );
const redOf = page =>
  page.evaluate(() => {
    const t = document.createElement('i');
    t.style.color = 'var(--red)';
    document.body.appendChild(t);
    const c = getComputedStyle(t).color;
    t.remove();
    return c;
  });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (want(1) || want(2)) {
  await H.setProjectValues(P(2), { stage: 'fat' });
  const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 'f12');
  const RED = await redOf(A);

  // ---- 1. pickerClosed is cleared by every dragstart
  if (want(1)) {
    await goP(A, P(1), 'board');
    const popOpen = async () => {
      await A.locator('.kcard [data-a="pop"]').first().scrollIntoViewIfNeeded();
      await A.locator('.kcard [data-a="pop"]').first().click();
      await sleep(300);
      return A.evaluate(() => !!window.__pmspace.S.ui.pop);
    };
    const probe = page =>
      page.evaluate(() => {
        const p = document.createElement('i');
        p.id = 'render-probe';
        document.getElementById('app').appendChild(p);
      });
    const probed = page => page.evaluate(() => !!document.getElementById('render-probe'));
    // a drag from the app whose dragend was lost (the drop's render detached the dragged card), then a drag of text
    const opened = await popOpen();
    await dnd.start(A, '[data-drag-card]');
    const popGone = await A.evaluate(() => !window.__pmspace.S.ui.pop && !document.querySelector('.pop.floating'));
    await probe(A);
    await A.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'plain-text';
      p.textContent = 'some text';
      document.getElementById('app').appendChild(p);
    });
    await dnd.start(A, '#plain-text'); // a native drag of text: no [data-drag-*] ancestor, returns early
    await dnd.end(A, '#plain-text');
    await check('F1a', `a native drag (text) after a drag whose dragend was lost: its dragend does not redraw the page`, A, async () => ({
      pass: opened && popGone && (await probed(A)),
      ev: { opened, popGone, probeSurvived: await probed(A) },
    }));
    // control: the drag that closed the picker draws once, at its own dragend (unchanged)
    await goP(A, P(1), 'board');
    const opened2 = await popOpen();
    await dnd.start(A, '[data-drag-card]');
    await probe(A);
    await dnd.end(A, '[data-drag-card]');
    await check('C1b', `control: the dragend of the drag that closed a picker still draws once`, A, async () => ({
      pass: opened2 && !(await probed(A)),
      ev: { opened2, probeSurvived: await probed(A) },
    }));
    // control: a second dragend does not draw again
    await probe(A);
    await dnd.start(A, '#app');
    await dnd.end(A, '#app');
    await check('C1c', `control: a drag with no picker open and its dragend draw nothing`, A, async () => ({
      pass: await probed(A),
      ev: { probeSurvived: await probed(A) },
    }));
  }

  // ---- 2. drop-over, and the overdue "over" left alone
  if (want(2)) {
    // task Board
    await goP(A, P(1), 'board');
    const o0 = await overdue(A);
    const card = '[data-drag-card]';
    const cols = await A.$$eval('[data-drop-col]', es => es.map(e => e.dataset.dropCol));
    const target = `[data-drop-col="${cols[cols.length - 1]}"]`,
      target2 = `[data-drop-col="${cols[1]}"]`;
    await dnd.start(A, card);
    await dnd.over(A, target);
    await sleep(300); // (the highlight fades in)
    const d1 = await dropOvers(A);
    const o1 = await overdue(A);
    const hl = await A.evaluate(s => {
      const e = document.querySelector(s);
      const o = [...document.querySelectorAll('[data-drop-col]')].find(x => x !== e);
      return { hi: getComputedStyle(e).borderTopColor, lo: getComputedStyle(o).borderTopColor };
    }, target);
    await dnd.over(A, target2);
    const d2 = await dropOvers(A);
    await check(
      'F2a1',
      `task Board, dragging over a column: exactly that column has drop-over (and moves to the next column with the pointer), with its highlight style`,
      A,
      async () => ({ pass: same(d1, ['bcol:col']) && same(d2, ['bcol:col']) && hl.hi !== hl.lo, ev: { d1, d2, hl } }),
    );
    // (the copied seed this suite came from had two overdue labels on this board; seed:dev has one, which is enough to see the class and the colour kept)
    await check(
      'C2a2',
      `control (the bug is at dragend): task Board, while dragging over a column, the overdue labels keep their class and red`,
      A,
      async () => ({ pass: o0.length >= 1 && same(o0, o1) && o0.every(x => x.cls && x.color === RED), ev: { o0, o1 } }),
    );
    await dnd.end(A, card);
    const d3 = await dropOvers(A);
    const o2 = await overdue(A);
    await check('F2a3', `task Board, a drag that ends without a drop: no drop-over is left, the overdue labels keep their class and red`, A, async () => ({
      pass: d3.length === 0 && same(o0, o2),
      ev: { d3, o0, o2 },
    }));
    // a real drop
    await dnd.start(A, card);
    await dnd.over(A, target);
    await dnd.drop(A, target);
    await sleep(500);
    const d4 = await dropOvers(A);
    const o3 = await overdue(A);
    await check('C2a4', `control (the drop's render redraws): task Board, after a drop no drop-over is left and the overdue labels are red`, A, async () => ({
      pass: d4.length === 0 && o3.length >= 1 && o3.every(x => x.cls && x.color === RED),
      ev: { d4, o3 },
    }));
    await dnd.end(A, card);
    await sleep(300);

    // calendar, month grid then week columns
    for (const [mode, hiSel] of [
      ['month', '.cday'],
      ['week', '.wcol-b'],
    ]) {
      await A.evaluate(m => {
        window.__pmspace.S.ui.calMode = m;
        window.__pmspace.go('calendar');
        window.__pmspace.S.ui.calMode = m;
        window.__pmspace.render();
      }, mode);
      await sleep(700);
      const days = await A.$$eval('[data-drop-day]', es => es.map(e => e.dataset.dropDay));
      const dayOf = i => `[data-drop-day="${days[i]}"]`;
      const evSel = '[data-drag-cal]';
      await addProbes(A);
      const p0 = await overdue(A);
      await dnd.start(A, evSel);
      const k = mode === 'month' ? 8 : 2;
      await dnd.over(A, dayOf(k));
      await sleep(300); // (the highlight fades in)
      const c1 = await dropOvers(A);
      const p1 = await overdue(A);
      const hl2 = await A.evaluate(s => getComputedStyle(document.querySelector(s)).backgroundColor, dayOf(k));
      const nohl = await A.evaluate(s => getComputedStyle(document.querySelector(s)).backgroundColor, dayOf(k + 1));
      await dnd.over(A, dayOf(k + 1));
      const c2 = await dropOvers(A);
      await check(
        `F2b1-${mode}`,
        `calendar (${mode}), dragging over a day: exactly that day has drop-over and moves with the pointer, with its highlight style`,
        A,
        async () => ({ pass: c1.length === 1 && c1[0].startsWith(hiSel.slice(1)) && c2.length === 1 && hl2 !== nohl, ev: { c1, c2, hl2, nohl } }),
      );
      await check(`F2b2-${mode}`, `calendar (${mode}), dragging over a day: overdue labels (a due and a pill) keep their class and red`, A, async () => ({
        pass: p0.length === 2 && same(p0, p1) && p0.every(x => x.cls && x.color === RED),
        ev: { p0, p1 },
      }));
      await dnd.end(A, evSel);
      const c3 = await dropOvers(A);
      const p2 = await overdue(A);
      await check(
        `F2b3-${mode}`,
        `calendar (${mode}), a drag that ends without a drop: no drop-over left, the overdue labels keep class and red`,
        A,
        async () => ({ pass: c3.length === 0 && same(p0, p2), ev: { c3, p0, p2 } }),
      );
      await dnd.start(A, evSel);
      await dnd.over(A, dayOf(k + 2));
      await dnd.drop(A, dayOf(k + 2));
      await sleep(500);
      const c4 = await dropOvers(A);
      await check(`C2b4-${mode}`, `control: calendar (${mode}), after a drop on a day no drop-over is left`, A, async () => ({
        pass: c4.length === 0,
        ev: c4,
      }));
      await dnd.end(A, evSel);
    }

    // projects Board
    await H.goProjects(A, 'board');
    await addProbes(A);
    const q0 = await overdue(A);
    const pc = `[data-drag-pcard="${P(2)}"]`;
    const stages = await A.$$eval('[data-drop-stage]', es => es.map(e => [e.dataset.dropStage, e.dataset.set]));
    const tgtStage = stages.find(([st]) => st === 'closed') || stages[stages.length - 1];
    const tsel = `[data-drop-stage="${tgtStage[0]}"][data-set="${tgtStage[1]}"]`;
    await dnd.start(A, pc);
    await dnd.over(A, tsel);
    const e1 = await dropOvers(A);
    const q1 = await overdue(A);
    await check('F2c1', `projects Board, dragging over a column: exactly that column has drop-over`, A, async () => ({
      pass: same(e1, ['bcol:stage']),
      ev: e1,
    }));
    await check('C2c2', `control (the bug is at dragend): projects Board, while dragging, overdue labels keep their class and red`, A, async () => ({
      pass: q0.length === 2 && same(q0, q1) && q0.every(x => x.cls && x.color === RED),
      ev: { q0, q1 },
    }));
    await dnd.end(A, pc);
    const e2 = await dropOvers(A),
      q2 = await overdue(A);
    await check('F2c3', `projects Board, a drag that ends without a drop: no drop-over left, the overdue labels keep class and red`, A, async () => ({
      pass: e2.length === 0 && same(q0, q2),
      ev: { e2, q0, q2 },
    }));
    await dnd.start(A, pc);
    await dnd.over(A, tsel);
    await dnd.drop(A, tsel);
    await sleep(600);
    const e3 = await dropOvers(A);
    await dnd.end(A, 'body');
    await H.setProjectValues(P(2), { stage: 'fat' });
    await check('C2c4', `control: projects Board, after a drop no drop-over is left`, A, async () => ({ pass: e3.length === 0, ev: e3 }));

    // files: the drop zone (a drag that carries a file)
    await goP(A, P(1), 'files');
    const fover = type =>
      A.evaluate(
        ([t, sel]) => {
          const dt = new DataTransfer();
          dt.items.add(new File(['x'], 'a.txt'));
          const el = document.querySelector(sel);
          el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: null }));
        },
        [type, '[data-dropzone]'],
      );
    await fover('dragover');
    const f1 = await A.evaluate(() => {
      const e = document.querySelector('[data-dropzone]');
      return { drop: e.classList.contains('drop-over'), bg: getComputedStyle(e).backgroundColor, border: getComputedStyle(e).borderTopColor };
    });
    await fover('dragleave');
    const f2 = await A.evaluate(() => {
      const e = document.querySelector('[data-dropzone]');
      return { drop: e.classList.contains('drop-over'), bg: getComputedStyle(e).backgroundColor };
    });
    await check('F2d', `files drop zone, a file dragged over it: drop-over with its highlight style, gone when the drag leaves`, A, async () => ({
      pass: f1.drop && f1.bg !== f2.bg && !f2.drop,
      ev: { f1, f2 },
    }));
  }
  await A.ctx.close();
}

// ---- 3. Details panel pickers
if (want(3)) {
  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ]) {
    // the data the section needs, written before the page loads (a run changes it)
    await H.setProjectValues(P(1), { health: 'risk', stage: 'design' });
    await H.setProjectValues(P(2), { stage: 'fat' });
    const A = await H.mkPage(b, 'hello@example.com', w, h, 'f3-' + w);
    const tag = `${w}px`;
    // where focus is, structurally: the Details button, the header button, or neither
    const where = () =>
      A.evaluate(() => {
        const a = document.activeElement;
        const det = n => document.querySelector(`.kv [data-pop="${n}"]`);
        const hdr = n => document.querySelector(`.proj-h [data-pop="${n}"]`);
        return {
          inDetailsStage: a === det('pstage'),
          inDetailsHealth: a === det('phealth'),
          inHeaderStage: a === hdr('pstage'),
          inHeaderHealth: a === hdr('phealth'),
          body: a === document.body,
          id: a?.id || '',
          tag: a?.tagName,
          pop: !!window.__pmspace.S.ui.pop,
        };
      });
    const openDet = async n => {
      const el = A.locator(`.kv [data-pop="${n}"]`);
      await el.scrollIntoViewIfNeeded();
      await sleep(200);
      await el.focus();
      await A.keyboard.press('Enter');
      await sleep(350);
    };
    await goP(A, P(1));
    // stage picked from the Details button
    await openDet('pstage');
    await A.locator('.pop .mi', { hasText: /^\s*Procurement\s*$/ })
      .first()
      .click();
    await sleep(500);
    let w1 = await where();
    await check(`F3a-${tag}`, `a stage picked from the Details button: focus is on the Details stage button`, A, async () => ({
      pass: w1.inDetailsStage && !w1.inHeaderStage,
      ev: w1,
    }));
    // Esc from the Details stage picker
    await openDet('pstage');
    const open1 = await where();
    await A.keyboard.press('Escape');
    await sleep(400);
    w1 = await where();
    await check(`F3b-${tag}`, `Esc from the Details stage picker: focus is on the Details stage button`, A, async () => ({
      pass: open1.pop && w1.inDetailsStage && !w1.inHeaderStage,
      ev: { open: open1.pop, ...w1 },
    }));
    // health set to On track from the Details button: the header pill goes away, the Details button stays
    const hdrBefore = await A.locator('.proj-h [data-pop="phealth"]').count();
    await openDet('phealth');
    await A.locator('.pop .mi', { hasText: /^\s*On track\s*$/ })
      .first()
      .click();
    await sleep(500);
    const hdrAfter = await A.locator('.proj-h [data-pop="phealth"]').count();
    w1 = await where();
    await check(
      `C3c-${tag}`,
      `control (on main the header pill's going away makes it work by accident): health set to On track from the Details button, focus is on the Details health button`,
      A,
      async () => ({ pass: hdrBefore === 1 && hdrAfter === 0 && w1.inDetailsHealth, ev: { hdrBefore, hdrAfter, ...w1 } }),
    );
    // health set to On hold from the Details button: the header gets a pill, which comes first in the page
    await openDet('phealth');
    await A.locator('.pop .mi', { hasText: /^\s*On hold\s*$/ })
      .first()
      .click();
    await sleep(500);
    const hdrHold = await A.locator('.proj-h [data-pop="phealth"]').count();
    w1 = await where();
    await check(
      `F3f-${tag}`,
      `health set to On hold from the Details button (the header gets a pill, before it in the page): focus is on the Details health button`,
      A,
      async () => ({ pass: hdrHold === 1 && w1.inDetailsHealth && !w1.inHeaderHealth, ev: { hdrHold, ...w1 } }),
    );
    // a stage picked from the header button: focus on the header stage button
    const hs = A.locator('.proj-h [data-pop="pstage"]');
    await hs.scrollIntoViewIfNeeded();
    await sleep(200);
    await hs.focus();
    await A.keyboard.press('Enter');
    await sleep(350);
    await A.locator('.pop .mi', { hasText: /^\s*Design\s*$/ })
      .first()
      .click();
    await sleep(500);
    w1 = await where();
    await check(`C3d-${tag}`, `control: a stage picked from the header button, focus is on the header stage button`, A, async () => ({
      pass: w1.inHeaderStage && !w1.inDetailsStage,
      ev: w1,
    }));
    // the Projects page Board: the .pmove card button, as before (the card's own stage button, or the column it went to)
    await H.goProjects(A, 'board');
    const mv = A.locator(`.pboard .pmove[data-id="${P(2)}"]`);
    await mv.scrollIntoViewIfNeeded();
    await sleep(200);
    await mv.focus();
    await A.keyboard.press('Enter');
    await sleep(350);
    await A.locator('.pop .mi', { hasText: /^\s*Tender\s*$/ })
      .first()
      .click();
    await sleep(600);
    const pb = await A.evaluate(id => {
      const a = document.activeElement;
      const own = document.querySelector(`.pboard [data-pop="pstage"][data-id="${id}"]`);
      return { onOwn: a === own, inBoard: !!a?.closest('.pboard'), cls: a?.className, a: a?.dataset?.a, body: a === document.body };
    }, P(2));
    await check(`C3e-${tag}`, `control: Projects page Board, after Move focus is on the card's own stage button (focusMoved, unchanged)`, A, async () => ({
      pass: pb.onOwn || (pb.inBoard && !pb.body),
      ev: pb,
    }));
    await A.ctx.close();
  }
}

// ---- 4. the phone sidebar
// where focus is: the tab-walk helper of the sidebar probe
const describe = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { body: true };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const inter = r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0;
  const cont = el.closest('nav.side')
    ? 'side'
    : el.closest('.bottomnav')
      ? 'bottomnav'
      : el.classList.contains('skip')
        ? 'skip'
        : el.closest('.topbar')
          ? 'topbar'
          : el.closest('main#main')
            ? 'main'
            : 'other';
  const txt = (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return {
    cont,
    id: el.id,
    a: el.dataset.a || '',
    r: el.dataset.r || '',
    txt,
    onscreen: inter && cs.visibility === 'visible' && cs.display !== 'none',
    inSide: !!el.closest('nav.side'),
  };
};
const tabs = async (page, n, key = 'Tab') => {
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    await sleep(30);
    out.push(await page.evaluate(describe));
  }
  return out;
};
// stop 0 is the skip link, focused (a blur() alone leaves Chrome's starting point for Tab where the last focus was); the page is not scrolled
const walkFromTop = async (page, n) => {
  await page.evaluate(() => {
    document.querySelector('.skip').focus({ preventScroll: true });
  });
  const f = await page.evaluate(describe);
  return [f, ...(await tabs(page, n - 1))];
};
// no focus set: the first Tab of a page nothing has been focused on
const walkNatural = async (page, n) => {
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  return tabs(page, n);
};
const key = e => `${e.dataset.a || ''}|${e.dataset.r || ''}|${(e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)}`;
const sideTabbables = page =>
  page.evaluate(
    k =>
      [...document.querySelectorAll('nav.side button:not([disabled]), nav.side [tabindex]:not([tabindex="-1"]), nav.side a[href]')]
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && getComputedStyle(e).visibility === 'visible' && e.tabIndex >= 0;
        })
        .map(new Function('return ' + k)()),
    String(key),
  );
const st = page =>
  page.evaluate(() => ({
    mnav: window.__pmspace.S.ui.mnav,
    inert: [...document.querySelectorAll('[inert]')].map(e => e.className.split(' ')[0] || e.tagName.toLowerCase()),
    side: (() => {
      const e = document.querySelector('nav.side');
      const r = e.getBoundingClientRect();
      return { vis: getComputedStyle(e).visibility, left: Math.round(r.left), w: Math.round(r.width) };
    })(),
  }));
const activeIs = (page, sel) => page.evaluate(s => document.activeElement === document.querySelector(s), sel);
const goH = async (page, r, p) => {
  await page.evaluate(([a, b]) => window.__pmspace.go(a, b), [r, p || {}]);
  await sleep(600);
};
const blur = page => page.evaluate(() => document.activeElement?.blur());
if (want(4)) {
  const A = await H.mkPage(b, 'hello@example.com', 390, 844, 'f4');
  A.setDefaultTimeout(4000);
  // closed: no Tab stop inside the sidebar, on Home and on a project page
  for (const [tag, go] of [
    ['home', () => goH(A, 'home')],
    ['project', () => goP(A, P(1))],
  ]) {
    await go();
    const w = await walkNatural(A, 30);
    const ids = w.map(x => (x.body ? 'body' : x.id || x.cont));
    const firstMain = w.findIndex(x => x.cont === 'main');
    const topbarBlock = w.slice(1, firstMain).every(x => x.cont === 'topbar');
    await check(
      `F4a-${tag}`,
      `closed, ${tag}, 390 px: no Tab stop inside the sidebar; stop 1 is the skip link, then the top bar (#mnav-btn first), then main`,
      A,
      async () => ({
        pass: w.every(x => !x.inSide) && w[0].cont === 'skip' && w[1].id === 'mnav-btn' && firstMain > 1 && topbarBlock,
        ev: { sideStops: w.filter(x => x.inSide).length, first: ids.slice(0, 6), firstMain },
      }),
    );
  }
  await goH(A, 'home');
  const expect = await (async () => {
    await A.click('#mnav-btn');
    await sleep(400);
    const c = await sideTabbables(A);
    await A.keyboard.press('Escape');
    await sleep(300);
    return c;
  })();
  const n = expect.length;
  // open with Enter on the toggle
  await blur(A);
  await A.focus('#mnav-btn');
  await A.keyboard.press('Enter');
  await sleep(400);
  const o0 = await A.evaluate(describe);
  const o1 = await st(A);
  const first = await A.evaluate(() => {
    const e = document.querySelector('nav.side');
    const f = e.querySelector('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    return f === document.activeElement;
  });
  await check('F4b1', `open with Enter on #mnav-btn: focus is on the first control of the sidebar`, A, async () => ({
    pass: o0.inSide && first && o1.mnav && o1.side.vis === 'visible' && o1.side.left === 0,
    ev: { o0, side: o1.side },
  }));
  await check('F4b2', `open: the skip link, the page and the bottom nav are inert, and the scrim is not`, A, async () => ({
    pass: ['skip', 'main', 'bottomnav'].every(c => o1.inert.includes(c)) && !o1.inert.includes('side-scrim') && !o1.inert.includes('side'),
    ev: o1.inert,
  }));
  // the first control has focus (stop 0); Tab n-1 times more reaches the last, and the stops past it leave the document (body) or wrap into the sidebar again
  const w2 = [o0, ...(await tabs(A, n - 1))];
  const past = await tabs(A, 4);
  const got = w2.map(x => `${x.a}|${x.r}|${x.txt}`);
  const stray = [...w2, ...past].filter(x => !x.body && !x.inSide);
  await check(
    'F4b3',
    `open: forward Tab walks the ${n} sidebar controls in DOM order, and no stop (the ${past.length} past the last included) lands in the page, the bottom nav or the skip link`,
    A,
    async () => ({
      pass: n > 8 && got.join('\n') === expect.map(e => e.replace(/\s+/g, ' ')).join('\n') && w2.every(x => x.inSide && x.onscreen) && stray.length === 0,
      ev: { n, stray: stray.map(x => x.id || x.cont), firstDiff: got.findIndex((g, i) => g !== expect[i]), past: past.map(x => (x.body ? 'body' : x.cont)) },
    }),
  );
  // Esc after Tab: back on the toggle
  await A.keyboard.press('Escape');
  await sleep(400);
  const e1 = await st(A);
  await check('F4c1', `Esc (after a Tab in the sidebar): the sidebar closes and focus is on #mnav-btn`, A, async () => ({
    pass: !e1.mnav && (await activeIs(A, '#mnav-btn')) && e1.inert.length === 0,
    ev: { ...e1, active: await A.evaluate(describe) },
  }));
  // opened from More: Esc returns to More
  await attempt('F4c2', `opened from the bottom nav's More: focus enters the sidebar, and Esc returns it to More`, A, async () => {
    await blur(A);
    await A.focus('#mnav-more');
    await A.keyboard.press('Enter');
    await sleep(400);
    const m0 = await A.evaluate(describe);
    await A.keyboard.press('Tab');
    await sleep(50);
    await A.keyboard.press('Escape');
    await sleep(400);
    const m1 = await st(A);
    await check('F4c2', `opened from the bottom nav's More: focus enters the sidebar, and Esc returns it to More`, A, async () => ({
      pass: m0.inSide && !m1.mnav && (await activeIs(A, '#mnav-more')),
      ev: { m0, active: await A.evaluate(describe) },
    }));
  });
  // the scrim: from the toggle, and from More
  for (const [tag, openSel, how] of [
    ['toggle', '#mnav-btn', 'click'],
    ['More', '#mnav-more', 'enter'],
  ]) {
    await attempt(
      `F4c3-${tag}`,
      `a tap on the scrim (opened from ${tag}): the sidebar closes, nothing inert is left, focus returns to the opener`,
      A,
      async () => {
        await blur(A);
        if (how === 'click') await A.click(openSel);
        else {
          await A.focus(openSel);
          await A.keyboard.press('Enter');
        }
        await sleep(400);
        await A.mouse.click(350, 420);
        await sleep(400);
        const s1 = await st(A);
        await check(
          `F4c3-${tag}`,
          `a tap on the scrim (opened from ${tag}): the sidebar closes, nothing inert is left, focus returns to the opener`,
          A,
          async () => ({ pass: !s1.mnav && s1.inert.length === 0 && (await activeIs(A, openSel)), ev: { ...s1, active: await A.evaluate(describe) } }),
        );
      },
    );
  }
  // a sidebar link, by Enter and by tap
  for (const how of ['enter', 'tap']) {
    await goH(A, 'home');
    await blur(A);
    await A.focus('#mnav-btn');
    await A.keyboard.press('Enter');
    await sleep(400);
    const link = A.locator('nav.side [data-a="go"][data-r="projects"]').first();
    if (how === 'enter') {
      await link.focus();
      await A.keyboard.press('Enter');
    } else await link.click();
    await sleep(700);
    const l1 = await st(A);
    const act = await A.evaluate(() => {
      const e = document.activeElement;
      const r = e.getBoundingClientRect();
      return {
        ...{},
        tag: e.tagName,
        id: e.id,
        inSide: !!e.closest('nav.side'),
        body: e === document.body,
        visible: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible',
        route: window.__pmspace.S.ui.route,
      };
    });
    const nx = (await tabs(A, 1))[0];
    await check(
      `F4d-${how}`,
      `a sidebar link (Projects, by ${how}): the route changes, the sidebar closes, focus is on the page (visible, not in the sidebar) and the next Tab is not in the sidebar`,
      A,
      async () => ({ pass: act.route === 'projects' && !l1.mnav && !act.body && act.visible && !act.inSide && !nx.inSide && !nx.body, ev: { act, next: nx } }),
    );
  }
  // the palette path
  await goH(A, 'home');
  await blur(A);
  await A.focus('#mnav-btn');
  await A.keyboard.press('Enter');
  await sleep(400);
  await A.keyboard.press('Tab');
  await sleep(50);
  await A.keyboard.press('/');
  await sleep(500);
  const p1 = await A.evaluate(() => ({
    mnav: window.__pmspace.S.ui.mnav,
    pal: !!window.__pmspace.S.ui.palette,
    inPal: document.activeElement?.id === 'pal-in',
    inert: [...document.querySelectorAll('[inert]')].length,
  }));
  await check(
    'C4h1',
    `control: "/" while the sidebar is open, it closes, the palette opens, focus is in the palette's input, nothing is left inert`,
    A,
    async () => ({ pass: !p1.mnav && p1.pal && p1.inPal && p1.inert === 0, ev: p1 }),
  );
  await A.keyboard.press('Escape');
  await sleep(400);
  const p2 = await A.evaluate(describe);
  note_('F4h2', `after the palette closes, focus is on ${JSON.stringify(p2)}`);
  await check('F4h3', `the palette closed after "/" from the open sidebar: focus is not lost (it is on a visible control)`, A, async () => ({
    pass: !p2.body && p2.onscreen,
    ev: p2,
  }));
  // resize past 900 px while open
  await goH(A, 'home');
  await blur(A);
  await A.focus('#mnav-btn');
  await A.keyboard.press('Enter');
  await sleep(400);
  await A.setViewportSize({ width: 1280, height: 800 });
  await sleep(500);
  const r1 = await st(A);
  const w3 = await walkFromTop(A, 4);
  await check(
    'F4e',
    `390 -> 1280 px while open: mnav is false, nothing inert is left, the desktop sidebar is shown and its controls are Tab stops`,
    A,
    async () => ({
      pass:
        !r1.mnav &&
        r1.inert.length === 0 &&
        r1.side.vis === 'visible' &&
        r1.side.left === 0 &&
        r1.side.w > 200 &&
        w3[0].cont === 'skip' &&
        w3[1].inSide &&
        w3[1].onscreen,
      ev: { ...r1, walk: w3.map(x => (x.body ? 'body' : x.cont)) },
    }),
  );
  // 1280 control: sidebar stops come first and are visible; collapsed is unchanged
  await goH(A, 'home');
  const c1 = await walkFromTop(A, 6);
  await check('C4a', `1280 px control: the skip link, then the sidebar's controls first, all visible`, A, async () => ({
    pass: c1[0].cont === 'skip' && c1.slice(1, 5).every(x => x.inSide && x.onscreen),
    ev: c1.map(x => x.cont + (x.onscreen ? '' : '(off)')),
  }));
  await A.evaluate(() => (window.__pmspace.S.ui.collapsed = true));
  await A.evaluate(() => window.__pmspace.render());
  await sleep(300);
  const c2 = await walkFromTop(A, 4);
  const cw = (await st(A)).side;
  await check('C4b', `1280 px control, collapsed sidebar: still shown (narrow) and its controls are the first Tab stops`, A, async () => ({
    pass: cw.vis === 'visible' && cw.w < 100 && cw.w > 20 && c2.slice(1, 3).every(x => x.inSide && x.onscreen),
    ev: { cw, walk: c2.map(x => x.cont + (x.onscreen ? '' : '(off)')) },
  }));
  await A.evaluate(() => (window.__pmspace.S.ui.collapsed = false));
  await A.evaluate(() => window.__pmspace.render());
  await A.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  await goH(A, 'home');
  await A.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(100);
  const red = await A.evaluate(
    () =>
      new Promise(res => {
        const shell = document.querySelector('.shell'),
          side = document.querySelector('nav.side');
        shell.classList.add('mnav');
        setTimeout(() => {
          shell.classList.remove('mnav');
          setTimeout(() => {
            const cs = getComputedStyle(side);
            res({ vis: cs.visibility, x: new DOMMatrix(cs.transform).m41 });
          }, 400);
        }, 300);
      }),
  );
  await check('F4g2', `reduced motion: the sidebar still ends up hidden after closing (sensible result)`, A, async () => ({
    pass: red.vis === 'hidden' && red.x === -280,
    ev: red,
  }));
  await A.ctx.close();
}
// ---- R. round 2: the drawer's review fixes
const S_ = page =>
  page.evaluate(() => ({
    mnav: window.__pmspace.S.ui.mnav,
    modals: window.__pmspace.S.ui.modals.length,
    pal: !!window.__pmspace.S.ui.palette,
    pop: !!window.__pmspace.S.ui.pop,
    collapsed: window.__pmspace.S.ui.collapsed,
  }));
const tol = p => p.catch(() => {}); // a control that is not on the page (on main) fails the checks after it, not the block
const enter = async (page, sel) => {
  await tol(page.focus(sel));
  await page.keyboard.press('Enter');
  await sleep(450);
};
const esc_ = async page => {
  await page.keyboard.press('Escape');
  await sleep(450);
};
// a step that cannot be done (a control that is not on the page) stops its block as a failed check, not the suite
const sect = async (id, fn) => {
  try {
    await fn();
  } catch (e) {
    await check(id + '-stopped', `block ${id} stopped early`, { errs: [] }, async () => ({
      pass: false,
      ev: 'step failed: ' + String(e).split('\n')[0].slice(0, 160),
    }));
  }
};
if (want('R')) {
  // ---- R1: tryFocus goes on to the next match when the first (the hidden sidebar's copy) takes no focus
  await sect('R1', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 'r1');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await A.click('.bottomnav [data-r="projects"]');
    await sleep(700);
    let d = await A.evaluate(describe);
    let on = await activeIs(A, '.bottomnav [data-r="projects"]');
    let nx = (await tabs(A, 1))[0];
    await check('R1a', `390 px, a bottom-nav Projects tap: focus is on the bottom-nav button, and the next Tab is not inside the sidebar`, A, async () => ({
      pass: on && !nx.inSide && !nx.body,
      ev: { d, nx },
    }));
    await goH(A, 'home');
    await blur(A);
    await enter(A, '.topbar [data-r="notifications"]');
    await sleep(250);
    d = await A.evaluate(describe);
    on = await activeIs(A, '.topbar [data-r="notifications"]');
    nx = (await tabs(A, 1))[0];
    await check('R1b', `390 px, Enter on the top bar's bell: focus is on the bell, and the next Tab is not inside the sidebar`, A, async () => ({
      pass: on && !nx.inSide && !nx.body,
      ev: { d, nx },
    }));
    await goH(A, 'projects');
    await blur(A);
    await enter(A, '.ph [data-a="newProject"]');
    const m1 = (await S_(A)).modals;
    await esc_(A);
    d = await A.evaluate(describe);
    on = await activeIs(A, '.ph [data-a="newProject"]');
    nx = (await tabs(A, 1))[0];
    await check(
      'R1c',
      `390 px, the page's New project dialog, then Esc: focus is on the page's New project button, and the next Tab is not inside the sidebar`,
      A,
      async () => ({ pass: m1 === 1 && on && !nx.inSide && !nx.body, ev: { m1, d, nx } }),
    );
    await A.ctx.close();
    const B = await H.mkPage(b, 'hello@example.com', 700, 800, 'r1b');
    B.setDefaultTimeout(4000);
    await goH(B, 'home');
    await blur(B);
    await enter(B, '.topbar [data-pop="user"]');
    const p1 = (await S_(B)).pop;
    await esc_(B);
    d = await B.evaluate(describe);
    on = await activeIs(B, '.topbar [data-pop="user"]');
    nx = (await tabs(B, 1))[0];
    await check('R1d', `700 px, the account menu, then Esc: focus is on the account button, and the next Tab is not inside the sidebar`, B, async () => ({
      pass: p1 && on && !nx.inSide,
      ev: { p1, d, nx },
    }));
    await B.ctx.close();
    // the other side of the loop: a drawer item whose key a visible control of the page shares (the bottom nav's Home and Projects) must not
    // take the focus when the drawer is left, render()'s own restore would give it to that control
    const C = await H.mkPage(b, 'hello@example.com', 390, 844, 'r1c');
    C.setDefaultTimeout(4000);
    await goH(C, 'projects');
    await blur(C);
    await enter(C, '#mnav-btn');
    await C.focus('nav.side [data-a="go"][data-r="home"]');
    await esc_(C);
    d = await C.evaluate(describe);
    on = await activeIs(C, '#mnav-btn');
    await check(
      'R1e',
      `390 px, Esc with focus on the drawer's Home item (the bottom nav has a Home button with the same key): the sidebar closes and focus is on #mnav-btn, not the bottom nav's Home`,
      C,
      async () => ({ pass: on && !(await S_(C)).mnav, ev: d }),
    );
    await enter(C, '#mnav-btn');
    await C.focus('nav.side [data-a="go"][data-r="projects"]');
    await C.keyboard.press('Enter');
    await sleep(700);
    d = await C.evaluate(describe);
    on = await activeIs(C, '#main-content');
    nx = (await tabs(C, 1))[0];
    await check(
      'R1f',
      `390 px, Enter on the drawer's Projects link (the bottom nav has one with the same key): the route changes, focus is on #main-content, not the bottom nav's button`,
      C,
      async () => ({ pass: on && (await C.evaluate(() => window.__pmspace.S.ui.route)) === 'projects' && !nx.inSide, ev: { d, nx } }),
    );
    await C.ctx.close();
  });

  // ---- R2: a dialog opened from the open sidebar is over it
  await sect('R2', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 'r2');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await enter(A, '#mnav-btn');
    await enter(A, 'nav.side [data-a="newProject"]');
    const top = await A.evaluate(() => {
      const m = document.querySelector('.modal');
      if (!m) return { modal: false };
      const r = m.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + 40);
      const z = n => getComputedStyle(document.querySelector(n)).zIndex;
      return {
        modal: true,
        hitInModal: !!e?.closest('.modal'),
        hit: e?.className?.toString().slice(0, 30),
        scrimZ: z('.scrim'),
        wrapZ: z('.modal-wrap'),
        sideZ: z('nav.side'),
        sideScrimZ: z('.side-scrim'),
      };
    });
    await check(
      'R2a',
      `390 px, "+" next to Projects in the open sidebar: the dialog is on top (elementFromPoint at its centre is inside .modal)`,
      A,
      async () => ({ pass: top.modal && top.hitInModal && +top.scrimZ > +top.sideZ && +top.wrapZ > +top.scrimZ, ev: top }),
    );
    // a real tap on the dialog's primary button (the name is empty: a validation error, so the dialog stays)
    const bb = await A.evaluate(() => {
      const r = document.querySelector('.modal [data-a="submitProject"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await A.mouse.click(bb.x, bb.y);
    await sleep(500);
    const t1 = await S_(A);
    const err = await A.evaluate(() => !!document.querySelector('.modal .err'));
    await check(
      'R2b',
      `390 px, a tap on the dialog's "Create project" button reaches the dialog (it validates and stays open) and does not close the sidebar`,
      A,
      async () => ({ pass: t1.mnav && t1.modals === 1 && err, ev: { ...t1, err } }),
    );
    await esc_(A);
    const t2 = await S_(A);
    const plus = await activeIs(A, 'nav.side [data-a="newProject"]');
    await check('R2c', `390 px, Esc closes the dialog (not the sidebar) and focus returns to the "+" in the sidebar`, A, async () => ({
      pass: t2.modals === 0 && t2.mnav && plus,
      ev: { ...t2, plus, active: await A.evaluate(describe) },
    }));
    await esc_(A);
    const t3 = await S_(A);
    await check('R2d', `390 px, a second Esc closes the sidebar and focus returns to #mnav-btn`, A, async () => ({
      pass: !t3.mnav && (await activeIs(A, '#mnav-btn')),
      ev: { ...t3, active: await A.evaluate(describe) },
    }));
    await A.ctx.close();
  });

  // ---- R3: the palette (Command menu, Ctrl+K) shuts the open sidebar and Esc returns to the sidebar's opener
  await sect('R3', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 'r3');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await enter(A, '#mnav-btn');
    await enter(A, 'nav.side [data-pop="help"]');
    await A.locator('.pop [data-a="openPalette"]').click();
    await sleep(500);
    const c1 = await A.evaluate(() => ({
      mnav: window.__pmspace.S.ui.mnav,
      pal: !!window.__pmspace.S.ui.palette,
      inPal: document.activeElement?.id === 'pal-in',
      inert: document.querySelectorAll('[inert]').length,
    }));
    await esc_(A);
    const c2 = await S_(A);
    await check(
      'R3a',
      `390 px, sidebar > Help & resources > Command menu > Esc: the sidebar is closed, the palette is gone, focus is on #mnav-btn`,
      A,
      async () => ({
        pass: !c1.mnav && c1.pal && c1.inPal && c1.inert === 0 && !c2.mnav && !c2.pal && (await activeIs(A, '#mnav-btn')),
        ev: { c1, c2, active: await A.evaluate(describe) },
      }),
    );
    await blur(A);
    await enter(A, '#mnav-btn');
    await A.keyboard.press('Tab');
    await sleep(50);
    await A.keyboard.press('Control+k');
    await sleep(500);
    const c3 = await S_(A);
    await esc_(A);
    const c4 = await S_(A);
    await check('R3b', `390 px, Ctrl+K from inside the open sidebar, then Esc: the sidebar is closed, focus is on #mnav-btn`, A, async () => ({
      pass: !c3.mnav && c3.pal && !c4.mnav && !c4.pal && (await activeIs(A, '#mnav-btn')),
      ev: { c3, c4, active: await A.evaluate(describe) },
    }));
    await blur(A);
    await enter(A, '#mnav-more');
    await A.keyboard.press('Control+k');
    await sleep(500);
    await esc_(A);
    await check('R3c', `390 px, the sidebar opened from More, Ctrl+K, Esc: focus is on More`, A, async () => ({
      pass: (await activeIs(A, '#mnav-more')) && !(await S_(A)).mnav,
      ev: await A.evaluate(describe),
    }));
    await A.ctx.close();
  });

  // ---- R4: the sidebar of 900 px and below is never the collapsed rail
  await sect('R4', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 'r4');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    const rail = () =>
      A.evaluate(() => {
        const sh = document.querySelector('.shell');
        return {
          cls: sh.classList.contains('collapsed'),
          w: Math.round(document.querySelector('nav.side').getBoundingClientRect().width),
          setting: window.__pmspace.S.ui.collapsed,
        };
      });
    const names = () =>
      A.evaluate(() =>
        [...document.querySelectorAll('nav.side .sitem')]
          .filter(e => e.getBoundingClientRect().width > 0)
          .map(e => ({
            n: (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim(),
            label: [...e.querySelectorAll(':scope > span:not(.pico)')].some(x => getComputedStyle(x).display !== 'none' && x.innerText.trim()),
            tip: e.dataset.tip || '',
          })),
      );
    try {
      await A.click('nav.side [data-a="toggleSide"][aria-label="Collapse sidebar"]');
      await sleep(500);
      const r0 = await rail();
      await check('C4r0', `control: 1280 px, "Collapse sidebar" gives the narrow rail (class and width)`, A, async () => ({
        pass: r0.cls && r0.w < 100 && r0.setting,
        ev: r0,
      }));
      // narrowed with focus in the desktop sidebar: the item is hidden now, focus goes to the page
      await A.focus('nav.side [data-a="go"][data-r="projects"]');
      await A.setViewportSize({ width: 390, height: 844 });
      await sleep(600);
      const r1 = await rail();
      const act1 = await A.evaluate(describe);
      await check('R4a', `1280 -> 390 px with the sidebar collapsed: the shell is not drawn collapsed, the setting is unchanged`, A, async () => ({
        pass: !r1.cls && r1.setting,
        ev: r1,
      }));
      await check('R4b', `1280 -> 390 px with focus on a desktop sidebar item: focus moves to #main-content`, A, async () => ({
        pass: await activeIs(A, '#main-content'),
        ev: act1,
      }));
      await tol(A.click('#mnav-btn'));
      await sleep(450);
      const nm = await names();
      const r2 = await rail();
      await check(
        'R4c',
        `390 px, saved setting collapsed, the sidebar opened: every item shows its label and has a name, no tooltip-only item, the drawer is 280 px wide`,
        A,
        async () => ({
          pass: nm.length > 12 && nm.every(x => x.n && x.label && !x.tip) && r2.w === 280 && r2.setting,
          ev: { count: nm.length, bad: nm.filter(x => !x.n || !x.label || x.tip).slice(0, 4), r2 },
        }),
      );
      // widened while open, focus on the drawer's Close navigation button (which does not exist on the desktop)
      const onClose = await activeIs(A, '.side-close');
      await A.setViewportSize({ width: 1280, height: 800 });
      await sleep(600);
      const r3 = await rail();
      const m3 = await S_(A);
      await check(
        'R4d',
        `390 -> 1280 px with the sidebar open: it is shut, nothing inert is left, the rail is back (the setting was never changed), focus is on #main-content`,
        A,
        async () => ({
          pass:
            onClose &&
            !m3.mnav &&
            r3.cls &&
            r3.w < 100 &&
            r3.setting &&
            (await A.evaluate(() => document.querySelectorAll('[inert]').length)) === 0 &&
            (await activeIs(A, '#main-content')),
          ev: { onClose, m3, r3, active: await A.evaluate(describe) },
        }),
      );
      // widened with focus on a link of the drawer: its desktop copy keeps the focus
      await A.setViewportSize({ width: 390, height: 844 });
      await sleep(600);
      await tol(A.click('#mnav-btn'));
      await sleep(450);
      await tol(A.focus('nav.side [data-a="go"][data-r="projects"]'));
      await A.setViewportSize({ width: 1280, height: 800 });
      await sleep(600);
      const a5 = await A.evaluate(describe);
      await check(
        'C4re',
        `control (passes on main by design: nothing moved it): 390 -> 1280 px with focus on the drawer's Projects link, the desktop sidebar's Projects link keeps the focus`,
        A,
        async () => ({ pass: a5.inSide && a5.onscreen && a5.r === 'projects', ev: a5 }),
      );
    } finally {
      // put the saved setting back
      await A.setViewportSize({ width: 1280, height: 800 });
      await sleep(400);
      if ((await rail()).setting) {
        await A.click('nav.side [data-a="toggleSide"][aria-label="Expand sidebar"]').catch(() => {});
        await sleep(400);
      }
    }
    const rf = await rail();
    await check('C4rz', `control: the saved collapsed setting is put back (expanded) after the section`, A, async () => ({
      pass: !rf.setting && !rf.cls,
      ev: rf,
    }));
    await A.ctx.close();
  });

  // ---- R5: a Close navigation button in the open sidebar
  await sect('R5', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 'r5');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await enter(A, '#mnav-btn');
    const f0 = await A.evaluate(() => {
      const e = document.activeElement;
      const cs = getComputedStyle(e);
      const sb = document.querySelector('nav.side').getBoundingClientRect();
      const r = e.getBoundingClientRect();
      const ws = document.querySelector('nav.side .ws').getBoundingClientRect();
      const first = document.querySelector('nav.side').querySelector('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      return {
        close: e.matches('[data-a="closeMnav"]'),
        label: e.getAttribute('aria-label'),
        icon: !!e.querySelector('svg'),
        first: first === e,
        ring: e.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
        inBox: r.left >= sb.left && r.right <= sb.right && r.top >= 0 && r.bottom < 80,
        overlapsWs: !(r.right <= ws.left || r.left >= ws.right || r.bottom <= ws.top || r.top >= ws.bottom),
        w: Math.round(r.width),
        h: Math.round(r.height),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth,
      };
    });
    await check(
      'R5a',
      `390 px, opened by keyboard: focus is on the Close navigation button (aria-label, icon, first control), with a visible focus ring, in the drawer's top row without overlapping the workspace button`,
      A,
      async () => ({ pass: f0.close && f0.label === 'Close navigation' && f0.icon && f0.first && f0.ring && f0.inBox && !f0.overlapsWs, ev: f0 }),
    );
    await A.keyboard.press('Enter');
    await sleep(450);
    const g1 = await S_(A);
    await check('R5b', `390 px, Enter on Close navigation: the sidebar closes and focus is back on #mnav-btn`, A, async () => ({
      pass: !g1.mnav && (await activeIs(A, '#mnav-btn')),
      ev: { ...g1, active: await A.evaluate(describe) },
    }));
    await blur(A);
    await enter(A, '#mnav-more');
    const f2 = await activeIs(A, '.side-close');
    await A.keyboard.press('Enter');
    await sleep(450);
    await check('R5c', `390 px, opened from More: Close navigation has the focus, Enter on it returns focus to More`, A, async () => ({
      pass: f2 && !(await S_(A)).mnav && (await activeIs(A, '#mnav-more')),
      ev: { f2, active: await A.evaluate(describe) },
    }));
    // a tap on the button (no keyboard)
    await tol(A.click('#mnav-btn'));
    await sleep(450);
    await tol(A.click('.side-close'));
    await sleep(450);
    await check('R5d', `390 px, a tap on Close navigation closes the sidebar`, A, async () => ({ pass: !(await S_(A)).mnav, ev: await S_(A) }));
    await A.setViewportSize({ width: 700, height: 800 });
    await sleep(500);
    await tol(A.click('#mnav-btn'));
    await sleep(450);
    const w7 = await A.evaluate(() => {
      const r = document.querySelector('.side-close')?.getBoundingClientRect() || { width: 0, left: 0, right: 0, top: 0, bottom: 0 };
      const ws = document.querySelector('nav.side .ws').getBoundingClientRect();
      const co = document.querySelector('nav.side [data-a="toggleSide"]');
      const cr = co?.getBoundingClientRect();
      const ov = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      return { shown: r.width > 0, overlapsWs: ov(r, ws), overlapsCollapse: !!(cr && cr.width && ov(r, cr)) };
    });
    await check(
      'R5e',
      `700 px (where the sidebar's own collapse button also shows): Close navigation is shown and overlaps neither the workspace button nor it`,
      A,
      async () => ({ pass: w7.shown && !w7.overlapsWs && !w7.overlapsCollapse, ev: w7 }),
    );
    await A.setViewportSize({ width: 1280, height: 800 });
    await sleep(600);
    const dk = await A.evaluate(() => {
      const e = document.querySelector('.side-close');
      if (!e) return { display: 'missing', w: -1 };
      const cs = getComputedStyle(e);
      return { display: cs.display, w: e.getBoundingClientRect().width };
    });
    const wk = await walkFromTop(A, 40);
    const closeStops = wk.filter(x => x.a === 'closeMnav').length;
    await check('R5f', `1280 px: Close navigation is display:none and is not among the first 40 Tab stops`, A, async () => ({
      pass: dk.display === 'none' && dk.w === 0 && closeStops === 0 && wk.some(x => x.inSide),
      ev: { dk, closeStops, side: wk.filter(x => x.inSide).length },
    }));
    await A.ctx.close();
  });

  // ---- R6: no slide, say so
  await sect('R6', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 'r6');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await enter(A, '#mnav-btn');
    const v = await A.evaluate(
      () =>
        new Promise(res => {
          const side = () => document.querySelector('nav.side');
          const openVis = getComputedStyle(side()).visibility;
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          const cs = getComputedStyle(side());
          const sync = { vis: cs.visibility, x: new DOMMatrix(cs.transform).m41, mnav: window.__pmspace.S.ui.mnav };
          requestAnimationFrame(() => {
            const c2 = getComputedStyle(side());
            res({ openVis, sync, frame1: { vis: c2.visibility, x: new DOMMatrix(c2.transform).m41 } });
          });
        }),
    );
    await check(
      'R6a',
      `390 px, a real close (Esc): the sidebar is visibility:hidden at once (in the same task, and on the first frame) and off the screen`,
      A,
      async () => ({ pass: v.openVis === 'visible' && !v.sync.mnav && v.sync.vis === 'hidden' && v.frame1.vis === 'hidden' && v.frame1.x === -280, ev: v }),
    );
    const tr = await A.evaluate(() => {
      const g = e => {
        const cs = getComputedStyle(e);
        return { prop: cs.transitionProperty, dur: cs.transitionDuration, delay: cs.transitionDelay };
      };
      const side = document.querySelector('nav.side');
      const closed = g(side);
      document.querySelector('.shell').classList.add('mnav');
      const open = g(side);
      return { closed, open };
    });
    await check(
      'R6b',
      `390 px: the sidebar's transition is the original "transform 0.22s" with no visibility transition or delay, closed or open (passes on main by design)`,
      A,
      async () => ({ pass: [tr.closed, tr.open].every(t => t.prop === 'transform' && t.dur === '0.22s' && t.delay === '0s'), ev: tr }),
    );
    await A.ctx.close();
  });
}
// ---- T. round 3: the round-2 review fixes
if (want('T')) {
  const vp = async (page, w, h = 800, ms = 800) => {
    await page.setViewportSize({ width: w, height: h });
    await sleep(ms);
  };
  const fld = (page, sel) =>
    page.evaluate(s => {
      const e = document.querySelector(s);
      return e ? { v: e.value, active: document.activeElement === e, at: e.selectionStart } : null;
    }, sel);
  const shellOf = page =>
    page.evaluate(() => ({
      collapsed: document.querySelector('.shell').classList.contains('collapsed'),
      mnav: window.__pmspace.S.ui.mnav,
      inert: document.querySelectorAll('[inert]').length,
    }));
  const titleOnServer = async id => (await L.api('GET', '/collections/tasks/records/' + id)).body.doc.title;
  const titleInStore = (page, id) => page.evaluate(i => window.__pmspace.D().tasks.find(t => t.id === i)?.title, id);
  // the saved prefs of every user: id, last update and the collapsed flag
  const prefsOnServer = async () =>
    JSON.stringify((await L.api('GET', '/collections/user_prefs/records?perPage=50')).body.items.map(i => [i.id, i.updated, i.doc.collapsed]));
  const pickTask = page => page.evaluate(() => window.__pmspace.D().tasks.find(t => t.project && !t.archived)?.id);
  const where = page =>
    page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return { body: true };
      return {
        id: e.id,
        a: e.dataset.a || '',
        pop: e.dataset.pop || '',
        inSide: !!e.closest('nav.side'),
        inModal: !!e.closest('.modal'),
        inPanel: !!e.closest('.drawer'),
        txt: (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      };
    });
  const TXT = 'half typed subtask';
  const caretAt = async (page, sel, n) => {
    await page.focus(sel);
    await page.keyboard.press('End');
    for (let i = 0; i < n; i++) await page.keyboard.press('ArrowLeft');
  };

  // ---- T1: crossing 900 px keeps what the user is typing
  await sect('T1', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 1000, 800, 't1');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    const tid = await pickTask(A);
    const orig = await titleOnServer(tid);
    // each variant: type, cross to 800 and back to 1000 (and check at 800), then close the surface. `collapsed` also proves the redraw happened.
    const variant = async (tag, collapsed) => {
      const shell0 = await shellOf(A);
      // New task's "Add a subtask" (a field that is in no model): the text and the caret
      await A.evaluate(() => window.__pmspace.A.newTask());
      await sleep(500);
      await A.focus('#f-sub');
      await A.keyboard.type(TXT);
      await caretAt(A, '#f-sub', 4);
      const a0 = await fld(A, '#f-sub');
      await vp(A, 800);
      const a1 = await fld(A, '#f-sub');
      const s1 = await shellOf(A);
      const w1 = await where(A);
      await vp(A, 1000);
      const a2 = await fld(A, '#f-sub');
      const s2 = await shellOf(A);
      const redrew = !collapsed || (!s1.collapsed && s2.collapsed);
      await check(
        `T1${tag}1`,
        `1000 -> 800 -> 1000 px${collapsed ? ' with the desktop sidebar collapsed (the shell is redrawn: collapsed at 1000, not at 800)' : ''}, text typed in New task's "Add a subtask": the text, the caret (4 from the end) and the focus are kept`,
        A,
        async () => ({
          pass:
            a0.v === TXT &&
            a1?.v === TXT &&
            a1.active &&
            a1.at === TXT.length - 4 &&
            a2?.v === TXT &&
            a2.active &&
            a2.at === TXT.length - 4 &&
            redrew &&
            shell0.collapsed === collapsed,
          ev: { shell0, a0, a1, w1, a2, s1, s2 },
        }),
      );
      await A.keyboard.press('Escape');
      await sleep(400);
      // the task panel's title, half typed, not blurred: nothing is saved, the field keeps text and focus
      await A.evaluate(id => window.__pmspace.A.openTask({ dataset: { id } }), tid);
      await sleep(600);
      await A.focus('#d-title');
      await A.keyboard.press('End');
      await A.keyboard.type(' ZZZ');
      const typed = await A.inputValue('#d-title');
      await vp(A, 800, 800, 1800);
      const b1 = await fld(A, '#d-title');
      const t1 = { store: await titleInStore(A, tid), server: await titleOnServer(tid) };
      const bs1 = await shellOf(A);
      await vp(A, 1000, 800, 1800);
      const b2 = await fld(A, '#d-title');
      const t2 = { store: await titleInStore(A, tid), server: await titleOnServer(tid) };
      await check(
        `T1${tag}2`,
        `1000 -> 800 -> 1000 px${collapsed ? ' with the desktop sidebar collapsed' : ''}, the task panel's title half typed: the field keeps the text and the focus, and the store's and the server's title are unchanged`,
        A,
        async () => ({
          pass:
            typed === orig + ' ZZZ' &&
            b1?.v === typed &&
            b1.active &&
            b2?.v === typed &&
            b2.active &&
            t1.store === orig &&
            t1.server === orig &&
            t2.store === orig &&
            t2.server === orig &&
            (!collapsed || !bs1.collapsed),
          ev: { typed, b1, b2, t1, t2, bs1, orig },
        }),
      );
      // put the title back whatever happened, and shut the panel
      if (await A.$('#d-title')) {
        await A.fill('#d-title', orig);
        await A.keyboard.press('Tab');
        await sleep(300);
      }
      await A.keyboard.press('Escape');
      await sleep(400);
      if (await A.evaluate(() => !!window.__pmspace.S.ui.drawer)) {
        await A.evaluate(() => window.__pmspace.A.closeDrawer());
        await sleep(300);
      }
      if ((await titleOnServer(tid)) !== orig) {
        await A.evaluate(
          ([id, t]) => {
            window.__pmspace.D().tasks.find(x => x.id === id).title = t;
          },
          [tid, orig],
        );
      }
    };
    await variant('a', false);
    // the redraw is needed only where the markup differs: with nothing collapsed or open, a crossing leaves the page as it is
    await A.evaluate(() => {
      const p = document.createElement('i');
      p.id = 'cross-probe';
      document.getElementById('app').appendChild(p);
    });
    await vp(A, 800, 800, 500);
    await vp(A, 1000, 800, 500);
    const kept = await A.evaluate(() => !!document.getElementById('cross-probe'));
    await check('T1e', `1000 -> 800 -> 1000 px with the sidebar not collapsed and the drawer shut: the page is not drawn again at all`, A, async () => ({
      pass: kept,
      ev: { kept },
    }));
    // collapsed
    await A.click('nav.side [data-a="toggleSide"][aria-label="Collapse sidebar"]');
    await sleep(500);
    try {
      await A.evaluate(() => {
        const p = document.createElement('i');
        p.id = 'cross-probe';
        document.getElementById('app').appendChild(p);
      });
      await vp(A, 800, 800, 600);
      const gone = await A.evaluate(() => !document.getElementById('cross-probe'));
      await vp(A, 1000, 800, 600);
      await check('C1f', `control: 1000 -> 800 -> 1000 px with the sidebar collapsed: the shell is drawn again (the rail comes and goes)`, A, async () => ({
        pass: gone && (await shellOf(A)).collapsed,
        ev: { gone, s: await shellOf(A) },
      }));
      await variant('c', true);
    } finally {
      await vp(A, 1000, 800, 400);
      if ((await shellOf(A)).collapsed) {
        await A.click('nav.side [data-a="toggleSide"][aria-label="Expand sidebar"]').catch(() => {});
        await sleep(500);
      }
    }
    const sz = await shellOf(A);
    await check('C1z', `control: the saved collapsed setting is put back (expanded) after the section, and the task's title is as it was`, A, async () => ({
      pass: !sz.collapsed && !(await A.evaluate(() => window.__pmspace.S.ui.collapsed)) && (await titleOnServer(tid)) === orig,
      ev: sz,
    }));
    await A.ctx.close();

    // widened while the drawer is open, with a dialog over it that has a half-typed field: the drawer is shut and the field is kept
    const B = await H.mkPage(b, 'hello@example.com', 390, 844, 't1w');
    B.setDefaultTimeout(4000);
    await goH(B, 'home');
    await blur(B);
    await enter(B, '#mnav-btn');
    await B.evaluate(() => window.__pmspace.A.newTask());
    await sleep(500);
    await B.focus('#f-sub');
    await B.keyboard.type(TXT);
    await caretAt(B, '#f-sub', 4);
    await vp(B, 1280, 800, 900);
    const w1 = await fld(B, '#f-sub');
    const sw = await shellOf(B);
    await check(
      'T1g',
      `390 -> 1280 px with the sidebar open and a dialog over it with a half-typed field: the sidebar is shut, nothing is left inert, the text, caret and focus are kept`,
      B,
      async () => ({ pass: w1?.v === TXT && w1.active && w1.at === TXT.length - 4 && !sw.mnav && sw.inert === 0, ev: { w1, sw } }),
    );
    await B.ctx.close();
  });

  // ---- T4: narrowing with a popover from the sidebar open
  await sect('T4', async () => {
    for (const pop of ['user', 'ws']) {
      const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 't4' + pop);
      A.setDefaultTimeout(4000);
      await goH(A, 'home');
      await blur(A);
      await A.click(`nav.side [data-pop="${pop}"]`);
      await sleep(400);
      const open = (await S_(A)).pop;
      await vp(A, 390, 844, 900);
      const d = await A.evaluate(describe);
      const on = await activeIs(A, '#main-content');
      const nx = (await tabs(A, 1))[0];
      await check(
        `T4-${pop}`,
        `1280 -> 390 px with the ${pop} menu open from the sidebar: it closes, focus is on #main-content, and the next Tab is not inside the sidebar`,
        A,
        async () => ({ pass: open && !(await S_(A)).pop && on && !nx.inSide && !nx.body, ev: { open, d, nx } }),
      );
      await A.ctx.close();
    }
  });

  // ---- T2: Ctrl+K over a dialog opened from the sidebar
  await sect('T2', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 't2');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await enter(A, '#mnav-btn');
    await enter(A, 'nav.side [data-a="newProject"]');
    const m0 = await S_(A);
    await A.keyboard.press('Control+k');
    await sleep(450);
    const m1 = await S_(A);
    await esc_(A);
    const m2 = await S_(A);
    const w2 = await where(A);
    await check(
      'T2a',
      `390 px, the sidebar, the dialog from "+" next to Projects, Ctrl+K, then Esc: the palette is gone, the sidebar is still open, focus is back inside the dialog`,
      A,
      async () => ({ pass: m0.mnav && m0.modals === 1 && m1.pal && m1.mnav && !m2.pal && m2.mnav && m2.modals === 1 && w2.inModal, ev: { m0, m1, m2, w2 } }),
    );
    await esc_(A);
    const m3 = await S_(A);
    const on3 = await activeIs(A, 'nav.side [data-a="newProject"]');
    await check('T2b', `... a further Esc closes the dialog, with focus on the "+"`, A, async () => ({
      pass: m3.modals === 0 && m3.mnav && on3,
      ev: { m3, w: await where(A) },
    }));
    await esc_(A);
    const m4 = await S_(A);
    const on4 = await activeIs(A, '#mnav-btn');
    await check('T2c', `... and one more closes the sidebar, with focus on #mnav-btn`, A, async () => ({
      pass: !m4.mnav && on4,
      ev: { m4, w: await where(A) },
    }));
    // controls: with the sidebar open and no dialog, Ctrl+K still shuts it and Esc returns to the opener
    await enter(A, '#mnav-btn');
    await A.keyboard.press('Control+k');
    await sleep(450);
    const m5 = await S_(A);
    await esc_(A);
    const m6 = await S_(A);
    const on6 = await activeIs(A, '#mnav-btn');
    await check('C2d', `control: 390 px, the sidebar open with no dialog, Ctrl+K: the sidebar shuts and Esc leaves focus on #mnav-btn`, A, async () => ({
      pass: m5.pal && !m5.mnav && !m6.pal && !m6.mnav && on6,
      ev: { m5, m6, w: await where(A) },
    }));
    await A.ctx.close();
  });

  // ---- T3: "[" and "Toggle sidebar" at sidebar width
  await sect('T3', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 't3');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    const c0 = await A.evaluate(() => window.__pmspace.S.ui.collapsed);
    const p0 = await prefsOnServer();
    await A.keyboard.press('[');
    await sleep(400);
    const c1 = await A.evaluate(() => window.__pmspace.S.ui.collapsed);
    await enter(A, '#mnav-btn');
    await A.keyboard.press('[');
    await sleep(400);
    const c2 = await A.evaluate(() => window.__pmspace.S.ui.collapsed);
    await A.evaluate(() => window.__pmspace.A.toggleSide());
    await sleep(1800); // the palette's "Toggle sidebar" runs this
    const c3 = await A.evaluate(() => window.__pmspace.S.ui.collapsed);
    const p1 = await prefsOnServer();
    await check(
      'T3a',
      `390 px, "[" with the sidebar shut and open, and the "Toggle sidebar" action: S.ui.collapsed and the saved user_prefs are unchanged`,
      A,
      async () => ({ pass: !c0 && c1 === c0 && c2 === c0 && c3 === c0 && p1 === p0 && (await S_(A)).mnav, ev: { c0, c1, c2, c3, same: p1 === p0 } }),
    );
    await vp(A, 1280, 800, 700);
    const d0 = await A.evaluate(() => window.__pmspace.S.ui.collapsed); // what T3a left (on main it flipped it)
    await A.keyboard.press('[');
    await sleep(500);
    const d1 = await A.evaluate(() => window.__pmspace.S.ui.collapsed);
    await A.keyboard.press('[');
    await sleep(500);
    const d2 = await A.evaluate(() => window.__pmspace.S.ui.collapsed);
    await check('C3b', `control: 1280 px, "[" still toggles the collapsed sidebar (and back)`, A, async () => ({
      pass: d1 === !d0 && d2 === d0,
      ev: { d0, d1, d2 },
    }));
    await A.ctx.close();
  });

  // ---- T5: the drawer's Close button is as easy to hit as the button that opens it
  await sect('T5', async () => {
    const top = page =>
      page.evaluate(() => {
        const r = e => {
          const x = e.getBoundingClientRect();
          return { l: x.left, t: x.top, r: x.right, b: x.bottom, w: x.width, h: x.height };
        };
        const c = r(document.querySelector('.side-close')),
          ws = r(document.querySelector('nav.side .ws')),
          row = r(document.querySelector('.side-top .row')),
          st = r(document.querySelector('.side-top'));
        const burger = document.querySelector('#mnav-btn') ? r(document.querySelector('#mnav-btn')) : null;
        const kids = [...document.querySelectorAll('.side-top .row > *')]
          .filter(e => getComputedStyle(e).display !== 'none')
          .map(e => Math.round(e.getBoundingClientRect().top));
        return { close: c, ws, gap: Math.max(c.l - ws.r, ws.l - c.r), rowH: row.h, topH: st.h, kidTops: kids, burger: burger && { w: burger.w, h: burger.h } };
      });
    const A = await H.mkPage(b, 'hello@example.com', 390, 844, 't5');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await enter(A, '#mnav-btn');
    const t390 = await top(A);
    await A.screenshot({ path: L.OUT + '/t5-390.png', clip: { x: 0, y: 0, width: 390, height: 140 } });
    await check(
      'T5a',
      `390 px: Close navigation is at least 40 x 40 and at least 8 px from the workspace button, nothing overlapping or wrapping in the top row`,
      A,
      async () => ({ pass: t390.close.w >= 40 && t390.close.h >= 40 && t390.gap >= 8 && Math.max(...t390.kidTops) - Math.min(...t390.kidTops) <= 8, ev: t390 }),
    );
    await A.keyboard.press('Escape');
    await sleep(400);
    await vp(A, 700, 844, 600);
    await enter(A, '#mnav-btn');
    const t700 = await top(A);
    await A.screenshot({ path: L.OUT + '/t5-700.png', clip: { x: 0, y: 0, width: 700, height: 140 } });
    // at 641-900 px the Close button keeps the size it had (the workspace button decides the height of the row), and the row is not taller than before
    await check(
      'T5b',
      `700 px: Close navigation keeps its size (not 40 x 40) and the top row is only as tall as the workspace button needs, nothing overlapping or wrapping`,
      A,
      async () => ({
        pass:
          t700.close.w < 40 &&
          t700.close.h < 40 &&
          t700.topH <= t700.ws.h + 12.5 &&
          t700.gap >= 0 &&
          Math.max(...t700.kidTops) - Math.min(...t700.kidTops) <= 8,
        ev: t700,
      }),
    );
    await A.ctx.close();
  });

  // ---- T6: the task panel behind the open sidebar
  await sect('T6', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 700, 844, 't6');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    const tid = await pickTask(A);
    const st6 = page =>
      page.evaluate(() => ({
        mnav: window.__pmspace.S.ui.mnav,
        panel: window.__pmspace.S.ui.drawer || null,
        modals: window.__pmspace.S.ui.modals.length,
        panelInert: !!document.querySelector('.drawer')?.hasAttribute('inert'),
        scrimInert: [...document.querySelectorAll('.drawer-scrim')].every(e => e.hasAttribute('inert')),
      }));
    await A.evaluate(id => window.__pmspace.A.openTask({ dataset: { id } }), tid);
    await sleep(600);
    await A.click('#mnav-btn');
    await sleep(450);
    const s0 = await st6(A);
    let inPanel = 0;
    const seen = [];
    for (let i = 0; i < 60; i++) {
      await A.keyboard.press('Tab');
      const w = await where(A);
      if (w.inPanel) inPanel++;
      seen.push(w.inSide ? 'side' : w.body ? 'body' : 'other');
    }
    await check('T6a', `700 px, a task open, then the sidebar: the panel is inert, and no Tab stop in 60 lands in the panel`, A, async () => ({
      pass: s0.mnav && s0.panel === tid && s0.panelInert && inPanel === 0,
      ev: { s0, inPanel, outside: seen.filter(x => x !== 'side').length },
    }));
    await esc_(A);
    const s1 = await st6(A);
    const on1 = await activeIs(A, '#mnav-btn');
    await check('T6b', `... the first Esc closes the sidebar, with focus on #mnav-btn, and the panel is still open (and no longer inert)`, A, async () => ({
      pass: !s1.mnav && s1.panel === tid && !s1.panelInert && on1,
      ev: { s1, w: await where(A) },
    }));
    await esc_(A);
    const s2 = await st6(A);
    await check('T6c', `... the second Esc closes the panel`, A, async () => ({ pass: !s2.mnav && !s2.panel, ev: s2 }));
    // a dialog opened from the sidebar is still closed first
    await A.evaluate(id => window.__pmspace.A.openTask({ dataset: { id } }), tid);
    await sleep(600);
    await A.click('#mnav-btn');
    await sleep(450);
    await enter(A, 'nav.side [data-a="newProject"]');
    const s3 = await st6(A);
    await esc_(A);
    const s4 = await st6(A);
    await esc_(A);
    const s5 = await st6(A);
    await esc_(A);
    const s6 = await st6(A);
    await check('T6d', `700 px, a task, the sidebar, the dialog from "+": Esc closes the dialog, then the sidebar, then the panel`, A, async () => ({
      pass: s3.modals === 1 && s3.mnav && s4.modals === 0 && s4.mnav && s4.panel === tid && !s5.mnav && s5.panel === tid && !s6.panel,
      ev: { s3, s4, s5, s6 },
    }));
    await A.ctx.close();
  });

  // ---- T7: a composer left open in the page is under the open sidebar too, so Esc closes the sidebar first
  await sect('T7', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 700, 844, 't7');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    const pid = await A.evaluate(() => window.__pmspace.D().tasks.find(t => t.project && !t.archived)?.project);
    await goP(A, pid, 'board');
    await A.click('.addcard');
    await sleep(450);
    const st7 = page => page.evaluate(() => ({ mnav: window.__pmspace.S.ui.mnav, composer: !!window.__pmspace.S.ui.composer }));
    const s0 = await st7(A);
    await A.click('#mnav-btn');
    await sleep(450);
    const s1 = await st7(A);
    await esc_(A);
    const s2 = await st7(A);
    const on2 = await activeIs(A, '#mnav-btn');
    await check(
      'T7a',
      `700 px, a board composer open, then the sidebar: the first Esc closes the sidebar (focus on #mnav-btn), and the composer is still open`,
      A,
      async () => ({ pass: s0.composer && s1.mnav && s1.composer && !s2.mnav && s2.composer && on2, ev: { pid, s0, s1, s2, on2 } }),
    );
    await esc_(A);
    const s3 = await st7(A);
    await check('T7b', `... the second Esc closes the composer`, A, async () => ({ pass: !s3.mnav && !s3.composer, ev: s3 }));
    await A.ctx.close();
  });
}
// ---- U. round 4: the round-3 review fixes
if (want('U')) {
  const vp = async (page, w, h = 800, ms = 800) => {
    await page.setViewportSize({ width: w, height: h });
    await sleep(ms);
  };
  // a pointer press, as remoteRender() sees it (a real press and release would also click what is under the pointer)
  const press = (page, down) => page.evaluate(d => document.dispatchEvent(new Event(d ? 'pointerdown' : 'pointerup', { bubbles: true })), down);
  const shellOf = page =>
    page.evaluate(() => {
      const sh = document.querySelector('.shell');
      const side = document.querySelector('.side');
      return {
        cls: sh.className.replace(/\s+/g, ' ').trim(),
        collapsed: sh.classList.contains('collapsed'),
        col1: getComputedStyle(sh).gridTemplateColumns.split(' ')[0],
        mainW: Math.round(document.querySelector('main').getBoundingClientRect().width),
        sideVis: getComputedStyle(side).visibility,
        scrim: !!document.querySelector('.side-scrim'),
        mnav: window.__pmspace.S.ui.mnav,
        inert: document.querySelectorAll('[inert]').length,
      };
    });
  // every frame from now on: the viewport's width, main's width and the shell's classes (the callback runs after the media query's change events)
  const sampleOn = page =>
    page.evaluate(() => {
      window.__fr = [];
      window.__run = true;
      const tick = () => {
        const m = document.querySelector('main');
        const sh = document.querySelector('.shell');
        window.__fr.push({ iw: innerWidth, w: m ? Math.round(m.getBoundingClientRect().width) : -1, cls: sh ? sh.className.replace(/\s+/g, ' ').trim() : '' });
        if (window.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const sampleOff = page =>
    page.evaluate(() => {
      window.__run = false;
      return window.__fr;
    });
  const where = page =>
    page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return { body: true };
      return {
        id: e.id,
        a: e.dataset.a || '',
        inSide: !!e.closest('nav.side'),
        inModal: !!e.closest('.modal'),
        inPop: !!e.closest('.pop'),
        inPanel: !!e.closest('.drawer'),
        inToasts: !!e.closest('#toasts'),
        key:
          e.tagName +
          '#' +
          e.id +
          '|' +
          (e.dataset.a || '') +
          '|' +
          (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      };
    });
  const pickTask = page => page.evaluate(() => window.__pmspace.D().tasks.find(t => t.project && !t.archived)?.id);
  const projOf = page => page.evaluate(() => window.__pmspace.D().tasks.find(t => t.project && !t.archived)?.project);

  // ---- U1: crossing 900 px puts the shell right at once, with the pointer held (remoteRender waits) too
  await sect('U1', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 1000, 800, 'u1');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    try {
      await A.click('nav.side [data-a="toggleSide"][aria-label="Collapse sidebar"]');
      await sleep(500);
      const s0 = await shellOf(A);
      await press(A, true);
      await sampleOn(A);
      await vp(A, 800, 800, 900);
      const fr = (await sampleOff(A)).filter(f => f.iw <= 900);
      const s1 = await shellOf(A);
      const minW = Math.min(...fr.map(f => f.w));
      await check(
        'U1a',
        `1000 -> 800 px with the sidebar saved as collapsed and the pointer held: main is at least 790 px wide on every frame after the crossing, and the shell has no "collapsed"`,
        A,
        async () => ({
          pass: s0.collapsed && s0.col1 === '52px' && fr.length > 5 && minW >= 790 && !s1.collapsed,
          ev: { s0, frames: fr.length, minW, bad: fr.filter(f => f.w < 790).slice(0, 2), s1 },
        }),
      );
      // released at 800 px the shell is drawn again, without "collapsed" (nothing to show there); held again, widening must put it back at once
      await press(A, false);
      await sleep(700);
      const s1b = await shellOf(A);
      await press(A, true);
      await vp(A, 1000, 800, 900);
      const s2 = await shellOf(A);
      await check(
        'U1b',
        `... then released at 800 px (drawn again) and 800 -> 1000 px with the pointer held again: the shell has "collapsed" and the grid's first column is 52 px`,
        A,
        async () => ({ pass: !s1b.collapsed && s2.collapsed && s2.col1 === '52px', ev: { s1b, s2 } }),
      );
      await press(A, false);
      await sleep(600);
      const s3 = await shellOf(A);
      await check('U1c', `... and after the pointer is released the shell is still the collapsed rail (redrawn)`, A, async () => ({
        pass: s3.collapsed && s3.col1 === '52px' && (await A.evaluate(() => window.__pmspace.S.ui.collapsed)),
        ev: s3,
      }));
    } finally {
      await press(A, false);
      await vp(A, 1000, 800, 400);
      if ((await shellOf(A)).collapsed) {
        await A.click('nav.side [data-a="toggleSide"][aria-label="Expand sidebar"]').catch(() => {});
        await sleep(500);
      }
    }
    await A.ctx.close();

    // the open sidebar, widened and narrowed again before the redraw: not visually open with the state saying shut
    const B = await H.mkPage(b, 'hello@example.com', 700, 844, 'u1d');
    B.setDefaultTimeout(4000);
    await goH(B, 'home');
    await blur(B);
    await enter(B, '#mnav-btn');
    const o0 = await shellOf(B);
    await press(B, true);
    await vp(B, 1000, 844, 500);
    const o1 = await shellOf(B);
    await vp(B, 700, 844, 700);
    const o2 = await shellOf(B);
    const stops = [];
    for (let i = 0; i < 16; i++) {
      await B.keyboard.press('Tab');
      stops.push((await where(B)).inSide);
    }
    await check(
      'U1d',
      `700 px, the sidebar open, then 1000 and 700 px with the pointer held: the sidebar is hidden, there is no scrim, nothing is inert, and no Tab stop in 16 is inside it`,
      B,
      async () => ({
        pass:
          o0.mnav &&
          o0.scrim &&
          !o1.mnav &&
          !o1.scrim &&
          !o2.mnav &&
          o2.sideVis === 'hidden' &&
          !o2.scrim &&
          o2.inert === 0 &&
          !/mnav/.test(o2.cls) &&
          !stops.some(Boolean),
        ev: { o0, o1, o2, inSideStops: stops.filter(Boolean).length },
      }),
    );
    await press(B, false);
    await sleep(500);
    // control: with nothing held the redraw comes by itself
    await enter(B, '#mnav-btn');
    await vp(B, 1000, 844, 700);
    await vp(B, 700, 844, 700);
    const o3 = await shellOf(B);
    await check('C1e', `control: the same without the pointer held: the sidebar is hidden, no scrim, nothing inert`, B, async () => ({
      pass: !o3.mnav && o3.sideVis === 'hidden' && !o3.scrim && o3.inert === 0,
      ev: o3,
    }));
    // the stylesheet alone: a stale "collapsed" on the shell at 700 px does not give main the rail's grid
    const o4 = await B.evaluate(() => {
      const sh = document.querySelector('.shell');
      sh.classList.add('collapsed');
      const r = {
        col1: getComputedStyle(sh).gridTemplateColumns.split(' ')[0],
        mainW: Math.round(document.querySelector('main').getBoundingClientRect().width),
      };
      sh.classList.remove('collapsed');
      return r;
    });
    await check('U1f', `700 px, "collapsed" put on the shell by hand: main is still the whole width (the grid is one column)`, B, async () => ({
      pass: o4.mainW >= 690 && o4.col1 !== '52px',
      ev: o4,
    }));
    await B.ctx.close();
  });

  // ---- U2: Esc closes a dialog before anything hidden under the sidebar
  await sect('U2', async () => {
    for (const [w, h] of [
      [700, 844],
      [390, 844],
    ]) {
      const A = await H.mkPage(b, 'hello@example.com', w, h, 'u2-' + w);
      A.setDefaultTimeout(4000);
      await goH(A, 'home');
      await blur(A);
      const pid = await projOf(A);
      await goP(A, pid, 'board');
      await A.click('.addcard');
      await sleep(450);
      const st = page =>
        page.evaluate(() => ({ mnav: window.__pmspace.S.ui.mnav, modals: window.__pmspace.S.ui.modals.length, composer: !!window.__pmspace.S.ui.composer }));
      const s0 = await st(A);
      await A.click('#mnav-btn');
      await sleep(450);
      await enter(A, 'nav.side [data-a="newProject"]');
      const s1 = await st(A);
      await esc_(A);
      const s2 = await st(A);
      const on2 = await activeIs(A, 'nav.side [data-a="newProject"]');
      await check(
        `U2a-${w}`,
        `${w} px, a board composer open, then the sidebar, then "+" next to Projects: the first Esc closes the dialog (focus on the "+"); the sidebar and the composer are still open`,
        A,
        async () => ({
          pass: s0.composer && s1.composer && s1.mnav && s1.modals === 1 && s2.modals === 0 && s2.mnav && s2.composer && on2,
          ev: { pid, s0, s1, s2, on2, w: await where(A) },
        }),
      );
      await esc_(A);
      const s3 = await st(A);
      const on3 = await activeIs(A, '#mnav-btn');
      await check(`U2b-${w}`, `... the next Esc closes the sidebar (focus on #mnav-btn), the composer is still open`, A, async () => ({
        pass: !s3.mnav && s3.composer && on3,
        ev: { s3, w: await where(A) },
      }));
      await esc_(A);
      const s4 = await st(A);
      await check(`U2c-${w}`, `... and the next one cancels the composer`, A, async () => ({ pass: !s4.mnav && !s4.composer && s4.modals === 0, ev: s4 }));
      await A.ctx.close();
    }
    // desktop: a dialog opened over an open composer closes first
    const D_ = await H.mkPage(b, 'hello@example.com', 1280, 800, 'u2d');
    D_.setDefaultTimeout(4000);
    await goH(D_, 'home');
    await blur(D_);
    await goP(D_, await projOf(D_), 'board');
    await D_.click('.addcard');
    await sleep(450);
    await D_.evaluate(() => window.__pmspace.A.newProject());
    await sleep(500);
    const d0 = await D_.evaluate(() => ({ modals: window.__pmspace.S.ui.modals.length, composer: !!window.__pmspace.S.ui.composer }));
    await esc_(D_);
    const d1 = await D_.evaluate(() => ({ modals: window.__pmspace.S.ui.modals.length, composer: !!window.__pmspace.S.ui.composer }));
    await esc_(D_);
    const d2 = await D_.evaluate(() => ({ modals: window.__pmspace.S.ui.modals.length, composer: !!window.__pmspace.S.ui.composer }));
    await check('U2d', `1280 px, a composer open and a dialog opened over it: Esc closes the dialog first, the composer next`, D_, async () => ({
      pass: d0.modals === 1 && d0.composer && d1.modals === 0 && d1.composer && d2.modals === 0 && !d2.composer,
      ev: { d0, d1, d2 },
    }));
    await D_.ctx.close();
  });

  // ---- U3: Tab stays in the open sidebar (a toast is outside the inert page; the task panel behind it is inert)
  await sect('U3', async () => {
    const sticky = page =>
      page.evaluate(async () => {
        const m = await import('/src/ui/toast.js');
        m.toast('Sticky test toast', { kind: 'err', sticky: true, action: 'Undo', onAction: () => {} });
      });
    const cycle = async (page, key, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        await page.keyboard.press(key);
        out.push(await where(page));
      }
      return out;
    };
    for (const [w, h] of [
      [390, 844],
      [700, 800],
    ]) {
      const A = await H.mkPage(b, 'hello@example.com', w, h, 'u3-' + w);
      A.setDefaultTimeout(4000);
      await goH(A, 'home');
      await blur(A);
      await sticky(A);
      await sleep(400);
      const nt = await A.evaluate(() => document.querySelectorAll('#toasts .toast button').length);
      await A.click('#mnav-btn');
      await sleep(450);
      const fw = await cycle(A, 'Tab', 60);
      const bw = await cycle(A, 'Shift+Tab', 60);
      const out = [...fw, ...bw].filter(x => !x.inSide);
      const uniq = new Set([...fw, ...bw].map(x => x.key)).size;
      await check(
        `U3a-${w}`,
        `${w} px, a sticky toast (${nt} buttons) showing, the sidebar open: 60 Tabs and 60 Shift+Tabs never leave the sidebar (and do move through it)`,
        A,
        async () => ({ pass: nt >= 2 && out.length === 0 && uniq >= 5, ev: { nt, outside: out.length, uniq, sample: out.slice(0, 2) } }),
      );
      // a dialog from the sidebar still traps inside the dialog
      await enter(A, 'nav.side [data-a="newProject"]');
      const md = (await S_(A)).modals;
      const mt = await cycle(A, 'Tab', 30);
      const ms = await cycle(A, 'Shift+Tab', 30);
      await check(`U3b-${w}`, `${w} px, the dialog from the sidebar, 30 Tabs and 30 Shift+Tabs: all stay inside the dialog`, A, async () => ({
        pass: md === 1 && [...mt, ...ms].every(x => x.inModal),
        ev: { md, outside: [...mt, ...ms].filter(x => !x.inModal).slice(0, 2) },
      }));
      await esc_(A);
      // a popover from the sidebar still gets the focus, and Tab is not pulled back to the sidebar's first control
      await enter(A, 'nav.side [data-pop="ws"]');
      const pp = await S_(A);
      const w0 = await where(A);
      await A.keyboard.press('Tab');
      const w1 = await where(A);
      await check(
        `U3c-${w}`,
        `${w} px, the workspace menu from the sidebar: it has the focus, and a Tab does not take the focus back to the sidebar's first control`,
        A,
        async () => ({ pass: pp.pop && w0.inPop && !(w1.inSide && w1.a === 'closeMnav'), ev: { pop: pp.pop, w0, w1 } }),
      );
      await A.ctx.close();
    }
    // 700 px: the task panel open in full, then the sidebar (it is inert): Tab is the sidebar's
    const B = await H.mkPage(b, 'hello@example.com', 700, 844, 'u3p');
    B.setDefaultTimeout(4000);
    await goH(B, 'home');
    await blur(B);
    const tid = await pickTask(B);
    await B.evaluate(id => {
      window.__pmspace.A.openTask({ dataset: { id } });
      window.__pmspace.S.ui.drawerFull = true;
      window.__pmspace.render();
    }, tid);
    await sleep(600);
    const full = await B.evaluate(() => ({ drawer: !!window.__pmspace.S.ui.drawer, full: window.__pmspace.S.ui.drawerFull }));
    await B.evaluate(() => window.__pmspace.A.openMnav({ dataset: {}, id: 'mnav-btn' }));
    await sleep(450); // the burger is under a full panel: opened as the review's e4 did
    const pf = await cycle(B, 'Tab', 40);
    const pb = await cycle(B, 'Shift+Tab', 40);
    await check(
      'U3d',
      `700 px, a task open in full, then the sidebar: 40 Tabs and 40 Shift+Tabs stay in the sidebar (and move through it), none in the inert panel`,
      B,
      async () => ({
        pass: full.drawer && full.full && [...pf, ...pb].every(x => x.inSide) && new Set([...pf, ...pb].map(x => x.key)).size >= 5,
        ev: { full, outside: [...pf, ...pb].filter(x => !x.inSide).slice(0, 2), uniq: new Set([...pf, ...pb].map(x => x.key)).size },
      }),
    );
    await B.ctx.close();
    // control: sidebar shut, a sticky toast: the toast's buttons are in the Tab order (nothing is trapped)
    const C = await H.mkPage(b, 'hello@example.com', 390, 844, 'u3c');
    C.setDefaultTimeout(4000);
    await goH(C, 'home');
    await blur(C);
    await sticky(C);
    await sleep(400);
    const cs = await cycle(C, 'Tab', 80);
    await check('C3e', `control: 390 px, the sidebar shut, a sticky toast: Tab reaches the toast's buttons`, C, async () => ({
      pass: cs.some(x => x.inToasts),
      ev: { toast: cs.filter(x => x.inToasts).length },
    }));
    await C.ctx.close();
  });

  // ---- U4: a crossing does not pull the focus out from behind a dialog
  await sect('U4', async () => {
    const A = await H.mkPage(b, 'hello@example.com', 1000, 800, 'u4');
    A.setDefaultTimeout(4000);
    await goH(A, 'home');
    await blur(A);
    await A.evaluate(() => window.__pmspace.A.newProject());
    await sleep(500);
    await A.click('.modal h2');
    await sleep(200);
    const f0 = await where(A);
    await vp(A, 800, 800, 900);
    const f1 = await where(A);
    const on = await activeIs(A, '#main-content');
    const m = (await S_(A)).modals;
    await check(
      'U4a',
      `1000 -> 800 px with New project open and its heading clicked (focus on <body>): focus is not moved to #main-content, and the dialog is still open`,
      A,
      async () => ({ pass: m === 1 && !on, ev: { f0, f1, on, m } }),
    );
    await esc_(A);
    // control: no dialog, focus lost: it still goes to the page
    await goH(A, 'home');
    await vp(A, 1000, 800, 800);
    await blur(A);
    await vp(A, 800, 800, 800);
    await check('C4b', `control: 1000 -> 800 px with no dialog and focus on <body>: focus goes to #main-content`, A, async () => ({
      pass: await activeIs(A, '#main-content'),
      ev: await where(A),
    }));
    await A.ctx.close();
  });

  // ---- U5: "Toggle sidebar" is not offered where it does nothing
  await sect('U5', async () => {
    for (const [w, h, want_] of [
      [390, 844, false],
      [700, 800, false],
      [1280, 800, true],
    ]) {
      const A = await H.mkPage(b, 'hello@example.com', w, h, 'u5-' + w);
      A.setDefaultTimeout(4000);
      await goH(A, 'home');
      await blur(A);
      await A.keyboard.press('Control+k');
      await sleep(450);
      await A.keyboard.type('sidebar');
      await sleep(450);
      const items = await A.$$eval('.palette .pi', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
      const has = items.some(t => /Toggle sidebar/.test(t));
      await check(
        `U5-${w}`,
        `${w} px, the command menu's results for "sidebar": ${want_ ? '"Toggle sidebar" is there' : 'no "Toggle sidebar"'}`,
        A,
        async () => ({ pass: has === want_, ev: items }),
      );
      await A.ctx.close();
    }
  });

  // ---- U6: go() closes the task panel at the drawer's breakpoint (900 px included), not below it only
  await sect('U6', async () => {
    for (const [w, shut] of [
      [900, true],
      [901, false],
    ]) {
      const A = await H.mkPage(b, 'hello@example.com', w, 844, 'u6-' + w);
      A.setDefaultTimeout(4000);
      await goH(A, 'home');
      await blur(A);
      const tid = await pickTask(A);
      await A.evaluate(id => window.__pmspace.A.openTask({ dataset: { id } }), tid);
      await sleep(600);
      const iw = await A.evaluate(() => innerWidth);
      const open0 = await A.evaluate(() => window.__pmspace.S.ui.drawer);
      await A.evaluate(() => window.__pmspace.go('inbox'));
      await sleep(600);
      const open1 = await A.evaluate(() => window.__pmspace.S.ui.drawer || null);
      await check(
        `U6-${w}`,
        `${w} px (innerWidth ${iw}), a task panel open, then another page: the panel is ${shut ? 'closed' : 'still open (as before)'}`,
        A,
        async () => ({ pass: iw === w && open0 === tid && (shut ? !open1 : open1 === tid), ev: { iw, open0, open1 } }),
      );
      await A.ctx.close();
    }
  });
}
console.log(`RESULT ${L.results.pass} pass ${L.results.fail} fail`);
await b.close();
