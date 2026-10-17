// Round 3, suite A: change detection on the Edit form (value comparison, Enter without a change event, untouched bad values), a half-typed
// value is never saved as a clear (QA 15.04b), errors drawn in place, and the live-update backstop
import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
import * as X from '../lib/fixtures.mjs';
const { sleep } = H;
const check = L.check;
await L.suLogin();
await X.putFields();
const b = await L.launch();
const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 'adminA');
const B = await H.mkPage(b, 'sarah@example.com', 1280, 800, 'adminB');
const P = n => H.P(n);
const errs = () => [...A.errs, ...B.errs];
const sent = [];
for (const [t, pg] of [
  ['A', A],
  ['B', B],
])
  pg.on('request', r => {
    if (r.method() === 'PATCH' && /\/projects\/records\//.test(r.url())) sent.push([t, JSON.parse(r.postData() || '{}')]);
  });
const keysOf = d => [...Object.keys(d.docPatch || {}), ...(d.docUnset || [])];
const st = (pg, id) =>
  pg.evaluate(i => {
    const e = document.getElementById(i);
    return e ? { val: e.value, bad: e.validity.badInput } : null;
  }, id);
const errsOf = pg =>
  pg
    .locator('[id^="p-f_"][id$="-err"]')
    .allInnerTexts()
    .then(a => a.map(H.norm));
const dlg = pg =>
  pg.evaluate(() => {
    const m = window.__pmspace.S.ui.modals;
    return m.map(x => x.type);
  });
const clickSave = async pg => {
  await pg.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(700);
};
const settleAll = async () => {
  await L.settle(A);
  await L.settle(B);
  await sleep(500);
};
try {
  await sleep(1500);

  // ---- 1. change detection
  await X.patchProject(P(4), { f_budget1: 5, f_kick01: '2026-05-01' });
  await H.waitVal(A, P(4), 'f_budget1', 5);
  await H.openEdit(A, P(4));
  // a date set by script (no input, no change event), then submitted with Enter in that input
  await A.evaluate(() => {
    const e = document.getElementById('p-f_kick01');
    e.value = '2027-03-04';
  });
  await A.focus('#p-f_kick01');
  const mBefore = await dlg(A);
  await A.keyboard.press('Enter');
  await sleep(900);
  let enterWorked = (await dlg(A)).length < mBefore.length;
  let how = 'Enter';
  if (!enterWorked) {
    // the form has no submit button, and more than one field: the browser does not submit on Enter; the app's Ctrl+Enter does
    await A.focus('#p-f_kick01');
    await A.keyboard.press('Control+Enter');
    await sleep(900);
    how = 'Ctrl+Enter';
  }
  await settleAll();
  let v = await X.fvals(P(4));
  await check(
    'C1',
    `a date set by filling the input (no change event) and submitted with ${how} is saved${enterWorked ? '' : ' (plain Enter does nothing in this form: no submit button and several fields)'}`,
    A,
    async () => ({ pass: v.f_kick01 === '2027-03-04' && v.f_budget1 === 5, ev: { how, v, modals: await dlg(A) } }),
  );

  // 5 -> 5.0 is not a change: another session's newer value survives
  await H.openEdit(A, P(4));
  await A.fill('#p-f_budget1', '5.0');
  await A.fill('#p-name', 'Product Launch r3');
  await X.patchProject(P(4), { f_budget1: 777 });
  await H.waitVal(A, P(4), 'f_budget1', 777);
  const n0 = sent.length;
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(4));
  const mine = sent
    .slice(n0)
    .filter(([t]) => t === 'A')
    .map(([, d]) => keysOf(d))
    .flat();
  await check('C2', '5 retyped as 5.0 writes nothing: the budget another session set meanwhile (777) survives, the save carries no f_ key', A, async () => ({
    pass: v.f_budget1 === 777 && !mine.some(k => k.startsWith('f_')) && mine.includes('name'),
    ev: { v, mine },
  }));
  // and a real change of the same field is written, by value
  await H.openEdit(A, P(4));
  await A.fill('#p-f_budget1', '777.50');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(4));
  await check('C2b', 'a number retyped as a different value (777.50) is written', A, async () => ({ pass: v.f_budget1 === 777.5, ev: v }));
  await H.openEdit(A, P(4));
  await A.fill('#p-f_budget1', '7.775e2');
  await A.fill('#p-name', 'Product Launch r3b');
  const n1 = sent.length;
  await clickSave(A);
  await settleAll();
  const mine2 = sent
    .slice(n1)
    .filter(([t]) => t === 'A')
    .map(([, d]) => keysOf(d))
    .flat();
  await check('C2c', '777.5 retyped as 7.775e2 (the same number) writes nothing for the field', A, async () => ({
    pass: !mine2.some(k => k.startsWith('f_')) && mine2.includes('name'),
    ev: mine2,
  }));

  // an untouched value stored by an outside writer that the input cannot show does not block an unrelated save
  await X.patchProject(P(5), { f_kick01: '20270-01-01', f_budget1: 'abc', f_risk01: 'gone1' });
  await H.waitVal(A, P(5), 'f_kick01', '20270-01-01');
  await H.openEdit(A, P(5));
  const shown = await A.evaluate(() => ({
    kick: document.getElementById('p-f_kick01').value,
    bud: document.getElementById('p-f_budget1').value,
    risk: document.getElementById('p-f_risk01').value,
  }));
  await A.fill('#p-name', 'Design System r3');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(5));
  const rec5 = await H.projRec(P(5));
  await check(
    'C3',
    'a stored 20270-01-01 (Chromium shows it in the date input; "abc" in a number field and a removed option show empty) does not block a name change, and all three survive',
    A,
    async () => ({
      pass:
        rec5.doc.name === 'Design System r3' && v.f_kick01 === '20270-01-01' && v.f_budget1 === 'abc' && v.f_risk01 === 'gone1' && !shown.bud && !shown.risk,
      ev: { shown, v, name: rec5.doc.name, modals: await dlg(A) },
    }),
  );
  // ... but typing into the date does check it
  await H.openEdit(A, P(5));
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await A.keyboard.type('1231');
  await clickSave(A);
  await check('C3b', 'a half-typed date in the same form is refused (the rule is not turned off for the field)', A, async () => ({
    pass: (await errsOf(A)).join() === 'Enter a date',
    ev: await errsOf(A),
  }));
  await A.click('.modal-f [data-a="closeModal"]');
  await sleep(300);

  // ---- 2. QA 15.04b: a half-typed number is not saved as a clear by a second Save
  await X.patchProject(P(1), { f_budget1: 1234, f_kick01: '2026-05-01' });
  await H.waitVal(A, P(1), 'f_budget1', 1234);
  await H.openEdit(A, P(1));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  const pre = await st(A, 'p-f_budget1');
  await clickSave(A);
  const post = await st(A, 'p-f_budget1');
  const e1 = await errsOf(A);
  const attrs = await A.evaluate(() => {
    const e = document.getElementById('p-f_budget1');
    return { inv: e.getAttribute('aria-invalid'), desc: e.getAttribute('aria-describedby'), cls: e.className, focus: document.activeElement === e };
  });
  await check(
    'C4',
    'half-typed number (1234 + "e"), Save: "Enter a number" drawn in place, the half-typed text is still in the box, the input has focus',
    A,
    async () => ({
      pass:
        e1.join() === 'Enter a number' &&
        post.bad === true &&
        attrs.inv === 'true' &&
        attrs.desc === 'p-f_budget1-err' &&
        /is-error/.test(attrs.cls) &&
        attrs.focus,
      ev: { pre, post, e1, attrs },
    }),
  );
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C5', 'a second Save, the box untouched: the dialog stays open with the error, and the server still has 1234', A, async () => ({
    pass: v.f_budget1 === 1234 && (await dlg(A)).length === 1 && (await errsOf(A)).join() === 'Enter a number',
    ev: { v, e: await errsOf(A) },
  }));
  await A.keyboard.press('Control+a');
  await A.keyboard.type('5678');
  const afterType = { e: await errsOf(A), s: await st(A, 'p-f_budget1') };
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C6', 'a valid value typed after the error clears the message and saves (5678)', A, async () => ({
    pass: v.f_budget1 === 5678 && afterType.e.length === 0 && (await dlg(A)).length === 0,
    ev: { v, afterType },
  }));

  // clearing the half-typed box by hand saves the clear
  await H.openEdit(A, P(1));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  await clickSave(A);
  await A.keyboard.press('Control+a');
  await A.keyboard.press('Backspace');
  const cleared = await st(A, 'p-f_budget1');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C7', 'half-typed number, error, then the box is emptied by hand and saved: the value is cleared (key gone)', A, async () => ({
    pass: !('f_budget1' in v) && (await dlg(A)).length === 0,
    ev: { cleared, v },
  }));

  // ---- 3. the same for a date (d6)
  await H.openEdit(A, P(1));
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await A.keyboard.press('Tab');
  await A.keyboard.press('Tab');
  await A.keyboard.press('Backspace'); // the year segment of 2026-05-01 emptied: the date is half typed
  const d0 = await st(A, 'p-f_kick01');
  await clickSave(A);
  const d1 = await st(A, 'p-f_kick01');
  const de1 = await errsOf(A);
  await check(
    'C8',
    'half-typed date (a segment of a stored date emptied), Save: "Enter a date" drawn in place and the segments stay as they were',
    A,
    async () => ({ pass: d0.bad === true && d1.bad === true && de1.join() === 'Enter a date', ev: { d0, d1, de1 } }),
  );
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C9', 'a second Save: the stored date is still on the server, the dialog still open', A, async () => ({
    pass: v.f_kick01 === '2026-05-01' && (await dlg(A)).length === 1,
    ev: v,
  }));
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await A.keyboard.type('12312027');
  const dv = await st(A, 'p-f_kick01');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C10', 'a valid date typed over it saves (2027-12-31)', A, async () => ({
    pass: dv.val === '2027-12-31' && v.f_kick01 === '2027-12-31',
    ev: { dv, v },
  }));
  // emptied by hand: segments cleared one by one fire no event after the first
  await H.openEdit(A, P(1));
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await A.keyboard.press('Backspace'); // month segment: half typed, change fires
  await clickSave(A);
  const ce1 = await errsOf(A);
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  for (let i = 0; i < 3; i++) {
    await A.keyboard.press('Backspace');
    await A.keyboard.press('Tab');
  } // month, day, year all empty, no event for the last two
  const ce = await st(A, 'p-f_kick01');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C11', 'date emptied by hand after the error (clearing fires no event): not an error, saves the clear (key gone)', A, async () => ({
    pass: ce1.join() === 'Enter a date' && ce.val === '' && ce.bad === false && !('f_kick01' in v) && (await dlg(A)).length === 0,
    ev: { ce1, ce, v },
  }));
  // a date half typed over an empty one: the error stays until a real value or an empty box
  await H.openEdit(A, P(1));
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await A.keyboard.type('1231');
  await clickSave(A);
  const he1 = await errsOf(A);
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  for (let i = 0; i < 3; i++) {
    await A.keyboard.press('Backspace');
    await A.keyboard.press('Tab');
  }
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(1));
  await check('C12', 'date half typed over an empty one, error, emptied by hand: saves with no value', A, async () => ({
    pass: he1.join() === 'Enter a date' && !('f_kick01' in v) && (await dlg(A)).length === 0,
    ev: { he1, v },
  }));

  // ---- 4. the backstop: a render that rebuilds the box while it is half typed
  await X.patchProject(P(2), { f_budget1: 4321, f_kick01: '2026-06-02' });
  await H.waitVal(A, P(2), 'f_budget1', 4321);
  await H.openEdit(A, P(2));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  await A.evaluate(() => window.__pmspace.render());
  await sleep(300);
  const rb = await st(A, 'p-f_budget1');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(2));
  await check(
    'C13',
    'a render while the number is half typed (box comes back empty): Save is refused with "Enter a number", the server keeps 4321',
    A,
    async () => ({
      pass: rb.val === '' && rb.bad === false && (await errsOf(A)).join() === 'Enter a number' && v.f_budget1 === 4321,
      ev: { rb, e: await errsOf(A), v },
    }),
  );
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(2));
  await check('C14', 'and again: still refused, still 4321', A, async () => ({ pass: v.f_budget1 === 4321 && (await dlg(A)).length === 1, ev: v }));
  // known edge: the rebuilt box is empty and still bad; typing and deleting a character releases it
  await A.click('#p-f_budget1');
  await A.keyboard.type('1');
  await A.keyboard.press('Backspace');
  const afterTD = await errsOf(A);
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(2));
  await check(
    'C15',
    'known edge: after such a render the person types a character and deletes it: the box is then empty by their hand and the save clears the value',
    A,
    async () => ({ pass: afterTD.length === 0 && !('f_budget1' in v) && (await dlg(A)).length === 0, ev: { afterTD, v } }),
  );
  // a live update from another session while it is half typed
  await X.patchProject(P(3), { f_budget1: 99, f_kick01: '2026-07-07' });
  await H.waitVal(A, P(3), 'f_budget1', 99);
  await H.openEdit(A, P(3));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  await X.patchProject(P(3), { f_client: 'Live change' });
  await H.waitVal(A, P(3), 'f_client', 'Live change');
  await sleep(600);
  const lv = await st(A, 'p-f_budget1');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(3));
  await check(
    'C16',
    'a live update from another session while the number is half typed: no delete (99 stays on the server), and Save is refused or the text is still there',
    A,
    async () => ({
      pass: v.f_budget1 === 99 && v.f_client === 'Live change' && (await errsOf(A)).join() === 'Enter a number',
      ev: { lv, e: await errsOf(A), v },
    }),
  );
  await A.click('.modal-f [data-a="closeModal"]');
  await sleep(300);

  // ---- 5. the name is also invalid: render() as before, and the half-typed number still cannot be saved as a clear
  await H.openEdit(A, P(2));
  await A.fill('#p-f_budget1', '12');
  await clickSave(A);
  await settleAll(); // (P2 had no budget: it is 12 now)
  await H.openEdit(A, P(2));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  await A.fill('#p-name', '');
  await clickSave(A);
  const nameErr = await A.locator('#p-name').getAttribute('aria-invalid');
  const nb = await st(A, 'p-f_budget1');
  await A.fill('#p-name', 'Mobile App r3');
  await clickSave(A);
  await settleAll();
  v = await X.fvals(P(2));
  await check(
    'C17',
    'name empty and a half-typed number: the name error is drawn (render), the box is rebuilt empty, and after the name is fixed the number is still refused; 12 stays',
    A,
    async () => ({
      pass: nameErr === 'true' && nb.val === '' && (await errsOf(A)).join() === 'Enter a number' && v.f_budget1 === 12,
      ev: { nameErr, nb, e: await errsOf(A), v },
    }),
  );
  // markup parity: the message drawn in place is the one render() draws
  const ser = () => document.getElementById('p-f_budget1').closest('.field').cloneNode(true);
  function flat(n) {
    return n.nodeType === 3
      ? n.textContent
      : '<' +
          n.tagName +
          [...n.attributes]
            .filter(a => a.name !== 'value')
            .map(a => ` ${a.name}="${a.value}"`)
            .sort()
            .join('') +
          '>' +
          [...n.childNodes].map(flat).join('') +
          '</>';
  }
  const inPlace = await A.evaluate(`(${flat.toString()})((${ser.toString()})())`);
  await A.evaluate(() => window.__pmspace.render());
  await sleep(200);
  const rendered = await A.evaluate(`(${flat.toString()})((${ser.toString()})())`);
  await check('C18', 'the error markup drawn in place is exactly what render() draws for the same state', A, async () => ({
    pass: inPlace === rendered && /role="alert"/.test(rendered) && /aria-describedby="p-f_budget1-err"/.test(rendered),
    ev: { inPlace: inPlace.slice(0, 400), rendered: rendered.slice(0, 400) },
  }));
  await A.click('.modal-f [data-a="closeModal"]');
  await sleep(300);

  // two errors at once; fixing one leaves the other
  await H.openEdit(A, P(2));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  await A.locator('#p-f_kick01').click({ position: { x: 12, y: 10 } });
  await A.keyboard.press('Tab');
  await A.keyboard.press('Tab');
  await A.keyboard.press('Backspace');
  await clickSave(A);
  const two = await errsOf(A);
  const focused = await A.evaluate(() => document.activeElement?.id);
  await A.click('#p-f_budget1');
  await A.keyboard.press('Control+a');
  await A.keyboard.type('3');
  const one = await errsOf(A);
  await clickSave(A);
  const stillOne = await errsOf(A);
  await check(
    'C19',
    "two refused fields: both messages, focus on the first; fixing the number removes its message and a Save keeps the date's",
    A,
    async () => ({
      pass: two.join('|') === 'Enter a number|Enter a date' && focused === 'p-f_budget1' && one.join() === 'Enter a date' && stillOne.join() === 'Enter a date',
      ev: { two, focused, one, stillOne },
    }),
  );
  await A.click('.modal-f [data-a="closeModal"]');
  await sleep(300);

  // a new project: every field is still checked, the half-typed text stays
  await A.evaluate(() => window.__pmspace.go('projects'));
  await sleep(500);
  await A.click('[data-a="newProject"]');
  await sleep(400);
  await A.fill('#p-name', 'New with budget');
  await A.click('#p-f_budget1');
  await A.keyboard.type('1e');
  await clickSave(A);
  const nw = { e: await errsOf(A), s: await st(A, 'p-f_budget1'), m: await dlg(A) };
  await A.keyboard.press('Control+a');
  await A.keyboard.type('250');
  await clickSave(A);
  await settleAll();
  const created = (await L.api('GET', '/collections/projects/records?perPage=50&filter=' + encodeURIComponent('doc.name = "New with budget"'))).body.items?.[0];
  await check('C20', 'new project: "1e" refused in place (text still there); typing 250 creates it with the number', A, async () => ({
    pass: nw.e.join() === 'Enter a number' && nw.s.bad === true && nw.m.length === 1 && created?.doc?.f_budget1 === 250,
    ev: { nw, created: created?.doc?.f_budget1 },
  }));

  await check('C21', 'zero console errors in both sessions; nothing pending', A, async () => {
    const p = [...(await L.pend(A)), ...(await L.pend(B))];
    return { pass: errs().length === 0 && p.length === 0, ev: { errs: errs().slice(0, 4), pend: p } };
  });
} catch (e) {
  console.log('SUITE ERROR', e);
}
console.log(`RESULT ${L.results.pass} pass ${L.results.fail} fail`);
await b.close();
