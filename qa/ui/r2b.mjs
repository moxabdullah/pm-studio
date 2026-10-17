// Round 2, suite B: Projects table (item 2), overview Details (4), project form (5), values (7)
import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
import * as X from '../lib/fixtures.mjs';
const { sleep } = H;
const check = L.check;
await L.suLogin();
const b = await L.launch();
const P1 = H.P(1),
  P2 = H.P(2),
  P4 = H.P(4);
const pages = [];
const mk = async (w, h, tag) => {
  const p = await H.mkPage(b, 'hello@example.com', w, h, tag);
  pages.push(p);
  return p;
};
const allErrs = () => pages.flatMap(p => p.errs);
// the whole of an element's text is inside the element, on its own lines (nothing cut by a clip or an ellipsis)
const FITS = `(el, box) => { const r = document.createRange(); r.selectNodeContents(el); const bb = box.getBoundingClientRect(); const rs = [...r.getClientRects()]; const cs = getComputedStyle(el); return { lines: new Set(rs.map(x => Math.round(x.top))).size, inside: rs.every(x => x.left >= bb.left - 0.5 && x.right <= bb.right + 0.5 && x.bottom <= bb.bottom + 0.5), noClip: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1, ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap', text: el.innerText.trim() }; }`;
try {
  // ================= TABLE (item 2)
  const T = await mk(1280, 800, 'T1280');
  await H.goProjects(T, 'table');
  const geo = await T.evaluate(() => {
    const panel = document.getElementById('proj-table');
    const pr = panel.getBoundingClientRect();
    const ths = [...panel.querySelectorAll('thead th')];
    const rows = [...panel.querySelectorAll('tbody tr')];
    const cells = n => rows.map(r => r.children[n].getBoundingClientRect());
    const cols = [1, 2, 3].map(n => ({
      th: ths[n].innerText.trim(),
      r: Math.max(ths[n].getBoundingClientRect().right, ...cells(n).map(c => c.right)),
      l: Math.min(ths[n].getBoundingClientRect().left, ...cells(n).map(c => c.left)),
    }));
    return {
      head: ths.slice(0, 5).map(t => t.innerText.trim()),
      panelLeft: pr.left,
      panelRight: pr.right,
      cols,
      scrollLeft: panel.scrollLeft,
      sw: panel.scrollWidth,
      cw: panel.clientWidth,
      mw: panel.querySelector('table').style.minWidth,
      page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    };
  });
  await check('T1', '1280x800, built-ins: Client, End user, PO / contract no. come straight after Project (list order), before Stage', T, async () => ({
    pass: geo.head.join('|') === 'Project|Client|End user|PO / contract no.|Stage',
    ev: geo.head,
  }));
  await check('T2', 'the three field columns (header and every row) lie inside the panel at scrollLeft 0 (right edge <= panel right)', T, async () => ({
    pass: geo.scrollLeft === 0 && geo.cols.every(c => c.r <= geo.panelRight + 0.5 && c.l >= geo.panelLeft - 0.5),
    ev: { panel: [geo.panelLeft, geo.panelRight], cols: geo.cols, panelScrolls: geo.sw > geo.cw },
  }));
  await check('T3', 'min-width is 860 + 120 x 3 = 1220px; the page does not scroll sideways', T, async () => ({
    pass: geo.mw === '1220px' && geo.page[0] <= geo.page[1],
    ev: { mw: geo.mw, page: geo.page, panel: [geo.sw, geo.cw] },
  }));
  await T.screenshot({ path: L.OUT + '/T-1280.png' });
  const attrs = await T.$eval('#proj-table', e => ({
    tabindex: e.getAttribute('tabindex'),
    role: e.getAttribute('role'),
    label: e.getAttribute('aria-label'),
  }));
  await check('T4', 'the scrolling panel has tabindex=0, role=region, aria-label="Projects table"', T, async () => ({
    pass: attrs.tabindex === '0' && attrs.role === 'region' && attrs.label === 'Projects table',
    ev: attrs,
  }));
  const snap = await T.locator('#proj-table').ariaSnapshot();
  await check('T4b', 'the accessibility tree has it as a region named "Projects table"', T, async () => ({
    pass: /region "Projects table"/.test(snap),
    ev: snap.split('\n')[0],
  }));
  // Tab reaches it, and the ring shows
  async function tabTo(page, sel, max = 90) {
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page
      .locator('body')
      .click({ position: { x: 2, y: 2 } })
      .catch(() => {});
    await page.evaluate(() => document.activeElement?.blur());
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(s => document.activeElement?.matches(s), sel)) return i;
    }
    return 0;
  }
  const n = await tabTo(T, '#proj-table');
  const ring = await T.$eval('#proj-table', e => {
    const c = getComputedStyle(e);
    return { style: c.outlineStyle, width: c.outlineWidth, focusVisible: e.matches(':focus-visible') };
  });
  await check('T5', 'Tab reaches the panel; it shows a focus ring (outline) when focused by keyboard', T, async () => ({
    pass: n > 0 && ring.focusVisible && ring.style !== 'none' && parseFloat(ring.width) > 0,
    ev: { tabs: n, ring },
  }));
  await T.screenshot({ path: L.OUT + '/T-focus.png' });
  // arrows scroll it (at a width where it scrolls)
  const N = await mk(900, 800, 'T900');
  await H.goProjects(N, 'table');
  const pre = await N.$eval('#proj-table', e => [e.scrollWidth, e.clientWidth]);
  const n2 = await tabTo(N, '#proj-table');
  for (let i = 0; i < 6; i++) await N.keyboard.press('ArrowRight');
  await sleep(300);
  const s1 = await N.$eval('#proj-table', e => e.scrollLeft);
  for (let i = 0; i < 12; i++) await N.keyboard.press('ArrowRight');
  await sleep(300);
  const sEnd = await N.$eval('#proj-table', e => [e.scrollLeft, e.scrollWidth - e.clientWidth]);
  for (let i = 0; i < 3; i++) await N.keyboard.press('ArrowLeft');
  await sleep(300);
  const s2 = await N.$eval('#proj-table', e => e.scrollLeft);
  await check('T6', '900px (panel scrolls): the focused panel scrolls with ArrowRight (to the far end) and ArrowLeft', N, async () => ({
    pass: pre[0] > pre[1] && n2 > 0 && s1 > 0 && sEnd[0] >= sEnd[1] - 1 && s2 < sEnd[0],
    ev: { pre, tabs: n2, afterRight: s1, end: sEnd, afterLeft: s2 },
  }));
  // a render keeps the horizontal scroll
  await N.evaluate(() => window.__pmspace.render());
  await sleep(300);
  const s3 = await N.$eval('#proj-table', e => e.scrollLeft);
  await check('T7', "a render keeps the panel's horizontal scroll position", N, async () => ({ pass: Math.abs(s3 - s2) <= 1, ev: { before: s2, after: s3 } }));
  for (const w of [390, 320]) {
    const ph = await mk(w, 800, 'T' + w);
    await H.goProjects(ph, 'table');
    const sc = await H.noHScroll(ph);
    const pn = await ph.$eval('#proj-table', e => [e.scrollWidth, e.clientWidth]);
    await check('T8-' + w, `${w}px: no horizontal page scroll; the table scrolls inside its panel`, ph, async () => ({
      pass: sc.sw <= sc.cw && sc.bsw <= sc.cw && pn[0] > pn[1],
      ev: { sc, panel: pn },
    }));
    await ph.screenshot({ path: L.OUT + `/T-${w}.png` });
  }
  const row1 = await H.tableRow(T, P1);
  await check('T9', 'P1 row: Client, End user, PO values in the first three cells after the name', T, async () => ({
    pass: row1.slice(1, 4).join('|') === 'Northwind Traders|Northwind customers|PO-2026-0417',
    ev: row1.slice(0, 5),
  }));

  // ================= OVERVIEW (item 4)
  const longTxt = 'lorem ipsum dolor sit amet '.repeat(10).slice(0, 200).trim();
  const unbroken = 'Unbroken'.repeat(25);
  await X.putFields(X.FIELDS.map(f => ({ ...f })));
  await H.setProjectValues(P1, { f_client: longTxt, f_enduser: unbroken });
  for (const w of [1280, 320]) {
    const O = await mk(w, 900, 'O' + w);
    await H.goProject(O, P1);
    await sleep(500);
    const po = await O.evaluate(
      `(() => { const fits = ${FITS}; const dt = [...document.querySelectorAll('dl.kv dt.kv-f')].find(d => /contract/.test(d.innerText)); return fits(dt.querySelector('span'), dt); })()`,
    );
    await check('O1-' + w, `${w}px: "PO / contract no." reads in full in the overview (inside its cell, no clip, no ellipsis)`, O, async () => ({
      pass: po.text === 'PO / contract no.' && po.inside && po.noClip && !po.ellipsis,
      ev: po,
    }));
    const lv = await O.evaluate(
      `(() => { const fits = ${FITS}; const dds = [...document.querySelectorAll('dl.kv dd.kv-f .pillbtn')]; const pills = dds.map(p => ({ ...fits(p, p), h: p.getBoundingClientRect().height, right: p.getBoundingClientRect().right, title: p.title.length })); return { pills, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth }; })()`,
    );
    const long = lv.pills.filter(p => p.text.length >= 190);
    await check('O2-' + w, `${w}px: a 200-char value (spaces) and a 200-char unbroken value wrap in full; the page does not widen`, O, async () => ({
      pass:
        long.length === 2 &&
        long.every(p => p.text.length === 200 && p.lines > 1 && p.inside && p.noClip && !p.ellipsis && p.right <= lv.vw) &&
        lv.sw <= lv.vw &&
        lv.bsw <= lv.vw,
      ev: { lens: lv.pills.map(p => [p.text.length, p.lines, Math.round(p.h)]), vw: lv.vw, sw: lv.sw, bsw: lv.bsw },
    }));
    await O.screenshot({ path: L.OUT + `/O-${w}.png`, fullPage: true });
    if (w === 1280) {
      const ex = await O.evaluate(() => {
        const dt = [...document.querySelectorAll('dl.kv dt:not(.kv-f)')];
        const pb = [...document.querySelectorAll('dl.kv dd:not(.kv-f) .pillbtn')];
        return {
          dtH: [...new Set(dt.map(d => Math.round(d.getBoundingClientRect().height)))],
          ws: [...new Set(pb.map(p => getComputedStyle(p).whiteSpace))],
          n: dt.length,
        };
      });
      await check('O3', 'the existing Details rows are unchanged: 30px labels, nowrap pills', O, async () => ({
        pass: ex.dtH.join() === '30' && ex.ws.join() === 'nowrap' && ex.n >= 6,
        ev: ex,
      }));
    }
  }
  const E = await mk(1280, 900, 'O-empty');
  await H.goProject(E, P4);
  const em = await E.evaluate(() => {
    const dd = [...document.querySelectorAll('dl.kv dd.kv-f')][0];
    const sr = dd.querySelector('.sr');
    const hid = dd.querySelector('[aria-hidden="true"]');
    return {
      sr: sr?.textContent,
      srHidden: sr ? getComputedStyle(sr).position : null,
      hid: hid?.textContent,
      ariaLabel: dd.querySelectorAll('[aria-label]').length,
      html: dd.innerHTML,
    };
  });
  const ddSnap = await E.locator('dl.kv dd.kv-f').first().ariaSnapshot();
  await check(
    'O4',
    'the empty value: visually hidden "No value" plus an aria-hidden dash, no aria-label; the accessibility tree reads "No value" and no dash',
    E,
    async () => ({
      pass: em.sr === 'No value' && em.srHidden === 'absolute' && em.hid === '—' && em.ariaLabel === 0 && /No value/.test(ddSnap) && !/—/.test(ddSnap),
      ev: { em: { sr: em.sr, pos: em.srHidden, hid: em.hid, ariaLabel: em.ariaLabel }, ddSnap },
    }),
  );
  const vis = await E.evaluate(() => {
    const dd = [...document.querySelectorAll('dl.kv dd.kv-f')][0];
    return dd.innerText.trim();
  });
  await check('O4b', 'sighted view: the dd shows only a dash (the hidden text takes no space)', E, async () => ({
    pass: (await E.locator('dl.kv dd.kv-f').first().boundingBox()).height < 40,
    ev: vis,
  }));

  // ================= PROJECT FORM (item 5)
  const L1 = 'Quarterly business review cadence owner.';
  const L2 = 'Abcdefghij'.repeat(4);
  await X.putFields(
    [...X.FIELDS, { id: 'lng1', name: L1, type: 'text', inTable: false }, { id: 'lng2', name: L2, type: 'text', inTable: false }].map(f => ({ ...f })),
  );
  const F = await mk(390, 800, 'F390');
  await H.goProjects(F, 'table');
  await F.click('.ph [data-a="newProject"]');
  await sleep(600);
  const lab = await F.evaluate(
    `(() => { const fits = ${FITS}; const m = document.querySelector('.modal'); const mb = m.getBoundingClientRect(); return [...document.querySelectorAll('[role="group"][aria-labelledby="p-fields-h"] label.label')].map(l => ({ ...fits(l, l), right: l.getBoundingClientRect().right, mr: mb.right, lines: fits(l, l).lines })); })()`,
  );
  const two = lab.filter(l => l.text === L1 || l.text === L2);
  const sc = await F.evaluate(() => {
    const m = document.querySelector('.modal');
    return { m: [m.scrollWidth, m.clientWidth], page: [document.documentElement.scrollWidth, document.documentElement.clientWidth] };
  });
  await check('F1', `390px: two 40-character field labels (words / one unbroken word) read in full in the form; no horizontal scroll`, F, async () => ({
    pass:
      L1.length === 40 &&
      L2.length === 40 &&
      two.length === 2 &&
      two.every(l => l.inside && l.noClip && !l.ellipsis && l.right <= l.mr + 0.5) &&
      sc.m[0] <= sc.m[1] &&
      sc.page[0] <= sc.page[1],
    ev: { labels: lab.map(l => [l.text.length, l.lines, l.noClip]), sc },
  }));
  await F.screenshot({ path: L.OUT + '/F-390.png' });
  await H.cancelTop(F);
  // the error message is scrolled into view
  await F.setViewportSize({ width: 390, height: 520 });
  await F.click('.ph [data-a="newProject"]');
  await sleep(600);
  await F.fill('#p-name', 'R2 scroll');
  await F.locator('#p-f_kick01').scrollIntoViewIfNeeded();
  await F.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await F.keyboard.type('1231');
  await F.evaluate(() => {
    let e = document.getElementById('p-f_kick01').parentElement;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    e.scrollTop = 0;
  });
  await sleep(200);
  const before = await F.evaluate(() => {
    let e = document.getElementById('p-f_kick01').parentElement;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    const c = e.getBoundingClientRect();
    const i = document.getElementById('p-f_kick01').getBoundingClientRect();
    return { top: c.top, bottom: c.bottom, inputTop: i.top, scrollTop: e.scrollTop };
  });
  await F.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(600);
  const after = await F.evaluate(() => {
    let e = document.getElementById('p-f_kick01').parentElement;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    const c = e.getBoundingClientRect();
    const er = document.getElementById('p-f_kick01-err')?.getBoundingClientRect();
    const i = document.getElementById('p-f_kick01').getBoundingClientRect();
    return {
      top: c.top,
      bottom: c.bottom,
      err: er && [er.top, er.bottom],
      input: [i.top, i.bottom],
      scrollTop: e.scrollTop,
      vh: innerHeight,
      focus: document.activeElement.id,
    };
  });
  await check(
    'F2',
    '390x520: with the date field below the fold, Save with a bad date scrolls the error message (not only the input) fully into view; the input has the focus',
    F,
    async () => ({
      pass:
        before.inputTop > before.bottom &&
        !!after.err &&
        after.err[0] >= after.top - 0.5 &&
        after.err[1] <= after.bottom + 0.5 &&
        after.err[1] <= after.vh &&
        after.focus === 'p-f_kick01',
      ev: { before, after },
    }),
  );
  await F.screenshot({ path: L.OUT + '/F-error.png' });
  await H.cancelTop(F);
  // the case that tells the two behaviours apart: the input is already in view, at the bottom edge, so focusing it scrolls nothing and
  // the message that appears under it is below the fold unless the message itself is scrolled to
  await F.click('.ph [data-a="newProject"]');
  await sleep(600);
  await F.fill('#p-name', 'R2 scroll edge');
  await F.locator('#p-f_kick01').scrollIntoViewIfNeeded();
  await F.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await F.keyboard.type('1231');
  await F.evaluate(() => {
    const i = document.getElementById('p-f_kick01');
    let e = i.parentElement;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    e.scrollTop += i.getBoundingClientRect().bottom - (e.getBoundingClientRect().bottom - 3);
  });
  await sleep(200);
  const edge = await F.evaluate(() => {
    const i = document.getElementById('p-f_kick01');
    let e = i.parentElement;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    return { inputBottom: i.getBoundingClientRect().bottom, bodyBottom: e.getBoundingClientRect().bottom, scrollTop: e.scrollTop };
  });
  await F.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(600);
  const edgeAfter = await F.evaluate(() => {
    const i = document.getElementById('p-f_kick01');
    let e = i.parentElement;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    const er = document.getElementById('p-f_kick01-err').getBoundingClientRect();
    return { err: [er.top, er.bottom], bodyBottom: e.getBoundingClientRect().bottom, scrollTop: e.scrollTop };
  });
  await check(
    'F3',
    '390x520: input in view at the bottom edge of the dialog body, Save with a bad date: the message that appears under it is scrolled into view',
    F,
    async () => ({
      pass:
        edge.inputBottom <= edge.bodyBottom &&
        edge.inputBottom >= edge.bodyBottom - 6 &&
        edgeAfter.err[1] <= edgeAfter.bodyBottom + 0.5 &&
        edgeAfter.scrollTop > edge.scrollTop,
      ev: { edge, edgeAfter },
    }),
  );
  await H.cancelTop(F);

  // ================= VALUES (item 7)
  const V = await mk(1280, 900, 'V');
  await X.putFields([
    { id: 'client', name: 'Client', type: 'text', inTable: true },
    { id: 'budget1', name: 'Budget', type: 'number', inTable: true },
    { id: 'kick01', name: 'Kickoff', type: 'date', inTable: true },
  ]);
  await H.setProjectValues(P2, { f_budget1: 0.0004, f_kick01: '0050-01-01' });
  await H.setProjectValues(H.P(3), { f_budget1: 1234567.891, f_kick01: '2026-03-05' });
  await sleep(2500);
  await H.goProject(V, P2);
  const ov2 = await H.detailRows(V);
  await H.goProject(V, H.P(3));
  const ov3 = await H.detailRows(V);
  await H.goProjects(V, 'table');
  const tr2 = await H.tableRow(V, P2);
  const tr3 = await H.tableRow(V, H.P(3));
  const pick = (rows, n) => rows.find(r => r[0] === n)?.[1];
  await check('V1', '0.0004 shows as 0.0004 (overview and table); 1234567.891 as 1,234,567.891', V, async () => ({
    pass: pick(ov2, 'Budget') === '0.0004' && pick(ov3, 'Budget') === '1,234,567.891' && tr2[2] === '0.0004' && tr3[2] === '1,234,567.891',
    ev: { ov2: pick(ov2, 'Budget'), ov3: pick(ov3, 'Budget'), tr2: tr2.slice(0, 4), tr3: tr3.slice(0, 4) },
  }));
  await check('V2', 'a stored 0050-01-01 shows as stored (not 1950); 2026-03-05 as a formatted date', V, async () => ({
    pass: pick(ov2, 'Kickoff') === '0050-01-01' && tr2[3] === '0050-01-01' && /Mar 5, 2026|Mar 5/.test(pick(ov3, 'Kickoff')),
    ev: { ov2: pick(ov2, 'Kickoff'), tr2: tr2[3], ov3: pick(ov3, 'Kickoff') },
  }));
  const cases = [
    '0500-01-01',
    '0001-01-01',
    '0099-12-31',
    '0999-12-31',
    '1000-01-01',
    '2024-02-29',
    '2026-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-32',
    '10000-01-01',
    '26-01-01',
    '2026-1-1',
    '',
    null,
    20260101,
  ];
  const isd = await V.evaluate(async cs => {
    const { isDay } = await import('/src/core/store.js');
    return cs.map(c => !!isDay(c));
  }, cases);
  const want = [true, true, true, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false];
  await check(
    'V3',
    'isDay: real calendar days of any year >= 0001 accepted (0500-01-01, 0001-01-01, 2024-02-29); 2026-02-29/30, 04-31, month 13, malformed refused',
    V,
    async () => ({ pass: isd.join() === want.join(), ev: cases.map((c, i) => `${c}:${isd[i]}`).join(' ') }),
  );
  // the form
  await V.click('.ph [data-a="newProject"]');
  await sleep(500);
  await V.fill('#p-name', 'R2 old date');
  await V.fill('#p-f_kick01', '0500-01-01');
  await V.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(900);
  await L.settle(V);
  const old = (await L.api('GET', '/collections/projects/records?perPage=200')).body.items.find(r => r.doc.name === 'R2 old date');
  await check('V4', 'the New project form accepts 0500-01-01 and stores it', V, async () => ({
    pass: old?.doc.f_kick01 === '0500-01-01' && (await H.modals(V)) === 0,
    ev: { stored: old?.doc.f_kick01 },
  }));
  await H.goProjects(V, 'table');
  await V.click('.ph [data-a="newProject"]');
  await sleep(500);
  await V.fill('#p-name', 'R2 bad date');
  await V.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await V.keyboard.type('02302026');
  const bv = await V.$eval('#p-f_kick01', e => [e.value, e.validity.badInput]);
  await V.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(700);
  const msg = await V.locator('#p-f_kick01-err')
    .innerText()
    .catch(() => '');
  const bad = (await L.api('GET', '/collections/projects/records?perPage=200')).body.items.find(r => r.doc.name === 'R2 bad date');
  await check('V5', '02/30/2026 typed in the date input is refused ("Enter a date"), the dialog stays, nothing is stored', V, async () => ({
    pass: /Enter a date/.test(msg) && (await H.modals(V)) === 1 && !bad,
    ev: { input: bv, msg: msg.trim(), saved: !!bad },
  }));
  await H.cancelTop(V);

  await check('Z1', 'zero console errors in every session; nothing pending', V, async () => ({
    pass: allErrs().length === 0 && (await L.settle(V)).length === 0 && (await L.settle(T)).length === 0,
    ev: allErrs().slice(0, 5),
  }));
} catch (e) {
  console.log('SUITE ERROR', e);
  L.results.fail++;
}
console.log('RESULT', L.results.pass, 'pass', L.results.fail, 'fail');
await b.close();
