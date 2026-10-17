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
const rec = pid => H.projRec(pid);
const patchRec = async (pid, body) => L.api('PATCH', '/collections/projects/records/' + pid, body);
const M = n => 'seed000000000m' + n;
try {
  await sleep(1500);
  let n0 = 0;

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
} catch (e) {
  console.log('SUITE ERROR', e);
}
console.log(`RESULT ${L.results.pass} pass ${L.results.fail} fail`);
await b.close();
