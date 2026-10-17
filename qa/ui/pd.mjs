// Project form: a half-typed Target date (QA follow-up of 15.04b), Edit writes only what the person changed, a project with no target date
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
const creates = [];
for (const [t, pg] of [
  ['A', A],
  ['B', B],
])
  pg.on('request', r => {
    if (r.method() === 'POST' && /\/projects\/records/.test(r.url())) creates.push([t, JSON.parse(r.postData() || '{}')]);
  });
// every key a PATCH carries: the columns as they are, and the doc keys that changed or went away
const keysOf = d => [...Object.keys(d).filter(k => k !== 'docPatch' && k !== 'docUnset'), ...Object.keys(d.docPatch || {}), ...(d.docUnset || [])];
const mine = (t, n0) =>
  sent
    .slice(n0)
    .filter(([x]) => x === t)
    .map(([, d]) => keysOf(d))
    .flat()
    .sort();
const st = (pg, id) =>
  pg.evaluate(i => {
    const e = document.getElementById(i);
    return e ? { val: e.value, bad: e.validity.badInput } : null;
  }, id);
const dlg = pg => pg.evaluate(() => window.__pmspace.S.ui.modals.map(x => x.type));
const clickSave = async pg => {
  await pg.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(700);
};
const settleAll = async () => {
  await L.settle(A);
  await L.settle(B);
  await sleep(500);
};
const errTexts = pg =>
  pg
    .locator('[id^="p-"][id$="-err"]')
    .allInnerTexts()
    .then(a => a.map(H.norm));
const dueErr = pg =>
  pg
    .locator('#p-due-err')
    .allInnerTexts()
    .then(a => a.map(H.norm));
const dueAttrs = pg =>
  pg.evaluate(() => {
    const e = document.getElementById('p-due');
    return {
      inv: e.getAttribute('aria-invalid'),
      desc: e.getAttribute('aria-describedby'),
      cls: e.className,
      focus: document.activeElement === e,
      bad: e.validity.badInput,
      val: e.value,
      same: e.__pd === 1,
    };
  });
const mark = pg =>
  pg.evaluate(() => {
    document.getElementById('p-due').__pd = 1;
  });
const month = pg => pg.locator('#p-due').click({ position: { x: 12, y: 10 } }); // the month segment (mm/dd/yyyy)
const emptyAll = async pg => {
  await month(pg);
  for (let i = 0; i < 3; i++) {
    await pg.keyboard.press('Backspace');
    await pg.keyboard.press('Tab');
  }
}; // month, day, year: no event after the first
const rec = pid => H.projRec(pid);
const patchRec = async (pid, body) => L.api('PATCH', '/collections/projects/records/' + pid, body);
const cancel = async pg => {
  await pg.click('.modal-f [data-a="closeModal"]');
  await sleep(300);
};
const M = n => 'seed000000000m' + n;
try {
  await sleep(1500);

  // ---- 1. Edit: one segment of the Target date backspaced, Save
  await H.openEdit(A, P(2));
  const base2 = await rec(P(2));
  await month(A);
  await A.keyboard.press('Backspace');
  const h0 = await st(A, 'p-due');
  await mark(A);
  let n0 = sent.length;
  await clickSave(A);
  await settleAll();
  let at = await dueAttrs(A);
  let de = await dueErr(A);
  let r2 = await rec(P(2));
  await check(
    'T1',
    'Edit, one segment of the Target date backspaced, Save: "Enter a date" under the box, aria-invalid, focus on the same element, still badInput, dialog open, server due unchanged, nothing sent',
    A,
    async () => ({
      pass:
        h0.bad &&
        h0.val === '' &&
        de.join() === 'Enter a date' &&
        at.inv === 'true' &&
        at.desc === 'p-due-err' &&
        /is-error/.test(at.cls) &&
        at.focus &&
        at.same &&
        at.bad &&
        (await dlg(A)).length === 1 &&
        r2.doc.due === base2.doc.due &&
        sent.length === n0 &&
        (await L.pend(A)).length === 0,
      ev: { h0, de, at, due: r2.doc.due, sentNow: sent.length - n0 },
    }),
  );
  // a second Save: still refused (the box untouched)
  await clickSave(A);
  await settleAll();
  de = await dueErr(A);
  r2 = await rec(P(2));
  at = await dueAttrs(A);
  await check('T1b', 'a second Save, the box untouched: still refused, same element, server due unchanged', A, async () => ({
    pass: de.join() === 'Enter a date' && at.same && at.bad && r2.doc.due === base2.doc.due && (await dlg(A)).length === 1,
    ev: { de, at, due: r2.doc.due },
  }));

  // ---- 2 and 10. finish typing a full date: the message goes in place
  await month(A);
  await A.keyboard.type('02032027');
  at = await dueAttrs(A);
  de = await dueErr(A);
  await check('T2', 'a full date typed over it: the message, red border and aria-describedby are gone without a render (same element)', A, async () => ({
    pass:
      at.val === '2027-02-03' &&
      de.length === 0 &&
      at.same &&
      at.inv === 'false' &&
      at.desc === null &&
      !/is-error/.test(at.cls) &&
      !at.bad &&
      (await errTexts(A)).length === 0,
    ev: { at, de },
  }));
  n0 = sent.length;
  await clickSave(A);
  await settleAll();
  r2 = await rec(P(2));
  await check('T2b', 'Save: the server has the new date, and the save carried only due', A, async () => ({
    pass: r2.doc.due === '2027-02-03' && (await dlg(A)).length === 0 && mine('A', n0).join() === 'due',
    ev: { due: r2.doc.due, keys: mine('A', n0), modals: await dlg(A) },
  }));

  // ---- 3. QA 15.04b shape: half-typed due, the name emptied (the name error rebuilds the box), the name fixed
  await H.openEdit(A, P(2));
  await month(A);
  await A.keyboard.press('Backspace');
  await A.fill('#p-name', '');
  await clickSave(A);
  const nameErr = await A.locator('#p-name').getAttribute('aria-invalid');
  const rebuilt = await st(A, 'p-due');
  await A.fill('#p-name', 'Mobile App pd');
  n0 = sent.length;
  await clickSave(A);
  await settleAll();
  de = await dueErr(A);
  r2 = await rec(P(2));
  at = await dueAttrs(A);
  await check(
    'T3',
    'half-typed due, then the name emptied and Save (the box is rebuilt empty), the name fixed and Save: still refused "Enter a date", focus on the box, the server keeps its due and its name',
    A,
    async () => ({
      pass:
        nameErr === 'true' &&
        rebuilt.val === '' &&
        !rebuilt.bad &&
        de.join() === 'Enter a date' &&
        at.focus &&
        at.inv === 'true' &&
        r2.doc.due === '2027-02-03' &&
        r2.doc.name === 'Mobile App' &&
        (await dlg(A)).length === 1 &&
        sent.length === n0,
      ev: { nameErr, rebuilt, de, at, due: r2.doc.due, name: r2.doc.name },
    }),
  );
  // markup parity: the message drawn in place is the one render() draws
  const flatSrc = `(n => { function flat(n) { return n.nodeType === 3 ? n.textContent : '<' + n.tagName + [...n.attributes].filter(a => a.name !== 'value').map(a => ' ' + a.name + '="' + a.value + '"').sort().join('') + '>' + [...n.childNodes].map(flat).join('') + '</>'; } return flat(document.getElementById('p-due').closest('.field')); })()`;
  const inPlace = await A.evaluate(flatSrc);
  await A.evaluate(() => window.__pmspace.render());
  await sleep(200);
  const rendered = await A.evaluate(flatSrc);
  await check('T3b', 'the Target date error markup drawn in place is exactly what render() draws for the same state', A, async () => ({
    pass: inPlace === rendered && /role="alert"/.test(rendered) && /aria-describedby="p-due-err"/.test(rendered) && /aria-invalid="true"/.test(rendered),
    ev: { inPlace: inPlace.slice(0, 300), rendered: rendered.slice(0, 300) },
  }));
  // after the render the box is empty and still refused; the name is untouched, nothing is sent
  await clickSave(A);
  await settleAll();
  de = await dueErr(A);
  await check('T3c', 'after that render a Save is still refused (the rebuilt box is empty, the key is in bad)', A, async () => ({
    pass: de.join() === 'Enter a date' && (await dlg(A)).length === 1 && (await rec(P(2))).doc.due === '2027-02-03',
    ev: de,
  }));
  await cancel(A);

  // ---- 4. every segment emptied by hand: the clear is saved; the overview and the table read right
  await H.openEdit(A, P(3));
  await emptyAll(A);
  const e0 = await st(A, 'p-due');
  n0 = sent.length;
  await clickSave(A);
  await settleAll();
  let r3 = await rec(P(3));
  await check('T4', 'Target date emptied segment by segment, Save: the server due is "" and the dialog closes; the save carried only due', A, async () => ({
    pass: e0.val === '' && !e0.bad && r3.doc.due === '' && (await dlg(A)).length === 0 && mine('A', n0).join() === 'due',
    ev: { e0, due: r3.doc.due, keys: mine('A', n0) },
  }));
  await H.goProject(A, P(3));
  const prog = H.norm(await A.locator('section.panel', { hasText: 'Progress' }).first().innerText());
  const rows = await H.detailRows(A);
  const dueRow = rows.find(r => r[0] === 'Due');
  await check(
    'T4b',
    'the overview shows "No target date" in the Progress line (no "Ended", no day count) and the Due pill is the empty-pill dash with "No target date" for screen readers (round 2: it read "None")',
    A,
    async () => ({
      pass:
        /No target date/.test(prog) &&
        !/Ended|days until/.test(prog) &&
        (await A.locator('dl dt:has-text("Due") + dd .pillbtn.empty .sr').innerText()) === 'No target date' &&
        (await A.locator('dl dt:has-text("Due") + dd .pillbtn.empty [aria-hidden="true"]').innerText()) === '—',
      ev: { prog: prog.slice(0, 120), dueRow },
    }),
  );
  await H.goProjects(A, 'table');
  await A.evaluate(() => {
    window.__pmspace.S.ui.projSort = 'due';
    window.__pmspace.render();
  });
  await sleep(300);
  const order = await A.$$eval('#proj-table tbody tr', rs => rs.map(r => r.dataset.id));
  const dueOf = {};
  for (const id of order) dueOf[id] = (await rec(id)).doc.due;
  const dated = order.filter(id => dueOf[id]);
  await check('T4c', 'the Projects table sorted by Due: the project without a date is last, the dated ones ascend', A, async () => ({
    pass: order.length >= 5 && order[order.length - 1] === P(3) && dated.every((id, i) => i === 0 || dueOf[dated[i - 1]] <= dueOf[id]),
    ev: order.map(i => i.slice(-2) + ':' + (dueOf[i] || '-')).join(' '),
  }));
  await A.evaluate(() => {
    window.__pmspace.S.ui.projSort = 'recent';
    window.__pmspace.render();
  });

  // ---- 5. New project
  await A.evaluate(() => window.__pmspace.go('projects'));
  await sleep(500);
  await A.click('[data-a="newProject"]');
  await sleep(400);
  const due0 = await A.inputValue('#p-due');
  await A.fill('#p-name', 'PD New A');
  await month(A);
  await A.keyboard.press('Backspace');
  n0 = creates.length;
  await clickSave(A);
  await settleAll();
  de = await dueErr(A);
  at = await dueAttrs(A);
  const find = async name =>
    (await L.api('GET', '/collections/projects/records?perPage=50&filter=' + encodeURIComponent(`doc.name = "${name}"`))).body.items || [];
  await check(
    'N1',
    'New project, Target date half typed, Save: refused "Enter a date" in place (typed segments stay), dialog open, nothing created',
    A,
    async () => ({
      pass: de.join() === 'Enter a date' && at.bad && at.focus && (await dlg(A)).length === 1 && (await find('PD New A')).length === 0 && creates.length === n0,
      ev: { de, at, found: (await find('PD New A')).length },
    }),
  );
  await emptyAll(A);
  at = await dueAttrs(A);
  await clickSave(A);
  await settleAll();
  const made = (await find('PD New A'))[0];
  await check('N2', 'then the box emptied by hand and Save: created, with the +30 days the form opened with', A, async () => ({
    pass: at.val === '' && !at.bad && made?.doc?.due === due0 && /^\d{4}-\d{2}-\d{2}$/.test(due0) && (await dlg(A)).length === 0,
    ev: { due0, made: made?.doc?.due, at },
  }));
  // a date set by script, no event, on a New project
  await A.evaluate(() => window.__pmspace.go('projects'));
  await sleep(500);
  await A.click('[data-a="newProject"]');
  await sleep(400);
  await A.fill('#p-name', 'PD New B');
  await A.evaluate(() => {
    document.getElementById('p-due').value = '2027-09-09';
  });
  await clickSave(A);
  await settleAll();
  const madeB = (await find('PD New B'))[0];
  await check('N3', 'New project, the date set with no event: created with that date (read from the box)', A, async () => ({
    pass: madeB?.doc?.due === '2027-09-09',
    ev: madeB?.doc?.due,
  }));

  // ---- 6. two sessions: B changes name, desc, team and due; A changes only the icon
  await H.openEdit(A, P(4));
  const b4 = await rec(P(4));
  await H.openEdit(B, P(4));
  await B.fill('#p-name', 'PD Launch B');
  await B.fill('#p-desc', 'Written by B');
  await H.pick(B, 'p-team', 'Marketing');
  await B.fill('#p-due', '2027-05-05');
  n0 = sent.length;
  await clickSave(B);
  await settleAll();
  const keysB = mine('B', n0);
  await H.waitVal(A, P(4), 'name', 'PD Launch B');
  const icons = await A.$$eval('.iconpick button', bs => bs.map(x => x.dataset.v));
  const icon = icons.find(i => i !== b4.doc.icon);
  await A.click(`.iconpick button[data-v="${icon}"]`);
  await sleep(200);
  const n1 = sent.length;
  await clickSave(A);
  await settleAll();
  let r4 = await rec(P(4));
  await check(
    'S1',
    "A opens Edit, B changes name, desc, team and due; A changes only the icon: the server has B's four and A's icon, and A's save carried only icon",
    A,
    async () => ({
      pass:
        r4.doc.name === 'PD Launch B' &&
        r4.doc.desc === 'Written by B' &&
        r4.team === 'seed00000000mkt' &&
        r4.doc.due === '2027-05-05' &&
        r4.doc.icon === icon &&
        r4.doc.icon !== b4.doc.icon &&
        mine('A', n1).join() === 'icon' &&
        (await dlg(A)).length === 0,
      ev: { r4: { name: r4.doc.name, desc: r4.doc.desc, team: r4.team, due: r4.doc.due, icon: r4.doc.icon }, was: b4.doc.icon, keysA: mine('A', n1), keysB },
    }),
  );
  // the colour the same way
  await H.openEdit(A, P(4));
  const colors = await A.$$eval('.swatches button', bs => bs.map(x => x.dataset.v));
  const color = colors.find(c => c !== r4.doc.color);
  await A.click(`.swatches button[data-v="${color}"]`);
  await sleep(200);
  const n2 = sent.length;
  await clickSave(A);
  await settleAll();
  r4 = await rec(P(4));
  await check('S1b', 'a colour picked alone writes only color', A, async () => ({
    pass: r4.doc.color === color && mine('A', n2).join() === 'color',
    ev: { color: r4.doc.color, keys: mine('A', n2) },
  }));

  // ---- 7. lead and members
  await patchRec(P(5), { lead: M(2), members: [M(1), M(2)] });
  await H.waitVal(A, P(5), 'lead', M(2));
  await H.openEdit(A, P(5));
  await patchRec(P(5), { lead: M(3), members: [M(1), M(3)] }); // B's change: the old lead m2 is no longer a member
  await H.waitVal(A, P(5), 'lead', M(3));
  await A.fill('#p-name', 'PD Design A');
  const n3 = sent.length;
  await clickSave(A);
  await settleAll();
  let r5 = await rec(P(5));
  await check(
    'L1',
    "A opens Edit, B changes the lead (and drops the old one from the members); A edits only the name: the lead is B's and the members did not gain A's stale lead",
    A,
    async () => ({
      pass: r5.doc.name === 'PD Design A' && r5.lead === M(3) && r5.members.slice().sort().join() === [M(1), M(3)].join() && mine('A', n3).join() === 'name',
      ev: { name: r5.doc.name, lead: r5.lead, members: r5.members, keys: mine('A', n3) },
    }),
  );
  await H.openEdit(A, P(5));
  const leadOpts = await A.$$eval('#p-lead option', os => os.map(o => [o.value, o.text]));
  const newLead = leadOpts.find(([v]) => v === M(4)) || leadOpts.find(([v]) => ![M(1), M(3)].includes(v));
  await H.pick(A, 'p-lead', newLead[1]);
  const n4 = sent.length;
  await clickSave(A);
  await settleAll();
  r5 = await rec(P(5));
  await check('L2', 'A changes the lead in the form: the lead is written and the members gain the new lead', A, async () => ({
    pass:
      r5.lead === newLead[0] &&
      r5.members.includes(newLead[0]) &&
      r5.members.includes(M(1)) &&
      r5.members.includes(M(3)) &&
      mine('A', n4).join() === ['lead', 'members'].sort().join(),
    ev: { lead: r5.lead, members: r5.members, keys: mine('A', n4), newLead },
  }));

  // ---- 8. a date filled in with no event
  await H.openEdit(A, P(6));
  await A.evaluate(() => {
    document.getElementById('p-due').value = '2027-06-06';
  });
  const n5 = sent.length;
  await clickSave(A);
  await settleAll();
  const r6 = await rec(P(6));
  await check('E1', 'Edit, the date set with no event (Safari before an Enter submit), Save: due is written, nothing else', A, async () => ({
    pass: r6.doc.due === '2027-06-06' && mine('A', n5).join() === 'due',
    ev: { due: r6.doc.due, keys: mine('A', n5) },
  }));
  // nothing changed at all
  await H.openEdit(A, P(1));
  const r1a = await rec(P(1));
  const n6 = sent.length;
  await clickSave(A);
  await settleAll();
  const toasts = await H.toastTexts(A);
  const r1b = await rec(P(1));
  await check('E2', 'nothing changed: the dialog closes, "Project updated", no request, the record is as it was', A, async () => ({
    pass: (await dlg(A)).length === 0 && toasts.some(t => /Project updated/.test(t)) && sent.length === n6 && JSON.stringify(r1a) === JSON.stringify(r1b),
    ev: { toasts, sentNow: sent.length - n6 },
  }));

  // ---- 9. values the inputs cannot show
  await L.api('POST', '/collections/teams/records', {
    id: 'pdteam000000w2t',
    workspace: H.W2,
    name: 'PD Elsewhere',
    doc: { c: '#112233', desc: 'a team of another workspace', icon: 'palette' },
  });
  const odd = await patchRec(P(7), { team: 'pdteam000000w2t', doc: { ...(await rec(P(7))).doc, name: 'Line one\nLine two', desc: 'First\r\nSecond' } });
  await H.waitVal(A, P(7), 'team', 'pdteam000000w2t');
  await H.openEdit(A, P(7));
  const shown = await A.evaluate(() => ({
    name: document.getElementById('p-name').value,
    desc: document.getElementById('p-desc').value,
    team: document.getElementById('p-team').value,
  }));
  await A.fill('#p-due', '2027-08-08');
  const n7 = sent.length;
  const body7 = () => sent.slice(n7).map(([, d]) => d);
  await clickSave(A);
  await settleAll();
  const r7 = await rec(P(7));
  await check(
    'V1',
    'a name with a line break, a description with \\r\\n and a team the list lacks: editing only the due date changes only due on the server',
    A,
    async () => ({
      pass:
        odd.status === 200 &&
        r7.doc.name === 'Line one\nLine two' &&
        r7.doc.desc === 'First\r\nSecond' &&
        r7.team === 'pdteam000000w2t' &&
        r7.doc.due === '2027-08-08' &&
        mine('A', n7).join() === 'due',
      ev: { shown, name: r7.doc.name, desc: r7.doc.desc, team: r7.team, due: r7.doc.due, keys: mine('A', n7), bodies: body7() },
    }),
  );
  // touching one of them does write it
  await H.openEdit(A, P(7));
  await A.fill('#p-name', 'Plain name');
  const n8 = sent.length;
  await clickSave(A);
  await settleAll();
  const r7b = await rec(P(7));
  await check('V2', 'touching the name writes it (and only it); the description and the team stay', A, async () => ({
    pass: r7b.doc.name === 'Plain name' && r7b.doc.desc === 'First\r\nSecond' && r7b.team === 'pdteam000000w2t' && mine('A', n8).join() === 'name',
    ev: { name: r7b.doc.name, keys: mine('A', n8) },
  }));

  // ---- 11. the Target date with the project fields: both messages, the date's first, focus on it
  await H.openEdit(A, P(1));
  await A.click('#p-f_budget1');
  await A.keyboard.press('End');
  await A.keyboard.type('e');
  await month(A);
  await A.keyboard.press('Backspace');
  await clickSave(A);
  const both = await errTexts(A);
  const ids = await A.$$eval('[id^="p-"][id$="-err"]', es => es.map(e => e.id));
  const foc = await A.evaluate(() => document.activeElement?.id);
  await A.click('#p-f_budget1');
  await A.keyboard.press('Control+a');
  await A.keyboard.type('3');
  const left = await errTexts(A);
  await check(
    'F1',
    "the Target date and a number field both half typed: both messages, the date's first, focus on the date; fixing the number leaves the date's message",
    A,
    async () => ({
      pass: both.join('|') === 'Enter a date|Enter a number' && ids.join() === 'p-due-err,p-f_budget1-err' && foc === 'p-due' && left.join() === 'Enter a date',
      ev: { both, ids, foc, left },
    }),
  );
  await cancel(A);

  await check('Z1', 'zero console errors in both sessions; nothing pending', A, async () => {
    const p = [...(await L.pend(A)), ...(await L.pend(B))];
    return { pass: errs().length === 0 && p.length === 0, ev: { errs: errs().slice(0, 4), pend: p } };
  });
} catch (e) {
  console.log('SUITE ERROR', e);
}
console.log(`RESULT ${L.results.pass} pass ${L.results.fail} fail`);
await b.close();
