// Round 3, suite C: the fields editor (read-only Type, remove-options confirm, copy), the overview's field rows (top-aligned, the dash, no title), tiny numbers
import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
import * as X from '../lib/fixtures.mjs';
const { sleep, norm } = H;
const check = L.check;
await L.suLogin();
const T = (id, name, extra = {}) => ({ id, name, type: 'text', inTable: false, ...extra });
const OPTS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((n, i) => ({ id: 'o' + (i + 1), name: n }));
const LONGNAME = 'A rather long field name that has to wrap inside the label column of the overview';
const LONGVAL =
  'Northwind Traders international procurement and logistics group, a client with a very long name that goes on over several lines of the overview';
await X.putFields([
  T('client', 'Client'),
  T('longn', LONGNAME),
  T('empty', 'Not filled'),
  T('short', 'Short'),
  { id: 'phase', name: 'Phase', type: 'select', inTable: false, options: OPTS },
  { id: 'budget1', name: 'Budget', type: 'number', inTable: true },
]);
await H.setProjectValues(H.P(1), { f_client: LONGVAL, f_longn: LONGVAL, f_short: 'ok', f_phase: 'o1', f_budget1: 1e-21 });
await H.setProjectValues(H.P(2), { f_phase: 'o1', f_budget1: -1e-21 });
await H.setProjectValues(H.P(3), { f_phase: 'o2', f_budget1: 0.0004 });
await H.setProjectValues(H.P(4), { f_budget1: 0 });
await sleep(2500);
const b = await L.launch();
const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 'adminA');
const shot = (pg, n, opt = {}) => pg.screenshot({ path: `${L.OUT}/${n}.png`, ...opt });
const openPhase = async () => {
  await A.click('[data-a="editField"][aria-label="Edit Phase"]');
  await sleep(400);
};
const rm = async n => {
  await A.click(`[data-a="fdOptRemove"][aria-label="Remove ${n}"]`);
  await sleep(150);
};
const closeAll = async () => {
  for (let i = 0; i < 3; i++) {
    if (!(await H.modals(A))) break;
    await H.cancelTop(A);
  }
};
try {
  await H.goSettings(A);
  await sleep(500);

  // ---- 5. copy
  const intro = norm(await A.locator('.set-in').first().innerText());
  await check(
    'D1',
    'Settings intro: "Project fields for <workspace>. Fill in values on a project’s Edit form. They show in its overview, and in the Projects table when “Show in the Projects table” is on."',
    A,
    async () => ({
      pass: /Project fields for [^.]+\. Fill in values on a project’s Edit form\. They show in its overview, and in the Projects table when “Show in the Projects table” is on\./.test(
        intro,
      ),
      ev: intro.slice(0, 260),
    }),
  );
  await A.click('[data-a="newField"]');
  await sleep(400);
  const dlg = norm(await A.locator('.modal').last().innerText());
  await check('D2', 'New field dialog subtitle: "Each project’s value is filled in on its Edit form."', A, async () => ({
    pass: dlg.includes('Each project’s value is filled in on its Edit form.') && !/Fill in each project/.test(dlg),
    ev: dlg.slice(0, 120),
  }));
  await H.cancelTop(A);

  // ---- 3. read-only Type
  await openPhase();
  await A.evaluate(() => document.activeElement?.blur());
  await A.mouse.move(5, 5);
  await sleep(200); // (the name has the focus, and with it the focus border, when the dialog opens)
  const ty = await A.evaluate(() => {
    const t = document.getElementById('fd-type'),
      n = document.getElementById('fd-name');
    const cs = e => getComputedStyle(e);
    return {
      ro: t.readOnly,
      dis: t.disabled,
      bgT: cs(t).backgroundColor,
      bgN: cs(n).backgroundColor,
      colT: cs(t).color,
      colN: cs(n).color,
      cur: cs(t).cursor,
      curN: cs(n).cursor,
      bdT: cs(t).borderColor,
      bdN: cs(n).borderColor,
      op: cs(t).opacity,
    };
  });
  await A.hover('#fd-type');
  await sleep(250);
  const bdHover = await A.evaluate(() => getComputedStyle(document.getElementById('fd-type')).borderColor);
  await A.hover('#fd-name');
  await sleep(250);
  const bdNameHover = await A.evaluate(() => getComputedStyle(document.getElementById('fd-name')).borderColor);
  await A.mouse.move(5, 5);
  await sleep(150);
  await A.focus('#fd-name');
  await A.keyboard.press('Tab');
  const tabbed = await A.evaluate(() => document.activeElement?.id);
  await A.keyboard.type('xyz');
  const tval = await A.inputValue('#fd-type');
  await check(
    'D3',
    'Type is read-only (not disabled) and looks different from the name input: a shaded background (the disabled shade), default cursor, same text colour, full opacity',
    A,
    async () => ({
      pass: ty.ro && !ty.dis && ty.bgT !== ty.bgN && ty.colT === ty.colN && ty.cur === 'default' && ty.curN !== 'default' && ty.op === '1',
      ev: ty,
    }),
  );
  await check('D3b', 'hovering Type does not change its border; hovering the name input does', A, async () => ({
    pass: bdHover === ty.bdT && bdNameHover !== ty.bdN,
    ev: { type: [ty.bdT, bdHover], name: [ty.bdN, bdNameHover] },
  }));
  await check('D3c', 'Tab from the name reaches Type; typing there changes nothing', A, async () => ({
    pass: tabbed === 'fd-type' && tval === 'Dropdown',
    ev: { tabbed, tval },
  }));
  await shot(A, 'D3-type-readonly-light', { clip: { x: 340, y: 60, width: 600, height: 420 } });
  await H.setTheme(A, 'dark');
  await sleep(500);
  await A.focus('#fd-name');
  const dk = await A.evaluate(() => ({
    bgT: getComputedStyle(document.getElementById('fd-type')).backgroundColor,
    bgN: getComputedStyle(document.getElementById('fd-name')).backgroundColor,
  }));
  await check('D3d', 'dark theme: Type is shaded differently from the name input too', A, async () => ({ pass: dk.bgT !== dk.bgN, ev: dk }));
  await shot(A, 'D3-type-readonly-dark', { clip: { x: 340, y: 60, width: 600, height: 420 } });
  await H.setTheme(A, 'light');
  await sleep(400);
  await closeAll();

  // ---- 3. remove-options confirm
  await openPhase();
  await rm('Alpha');
  await H.saveField(A);
  let c = await H.confirmInfo(A);
  await check(
    'D4',
    'remove 1 option in use (by 2 projects): the title names it; "2 projects use it. Their values stop showing."; button "Remove option"',
    A,
    async () => ({
      pass:
        c.title === 'Remove the option “Alpha” from Phase?' &&
        c.body === "2 projects use it. Their values stop showing. Private projects you can't see aren't counted." &&
        c.ok === 'Remove option',
      ev: c,
    }),
  );
  await closeAll();
  await openPhase();
  await rm('Alpha');
  await rm('Delta');
  await rm('Epsilon');
  await H.saveField(A);
  c = await H.confirmInfo(A);
  await check(
    'D5',
    'remove 3 options, 1 of them in use (by 2 projects): "Remove 3 options from Phase?"; "2 projects use them. Their values stop showing."; button "Remove options"',
    A,
    async () => ({
      pass:
        c.title === 'Remove 3 options from Phase?' &&
        c.body === "2 projects use them. Their values stop showing. Private projects you can't see aren't counted." &&
        c.ok === 'Remove options',
      ev: c,
    }),
  );
  await shot(A, 'D5-confirm-3-options', { clip: { x: 340, y: 120, width: 600, height: 360 } });
  await closeAll();
  await openPhase();
  await rm('Beta');
  await rm('Delta');
  await rm('Epsilon');
  await H.saveField(A);
  c = await H.confirmInfo(A);
  await check(
    'D5b',
    'remove 3 options, 1 in use by 1 project: "Remove 3 options from Phase?"; "1 project uses one of them. Its value stops showing."',
    A,
    async () => ({
      pass:
        c.title === 'Remove 3 options from Phase?' &&
        c.body === "1 project uses one of them. Its value stops showing. Private projects you can't see aren't counted." &&
        c.ok === 'Remove options',
      ev: c,
    }),
  );
  await closeAll();
  await openPhase();
  await rm('Delta');
  await rm('Epsilon');
  await H.saveField(A);
  const nm = await H.modals(A);
  const srv = (await H.fieldsOnServer()).find(x => x.id === 'phase').options.map(o => o.name);
  await check('D6', 'remove 2 options nobody uses: no question, the dialog closes and it is saved', A, async () => ({
    pass: nm === 0 && srv.join() === 'Alpha,Beta,Gamma',
    ev: { nm, srv },
  }));

  // ---- 3. delete confirm
  const withClient = (await L.api('GET', '/collections/projects/records?perPage=200')).body.items.filter(r => r.doc.f_client).length;
  await A.click('[data-a="delField"][aria-label="Delete Client"]');
  await sleep(400);
  c = await H.confirmInfo(A);
  await check(
    'D7',
    'Delete field confirm: "Their values stay stored on the projects, but they won\'t show again, even if you add a field with the same name."',
    A,
    async () => ({
      pass:
        c.body ===
          `${withClient} ${withClient === 1 ? 'project has' : 'projects have'} a value for it. ${withClient === 1 ? "Its value stays stored on the project, but it won't show again, even if you add a field with the same name." : "Their values stay stored on the projects, but they won't show again, even if you add a field with the same name."} Private projects you can't see aren't counted.` &&
        c.ok === 'Delete field',
      ev: { c, withClient },
    }),
  );
  await H.cancelTop(A);

  // ---- 4. overview rows
  await H.goProject(A, H.P(1));
  await sleep(500);
  const ov = await A.evaluate(() => {
    const rect = el => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const rs = [...r.getClientRects()].filter(x => x.width > 0.5 && x.height > 0.5);
      return rs[0];
    };
    const cy = r => r.top + r.height / 2;
    return [...document.querySelectorAll('dt.kv-f')].map(dt => {
      const dd = dt.nextElementSibling;
      const name = dt.querySelector('span'),
        icon = dt.querySelector('svg, .i');
      const pill = dd.querySelector('.pillbtn');
      const txtEl = pill.querySelector('[aria-hidden]') || pill;
      const nr = rect(name),
        vr = rect(txtEl),
        ir = icon.getBoundingClientRect(),
        pr = pill.getBoundingClientRect();
      return {
        name: name.textContent.slice(0, 20),
        lines: Math.round(dd.getBoundingClientRect().height),
        empty: pill.classList.contains('empty'),
        dName: Math.round((cy(nr) - cy(vr)) * 10) / 10,
        dIcon: Math.round((cy(ir) - cy(nr)) * 10) / 10,
        pillLeft: Math.round(pr.left * 10) / 10,
        textLeft: Math.round(vr.left * 10) / 10,
        title: dd.querySelectorAll('[title]').length,
        dtTop: Math.round(dt.getBoundingClientRect().top),
        ddTop: Math.round(dd.getBoundingClientRect().top),
      };
    });
  });
  const wrapped = ov.filter(r => r.lines > 40);
  await check(
    'D8',
    "overview: the name, its icon and the value's first line sit on one line, in wrapped rows (long value, long name) and in one-line rows",
    A,
    async () => ({
      pass: ov.length === 6 && wrapped.length >= 2 && ov.every(r => Math.abs(r.dName) <= 2 && Math.abs(r.dIcon) <= 2.5 && r.dtTop === r.ddTop),
      ev: ov,
    }),
  );
  const tl = new Set(ov.map(r => r.textLeft)),
    pl = new Set(ov.map(r => r.pillLeft));
  await check(
    'D9',
    'overview: the "—" of an empty value starts where the text of a filled value does (same pill, same padding), above and below',
    A,
    async () => ({ pass: ov.some(r => r.empty) && tl.size === 1 && pl.size === 1, ev: { textLeft: [...tl], pillLeft: [...pl] } }),
  );
  await check('D10', 'overview: a field\'s value has no title attribute (it wraps in full); the empty one is still announced "No value"', A, async () => {
    const t = await A.evaluate(() => ({
      titles: document.querySelectorAll('dd.kv-f [title]').length,
      sr: [...document.querySelectorAll('dd.kv-f .pillbtn.empty .sr')].map(e => e.textContent),
    }));
    return { pass: t.titles === 0 && t.sr.join() === 'No value', ev: t };
  });
  await shot(A, 'D8-overview-rows');
  const box = await A.locator('dl').first().boundingBox();
  await shot(A, 'D8-overview-rows-crop', {
    clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(box.width + 20, 700), height: Math.min(box.height + 20, 560) },
  });
  await H.setTheme(A, 'dark');
  await sleep(500);
  await shot(A, 'D8-overview-rows-dark-crop', {
    clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(box.width + 20, 700), height: Math.min(box.height + 20, 560) },
  });
  await H.setTheme(A, 'light');
  await sleep(400);

  // ---- 6. tiny numbers
  const bud = async pid => {
    await H.goProject(A, pid);
    return (await H.detailRows(A)).find(r => r[0] === 'Budget')?.[1];
  };
  const got = [await bud(H.P(1)), await bud(H.P(2)), await bud(H.P(3)), await bud(H.P(4))];
  await check('D11', 'overview: 1e-21 shows as 1e-21, -1e-21 as -1e-21, 0.0004 whole, 0 as 0', A, async () => ({
    pass: got.join('|') === '1e-21|-1e-21|0.0004|0',
    ev: got,
  }));
  await H.goProjects(A, 'table');
  await sleep(500);
  const head = await H.tableHead(A),
    bi = head.findIndex(h => /Budget/.test(h));
  const cells = [];
  for (const n of [1, 2, 3, 4]) cells.push((await H.tableRow(A, H.P(n)))[bi]);
  await check('D12', 'Projects table: the same four numbers show the same way', A, async () => ({
    pass: bi >= 0 && cells.join('|') === '1e-21|-1e-21|0.0004|0',
    ev: { bi, cells },
  }));
  // the Edit form: a stored 1e-21 is in the number box as the browser writes it
  await H.openEdit(A, H.P(1));
  const ev = await A.evaluate(() => {
    const e = document.getElementById('p-f_budget1');
    return e ? { v: e.value, bad: e.validity.badInput } : null;
  });
  await check('D13', 'Edit form: the number box holds 1e-21 (not 0), valid', A, async () => ({ pass: ev && Number(ev.v) === 1e-21 && !ev.bad, ev }));
  await H.cancelTop(A);
  await check('D14', 'zero console errors; nothing pending', A, async () => {
    const p = await L.settle(A);
    return { pass: A.errs.length === 0 && p.length === 0, ev: { errs: A.errs.slice(0, 4), p } };
  });
} catch (e) {
  console.log('SUITE ERROR', e);
}
console.log(`RESULT ${L.results.pass} pass ${L.results.fail} fail`);
await b.close();
