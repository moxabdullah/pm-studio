import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
const { sleep, norm } = H;
await L.suLogin();
const b = await L.launch();
const page = await H.mkPage(b, 'hello@example.com');
const check = L.check;
const pend = () => L.settle(page);
const P1 = H.P(1),
  P2 = H.P(2),
  P3 = H.P(3),
  P4 = H.P(4),
  P5 = H.P(5);
const toasts = () => H.toastTexts(page);
try {
  // ---------- A: built-ins
  await H.goSettings(page);
  await check('A1', 'built-ins in Settings: "(built-in)", three Text rows with Projects table, no record on the server', page, async () => {
    const meta = await H.fieldRowMeta(page);
    const h1 = norm(await page.locator('.set-in h1').innerText());
    const recs = await L.lists();
    const rowsOk =
      meta.length === 3 &&
      /^Client Text · Projects table/.test(meta[0]) &&
      /^End user Text · Projects table/.test(meta[1]) &&
      /^PO \/ contract no\. Text · Projects table/.test(meta[2]);
    return { pass: rowsOk && /\(built-in\)/.test(h1) && recs.length === 0, ev: JSON.stringify({ meta, h1, recs: recs.length }) };
  });
  await page.screenshot({ path: L.OUT + '/A-settings-builtin.png' });
  await page.evaluate(() => window.__pmspace.go('projects'));
  await sleep(400);
  await page.click('[data-a="newProject"]');
  await sleep(500);
  await check('A2', 'new-project form: a "Project fields" group with Client, End user, PO / contract no. (text, maxlength 200)', page, async () => {
    const labels = await page.$$eval('#p-fields-h ~ .row label.label, [role="group"][aria-labelledby="p-fields-h"] label.label', els =>
      els.map(e => e.textContent.trim()),
    );
    const attrs = await page.$$eval('[id^="p-f_"]', els => els.map(e => [e.id, e.type, e.maxLength]));
    return {
      pass: labels.join('|') === 'Client|End user|PO / contract no.' && attrs.length === 3 && attrs.every(a => a[1] === 'text' && a[2] === 200),
      ev: JSON.stringify({ labels, attrs }),
    };
  });
  await page.screenshot({ path: L.OUT + '/A-newproject-builtin.png' });
  await H.cancelTop(page);
  await H.goProject(page, P1);
  await check('A3', 'overview Details: the built-ins after Due, values for p1, faint dash for p4', page, async () => {
    const rows = await H.detailRows(page);
    const names = rows.map(r => r[0]);
    const iDue = names.findIndex(n => /Due/.test(n)),
      iMem = names.findIndex(n => /Members/.test(n));
    const f = rows.slice(iDue + 1, iMem);
    await H.goProject(page, P4);
    const rows4 = await H.detailRows(page);
    const f4 = rows4.slice(iDue + 1, iDue + 4);
    return {
      pass:
        f.length === 3 &&
        f[0][1] === 'Northwind Traders' &&
        f[1][1] === 'Northwind customers' &&
        f[2][1] === 'PO-2026-0417' &&
        f4.every(r => r[1] === 'No value —') &&
        /Client/.test(f[0][0]),
      ev: JSON.stringify({ f, f4 }),
    };
  });
  await H.goProject(page, P1);
  await page.screenshot({ path: L.OUT + '/A-overview-builtin.png' });
  await H.goProjects(page, 'table');
  await check('A4', 'Projects table: three field columns straight after Project, values, min-width 1220px, page does not scroll sideways', page, async () => {
    const head = await H.tableHead(page);
    const row = await H.tableRow(page, P1);
    const mw = await page.$eval('table.perm-t', t => t.style.minWidth);
    const sc = await H.noHScroll(page);
    return {
      pass:
        head.slice(0, 4).join('|') === 'Project|Client|End user|PO / contract no.' &&
        row.slice(1, 4).join('|') === 'Northwind Traders|Northwind customers|PO-2026-0417' &&
        mw === '1220px' &&
        sc.sw <= sc.cw,
      ev: JSON.stringify({ head: head.slice(0, 5), row: row.slice(0, 5), mw, sc }),
    };
  });
  await page.screenshot({ path: L.OUT + '/A-table-builtin.png' });

  // ---------- B: add one of each type
  await H.goSettings(page);
  await H.newField(page, { name: 'Site', type: 'Text', table: false });
  await H.saveField(page);
  await check('B1', 'first save copies the built-ins with their ids, adds Site at the end; "(built-in)" gone; record has only fields', page, async () => {
    const recs = await L.lists();
    const fs = recs[0]?.doc?.fields;
    const h1 = norm(await page.locator('.set-in h1').innerText());
    const shapeOk = fs?.every(f => JSON.stringify(Object.keys(f).sort()) === '["id","inTable","name","type"]');
    return {
      pass:
        recs.length === 1 &&
        fs.map(f => f.name).join('|') === 'Client|End user|PO / contract no.|Site' &&
        fs
          .slice(0, 3)
          .map(f => f.id)
          .join() === 'client,enduser,po' &&
        fs[3].inTable === false &&
        fs[3].type === 'text' &&
        shapeOk &&
        !/built-in/.test(h1) &&
        !('labels' in recs[0].doc) &&
        (await pend()).length === 0,
      ev: JSON.stringify({ fs, keys: Object.keys(recs[0]?.doc || {}), h1 }),
    };
  });
  await H.newField(page, { name: 'Budget', type: 'Number', table: true });
  await H.saveField(page);
  await H.newField(page, { name: 'Go-live', type: 'Date', table: true });
  await H.saveField(page);
  await H.newField(page, { name: 'Phase', type: 'Dropdown', table: true, options: ['Design', 'Build', 'Test'] });
  await H.saveField(page);
  const FS = await H.fieldsOnServer();
  const budgetId = FS.find(f => f.name === 'Budget')?.id,
    golive = FS.find(f => f.name === 'Go-live')?.id,
    phase = FS.find(f => f.name === 'Phase'),
    siteId = FS.find(f => f.name === 'Site')?.id;
  await check('B2', 'number, date and dropdown fields saved: types, inTable, options only on the dropdown (ids 15 chars)', page, async () => {
    const bf = FS.find(f => f.name === 'Budget'),
      gf = FS.find(f => f.name === 'Go-live');
    const meta = await H.fieldRowMeta(page);
    return {
      pass:
        FS.length === 7 &&
        bf.type === 'number' &&
        bf.inTable === true &&
        !('options' in bf) &&
        gf.type === 'date' &&
        phase.type === 'select' &&
        phase.options.map(o => o.name).join() === 'Design,Build,Test' &&
        phase.options.every(o => /^[a-z0-9]{15}$/.test(o.id)) &&
        /^[a-z0-9]{15}$/.test(budgetId) &&
        /Dropdown/.test(meta[6]) &&
        /Design, Build, Test/.test(meta[6]) &&
        (await pend()).length === 0,
      ev: JSON.stringify({ n: FS.length, meta: meta.slice(3) }),
    };
  });
  await page.screenshot({ path: L.OUT + '/B-settings-all.png' });

  // ---------- C: edit a field
  await page.click('[data-a="editField"][aria-label="Edit Site"]');
  await sleep(400);
  await check('C1', 'edit dialog: type shown but read-only (not disabled), with the note; name and checkbox prefilled', page, async () => {
    const dis = await page.$eval('#fd-type', e => [e.readOnly && !e.disabled, e.value]);
    const note = norm(await page.locator('#fd-type-note').innerText());
    return {
      pass:
        dis[0] &&
        dis[1] === 'Text' &&
        note === 'A field’s type can’t be changed after it’s created.' &&
        (await page.inputValue('#fd-name')) === 'Site' &&
        !(await page.isChecked('#fd-table')),
      ev: JSON.stringify({ dis, note }),
    };
  });
  await page.screenshot({ path: L.OUT + '/C-edit-dialog.png' });
  await page.fill('#fd-name', 'Location');
  await page.check('#fd-table');
  await H.saveField(page);
  await check('C2', 'rename keeps the id, inTable now true, toast "Saved the field", list order unchanged', page, async () => {
    const fs = await H.fieldsOnServer();
    const t = (await toasts()).join('|');
    return {
      pass:
        fs[3].id === siteId &&
        fs[3].name === 'Location' &&
        fs[3].inTable === true &&
        fs.length === 7 &&
        /Saved the field “Location”/.test(t) &&
        (await pend()).length === 0,
      ev: JSON.stringify({ f: fs[3], t }),
    };
  });

  // ---------- D: fill values through the edit form
  await H.openEdit(page, P1);
  await check('D1', 'edit form of p1: built-in values prefilled; Budget/Go-live/Phase/Location inputs typed number/date/select/text', page, async () => {
    const vals = await page.$$eval('[id^="p-f_"]', els => els.map(e => [e.id, e.tagName === 'SELECT' ? 'select' : e.type, e.value]));
    const m = Object.fromEntries(vals.map(v => [v[0], v]));
    return {
      pass:
        m['p-f_client'][2] === 'Northwind Traders' &&
        m['p-f_' + budgetId][1] === 'number' &&
        m['p-f_' + golive][1] === 'date' &&
        m['p-f_' + phase.id][1] === 'select' &&
        m['p-f_' + siteId][1] === 'text' &&
        vals.length === 7,
      ev: JSON.stringify(vals.map(v => v.join(':'))),
    };
  });
  await page.screenshot({ path: L.OUT + '/D-edit-form.png' });
  await page.fill('#p-f_' + siteId, '  Berlin  ');
  await page.fill('#p-f_' + budgetId, '12500.5');
  await page.fill('#p-f_' + golive, '2026-12-01');
  await H.pick(page, 'p-f_' + phase.id, 'Build');
  await H.saveProject(page);
  const rec1 = await H.projRec(P1);
  await check('D2', 'saved values: text trimmed, number is a JSON number, date string, dropdown is the option id; untouched keys kept', page, async () => {
    const d = rec1.doc;
    const bid = phase.options.find(o => o.name === 'Build').id;
    return {
      pass:
        d['f_' + siteId] === 'Berlin' &&
        d['f_' + budgetId] === 12500.5 &&
        d['f_' + golive] === '2026-12-01' &&
        d['f_' + phase.id] === bid &&
        d.f_client === 'Northwind Traders' &&
        d.f_po === 'PO-2026-0417' &&
        (await pend()).length === 0,
      ev: JSON.stringify(H.fkeys(rec1).map(k => [k, d[k]])),
    };
  });
  await H.goProject(page, P1);
  await check('D3', 'overview shows the new values (number localised, date as Due, dropdown name) in field order', page, async () => {
    const rows = await H.detailRows(page);
    const names = rows.map(r => r[0].replace(/^\s*/, ''));
    const get = n => rows.find(r => r[0].endsWith(n))?.[1];
    const iLoc = names.findIndex(n => n.endsWith('Location')),
      iPhase = names.findIndex(n => n.endsWith('Phase')),
      iMem = names.findIndex(n => n.endsWith('Members'));
    return {
      pass:
        get('Location') === 'Berlin' &&
        get('Budget') === '12,500.5' &&
        /Dec 1, 2026|1 Dec 2026|Dec 1/.test(get('Go-live')) &&
        get('Phase') === 'Build' &&
        iLoc < iPhase &&
        iPhase < iMem,
      ev: JSON.stringify(rows.slice(4)),
    };
  });
  await page.screenshot({ path: L.OUT + '/D-overview.png' });
  await H.goProjects(page, 'table');
  await check('D4', 'table shows the in-table fields in list order straight after Project, min-width 860 + 120 x 7', page, async () => {
    const head = await H.tableHead(page);
    const row = await H.tableRow(page, P1);
    const mw = await page.$eval('table.perm-t', t => t.style.minWidth);
    const sc = await H.noHScroll(page);
    return {
      pass:
        head.slice(0, 8).join('|') === 'Project|Client|End user|PO / contract no.|Location|Budget|Go-live|Phase' &&
        row.slice(1, 8).join('|').startsWith('Northwind Traders|Northwind customers|PO-2026-0417|Berlin|12,500.5|') &&
        row[7] === 'Build' &&
        mw === '1700px' &&
        sc.sw <= sc.cw,
      ev: JSON.stringify({ head: head.slice(0, 8), row: row.slice(0, 8), mw, sc }),
    };
  });
  await page.screenshot({ path: L.OUT + '/D-table.png' });

  // ---------- E: rename an option, values keep showing
  await H.goSettings(page);
  await page.click('[data-a="editField"][aria-label="Edit Phase"]');
  await sleep(400);
  await page.fill('#fd-opt-1', 'Construction');
  await H.saveField(page);
  await H.goProject(page, P1);
  await check('E1', 'renaming a dropdown option keeps its id; p1 shows the new name; no confirm', page, async () => {
    const f = (await H.fieldsOnServer()).find(x => x.name === 'Phase');
    const rows = await H.detailRows(page);
    return {
      pass:
        f.options[1].id === phase.options[1].id &&
        f.options[1].name === 'Construction' &&
        rows.find(r => r[0].endsWith('Phase'))?.[1] === 'Construction' &&
        (await H.modals(page)) === 0,
      ev: JSON.stringify(f.options),
    };
  });

  // ---------- F: move
  await H.goSettings(page);
  const orderOf = async () => (await H.fieldsOnServer()).map(f => f.name).join('|');
  const before = await orderOf();
  await sleep(4500); // (the toasts of the saves above are gone)
  await page.click('[data-a="moveField"][aria-label="Move Phase up"]');
  await sleep(600);
  const afterUp = await orderOf();
  await check(
    'F1',
    'Move up swaps with the neighbour; focus stays on the moved row; first row has Move up disabled, last Move down disabled',
    page,
    async () => {
      const dis = await page.$eval('[data-a="moveField"][data-id="client"][data-v="up"]', e => e.disabled);
      const last = (await H.fieldsOnServer()).slice(-1)[0].name;
      const lastDis = await page.$eval(`[data-a="moveField"][aria-label="Move ${last} down"]`, e => e.disabled);
      const foc = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      return {
        pass:
          before === 'Client|End user|PO / contract no.|Location|Budget|Go-live|Phase' &&
          afterUp === 'Client|End user|PO / contract no.|Location|Budget|Phase|Go-live' &&
          dis &&
          lastDis &&
          /Move Phase/.test(foc),
        ev: JSON.stringify({ afterUp, dis, lastDis, foc }),
      };
    },
  );
  await page.click('[data-a="moveField"][aria-label="Move Phase down"]');
  await sleep(600);
  await check('F2', 'Move down restores the order; nothing pending; no "saved" toast', page, async () => ({
    pass: (await orderOf()) === before && (await pend()).length === 0 && !(await toasts()).some(t => /Saved/.test(t)),
    ev: await orderOf(),
  }));

  // ---------- G: remove options in use (confirm)
  const tier = async () => (await H.fieldsOnServer()).find(f => f.name === 'Tier');
  await H.newField(page, { name: 'Tier', type: 'Dropdown', table: false, options: ['Gold', 'Silver', 'Bronze', 'Tin'] });
  await H.saveField(page);
  const T = await tier();
  await H.setProjectValues(P2, { ['f_' + T.id]: T.options[0].id });
  await H.setProjectValues(P3, { ['f_' + T.id]: T.options[1].id });
  await H.setProjectValues(P4, { ['f_' + T.id]: T.options[2].id });
  await H.setProjectValues(P5, { ['f_' + T.id]: T.options[3].id });
  await H.setProjectValues(P1, { ['f_' + phase.id]: phase.options[1].id }); // p1 is on Construction (renamed)
  await L.api('PATCH', '/collections/projects/records/' + P3, { archived: true });
  await sleep(2500);
  await check('G0', 'the app has the values and the archived flag from the server (realtime)', page, async () => {
    const r = await page.evaluate(
      ([p3, k]) => [window.__pmspace.D().projects.find(p => p.id === p3)?.archived, window.__pmspace.D().projects.find(p => p.id === p3)?.[k]],
      [P3, 'f_' + T.id],
    );
    return { pass: r[0] === true && r[1] === T.options[1].id, ev: JSON.stringify(r) };
  });
  await page.click('[data-a="editField"][aria-label="Edit Phase"]');
  await sleep(400);
  await page.click('[data-a="fdOptRemove"][aria-label="Remove Construction"]');
  await sleep(300);
  await H.saveField(page);
  await check('G1', 'removing an option in use asks: names it, counts the project, private note; the dialog is behind it', page, async () => {
    const c = await H.confirmInfo(page);
    const n = await H.modals(page);
    return {
      pass:
        c.title === 'Remove the option “Construction” from Phase?' &&
        c.body === "1 project uses it. Its value stops showing. Private projects you can't see aren't counted." &&
        c.ok === 'Remove option' &&
        n === 2,
      ev: JSON.stringify({ ...c, n }),
    };
  });
  await page.screenshot({ path: L.OUT + '/G-confirm-option.png' });
  await H.cancelTop(page);
  await check('G2', 'Cancel returns to the dialog with the edit intact (Construction still removed), nothing saved', page, async () => {
    const names = await page.$$eval('[id^="fd-opt-"]', els => els.map(e => e.value));
    const f = (await H.fieldsOnServer()).find(x => x.name === 'Phase');
    return {
      pass: names.join() === 'Design,Test' && f.options.length === 3 && (await H.modals(page)) === 1,
      ev: JSON.stringify({ names, server: f.options.length }),
    };
  });
  await H.saveField(page);
  await H.okTop(page);
  await check('G3', 'confirming saves; the project keeps its dangling value; its overview shows a dash for Phase', page, async () => {
    const f = (await H.fieldsOnServer()).find(x => x.name === 'Phase');
    const r = await H.projRec(P1);
    await H.goProject(page, P1);
    const rows = await H.detailRows(page);
    return {
      pass:
        f.options.map(o => o.name).join() === 'Design,Test' &&
        r.doc['f_' + phase.id] === phase.options[1].id &&
        rows.find(x => x[0].endsWith('Phase'))?.[1] === 'No value —' &&
        (await H.modals(page)) === 0 &&
        (await pend()).length === 0,
      ev: JSON.stringify({ opts: f.options.length, dangling: r.doc['f_' + phase.id] }),
    };
  });
  await H.goSettings(page);
  await page.click('[data-a="editField"][aria-label="Edit Tier"]');
  await sleep(400);
  for (let i = 0; i < 4; i++) {
    await page.click('[data-a="fdOptRemove"][data-i="0"]');
    await sleep(150);
  }
  await page.click('[data-a="fdOptAdd"]');
  await sleep(200);
  await page.fill('#fd-opt-0', 'Platinum');
  await H.saveField(page);
  await check('G4', 'removing four options used by four projects (one archived): counts, "Remove 4 options from Tier?"', page, async () => {
    const c = await H.confirmInfo(page);
    return {
      pass:
        c.title === 'Remove 4 options from Tier?' &&
        c.body === "4 projects (1 archived) use them. Their values stop showing. Private projects you can't see aren't counted." &&
        c.ok === 'Remove options',
      ev: JSON.stringify(c),
    };
  });
  await H.cancelTop(page);
  await H.cancelTop(page);
  await check('G5', 'cancelling both leaves the server list untouched', page, async () => ({
    pass: (await tier()).options.length === 4 && (await H.modals(page)) === 0,
    ev: '',
  }));

  // ---------- H: delete with the count confirm, then duplicate keeps every value
  await H.goSettings(page);
  await page.click('[data-a="delField"][aria-label="Delete Client"]');
  await sleep(400);
  await check('H1', 'Delete asks: 3 projects (1 archived) have a value (Tier case is separate); private note; danger button', page, async () => {
    const c = await H.confirmInfo(page);
    return {
      pass:
        c.title === 'Delete the field “Client”?' &&
        c.body ===
          "3 projects (1 archived) have a value for it. Their values stay stored on the projects, but they won't show again, even if you add a field with the same name. Private projects you can't see aren't counted." &&
        c.ok === 'Delete field',
      ev: JSON.stringify(c),
    };
  });
  await page.screenshot({ path: L.OUT + '/H-confirm-delete.png' });
  await H.cancelTop(page);
  await check('H2', 'Cancel deletes nothing', page, async () => ({ pass: (await H.fieldsOnServer()).some(f => f.id === 'client'), ev: '' }));
  await page.click('[data-a="delField"][aria-label="Delete Client"]');
  await sleep(300);
  await H.okTop(page);
  await check('H3', 'confirming deletes the definition only; p1 keeps f_client; nothing pending; toast', page, async () => {
    const fs = await H.fieldsOnServer();
    const r = await H.projRec(P1);
    const t = (await toasts()).join('|');
    return {
      pass: !fs.some(f => f.id === 'client') && r.doc.f_client === 'Northwind Traders' && /Deleted the field “Client”/.test(t) && (await pend()).length === 0,
      ev: JSON.stringify({ n: fs.length, t }),
    };
  });
  await page.click('[data-a="delField"][aria-label="Delete Tier"]');
  await sleep(300);
  await check('H4', 'delete a field with a value on 3 projects includes the archived one in the count only once', page, async () => {
    const c = await H.confirmInfo(page);
    return {
      pass:
        c.body ===
        "4 projects (1 archived) have a value for it. Their values stay stored on the projects, but they won't show again, even if you add a field with the same name. Private projects you can't see aren't counted.",
      ev: c.body,
    };
  });
  await H.cancelTop(page);
  await H.goProjects(page, 'table');
  await page.click(`tr[data-id="${P1}"] [data-a="ctxBtn"]`);
  await sleep(300);
  await page.click('[data-a="dupProject"]');
  await sleep(1800);
  await check('H5', 'Duplicate keeps every f_ value of p1, including the deleted Client field', page, async () => {
    const all = (await L.api('GET', '/collections/projects/records?perPage=50')).body.items;
    const copy = all.find(r => r.doc.name === 'Website Redesign copy');
    const src = await H.projRec(P1);
    const kc = H.fkeys(copy),
      ks = H.fkeys(src);
    return {
      pass: !!copy && kc.join() === ks.join() && kc.every(k => copy.doc[k] === src.doc[k]) && kc.includes('f_client'),
      ev: JSON.stringify({ kc: kc.length, ks: ks.length }),
    };
  });
  await page.screenshot({ path: L.OUT + '/H-table-after-delete.png' });
  await check('H6', 'the table no longer has a Client column (deleted) but keeps the others', page, async () => {
    const head = await H.tableHead(page);
    return { pass: !head.includes('Client') && head.includes('End user') && head.includes('Location'), ev: head.join('|') };
  });
  await H.goProject(page, P1);
  await check('H7', 'overview of p1 no longer shows Client', page, async () => ({ pass: !(await H.detailRows(page)).some(r => /Client/.test(r[0])), ev: '' }));

  // ---------- I: values through the New project form; clear through Edit
  await page.evaluate(() => window.__pmspace.go('projects'));
  await sleep(400);
  await page.click('[data-a="newProject"]');
  await sleep(500);
  await page.fill('#p-name', 'Fields demo');
  await page.fill('#p-f_' + siteId, 'x'.repeat(250));
  await page.fill('#p-f_' + budgetId, '1e400');
  await page.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(500);
  await check('I1', 'number overflow (1e400) is refused inline: "Enter a number", focus on the input, dialog stays', page, async () => {
    const err = norm(
      await page
        .locator('#p-f_' + budgetId + '-err')
        .innerText()
        .catch(() => ''),
    );
    const foc = await page.evaluate(() => document.activeElement?.id);
    return { pass: err === 'Enter a number' && foc === 'p-f_' + budgetId && (await H.modals(page)) === 1, ev: JSON.stringify({ err, foc }) };
  });
  await page.fill('#p-f_' + budgetId, '-0');
  await page.fill('#p-f_' + golive, '2027-01-31');
  await H.pick(page, 'p-f_' + phase.id, 'Test');
  await page.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(1800);
  const demo = (await L.api('GET', '/collections/projects/records?perPage=50')).body.items.find(r => r.doc.name === 'Fields demo');
  await check('I2', 'create: text cut to 200, -0 stored as 0, date, dropdown id; empty fields have no key', page, async () => {
    const d = demo?.doc || {};
    return {
      pass:
        d['f_' + siteId]?.length === 200 &&
        d['f_' + budgetId] === 0 &&
        Object.is(d['f_' + budgetId], 0) &&
        d['f_' + golive] === '2027-01-31' &&
        d['f_' + phase.id] === phase.options[2].id &&
        !('f_po' in d) &&
        !('f_enduser' in d) &&
        (await pend()).length === 0,
      ev: JSON.stringify(H.fkeys(demo || { doc: {} })),
    };
  });
  const DEMO = demo?.id;
  await H.openEdit(page, DEMO);
  await page.fill('#p-f_' + siteId, '');
  await page.fill('#p-f_' + budgetId, '');
  await page.fill('#p-f_' + golive, '');
  await H.pick(page, 'p-f_' + phase.id, '—');
  await H.saveProject(page);
  const demo2 = await H.projRec(DEMO);
  await check('I3', 'clearing every value removes its key from the server record; nothing else changed', page, async () => ({
    pass: H.fkeys(demo2).length === 0 && demo2.doc.name === 'Fields demo' && (await pend()).length === 0,
    ev: JSON.stringify(Object.keys(demo2.doc).sort()),
  }));
  await H.goProject(page, DEMO);
  await check('I4', 'overview shows dashes for the cleared fields', page, async () => {
    const rows = await H.detailRows(page);
    const mine = rows.filter(r => /Location|Budget|Go-live|Phase/.test(r[0]));
    return { pass: mine.length === 4 && mine.every(r => r[1] === 'No value —'), ev: JSON.stringify(mine) };
  });

  // ---------- J: validation
  await H.goSettings(page);
  const open = async () => {
    await page.click('[data-a="newField"]');
    await sleep(350);
  };
  const errNow = async () =>
    norm(
      await page
        .locator('#fd-name-err, #fd-list-err')
        .first()
        .innerText()
        .catch(() => ''),
    );
  await open();
  await H.saveField(page);
  await check('J1', 'blank name: "Give the field a name", name input focused', page, async () => ({
    pass: (await errNow()) === 'Give the field a name' && (await page.evaluate(() => document.activeElement?.id)) === 'fd-name',
    ev: await errNow(),
  }));
  await page.fill('#fd-name', '  location ');
  await H.saveField(page);
  await check('J2', 'a name that matches another field ignoring case and spaces is refused', page, async () => ({
    pass: (await errNow()) === 'There is already a field called “location”',
    ev: await errNow(),
  }));
  await page.evaluate(() => {
    const e = document.getElementById('fd-name');
    e.value = 'y'.repeat(41);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await H.saveField(page);
  await check('J3', 'a 41-character name is refused (the input also has maxlength 40)', page, async () => ({
    pass: (await errNow()) === 'Field names can be up to 40 characters' && (await page.getAttribute('#fd-name', 'maxlength')) === '40',
    ev: await errNow(),
  }));
  await page.fill('#fd-name', 'Colour');
  await H.pick(page, 'fd-type', 'Dropdown');
  await H.saveField(page);
  await check('J4', 'dropdown without options: "A dropdown needs at least one option"; the error is in the viewport of the dialog body', page, async () => {
    const vis = await page.$eval('#fd-list-err', e => {
      const r = e.getBoundingClientRect(),
        b = e.closest('.modal-b').getBoundingClientRect();
      return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    });
    return { pass: (await errNow()) === 'A dropdown needs at least one option' && vis, ev: await errNow() };
  });
  await page.click('[data-a="fdOptAdd"]');
  await sleep(200);
  await H.saveField(page);
  await check('J5', 'blank option name refused on its row, focus on that row', page, async () => ({
    pass: (await errNow()) === 'Every option needs a name' && (await page.evaluate(() => document.activeElement?.id)) === 'fd-opt-0',
    ev: await errNow(),
  }));
  await page.fill('#fd-opt-0', 'Red');
  await page.click('[data-a="fdOptAdd"]');
  await sleep(200);
  await page.fill('#fd-opt-1', ' red ');
  await H.saveField(page);
  await check('J6', 'duplicate options ignoring case are refused on the first touched clashing row', page, async () => ({
    pass: (await errNow()) === 'There is more than one option called “Red”' && (await page.evaluate(() => document.activeElement?.id)) === 'fd-opt-0',
    ev: await errNow(),
  }));
  await page.screenshot({ path: L.OUT + '/J-validation.png' });
  await H.cancelTop(page);
  // an existing field that already has clashing options stays editable
  const cur = (await L.lists())[0];
  await L.api('PATCH', '/collections/workspace_lists/records/' + cur.id, {
    doc: {
      ...cur.doc,
      fields: [
        ...cur.doc.fields,
        {
          id: 'dupes',
          name: 'Dupes',
          type: 'select',
          inTable: false,
          options: [
            { id: 'o1', name: 'X' },
            { id: 'o2', name: 'x' },
          ],
        },
      ],
    },
  });
  await sleep(2500);
  await page.click('[data-a="editField"][aria-label="Edit Dupes"]');
  await sleep(400);
  await page.fill('#fd-name', 'Dupes renamed');
  await H.saveField(page);
  await check('J7', 'a saved field whose options already clash can still be renamed (untouched rows are not flagged)', page, async () => {
    const f = (await H.fieldsOnServer()).find(x => x.id === 'dupes');
    return { pass: f?.name === 'Dupes renamed' && f.options.length === 2 && (await H.modals(page)) === 0, ev: JSON.stringify(f) };
  });

  // ---------- K: caps
  await open();
  await H.pick(page, 'fd-type', 'Dropdown');
  for (let i = 0; i < 52; i++)
    await page
      .locator('[data-a="fdOptAdd"]')
      .click({ force: true, timeout: 2000 })
      .catch(() => {});
  await sleep(300);
  await check('K1', 'Add option stops at 50: aria-disabled with a note, extra clicks add nothing', page, async () => {
    const n = await page.locator('[id^="fd-opt-"]').count();
    const dis = await page.getAttribute('[data-a="fdOptAdd"]', 'aria-disabled');
    const note = norm(
      await page
        .locator('#fd-cap')
        .innerText()
        .catch(() => ''),
    );
    return { pass: n === 50 && dis === 'true' && note === 'A dropdown can have up to 50 options', ev: JSON.stringify({ n, dis, note }) };
  });
  await H.cancelTop(page);
  const cur2 = (await L.lists())[0];
  const base = cur2.doc.fields;
  const filler = n => Array.from({ length: n }, (_, i) => ({ id: 'fill' + i, name: 'Filler ' + i, type: 'text', inTable: false }));
  await L.api('PATCH', '/collections/workspace_lists/records/' + cur2.id, { doc: { ...cur2.doc, fields: filler(29) } });
  await sleep(2500);
  await open();
  await page.fill('#fd-name', 'Number 30');
  // the list fills up elsewhere while the dialog is open
  await L.api('PATCH', '/collections/workspace_lists/records/' + cur2.id, { doc: { ...cur2.doc, fields: filler(30) } });
  await sleep(2500);
  await H.saveField(page);
  await check('K2', 'a save into a list that filled up meanwhile is refused with a toast, not saved', page, async () => {
    const t = (await toasts()).join('|');
    const fs = await H.fieldsOnServer();
    return {
      pass: /A workspace can have up to 30 fields\. Nothing was saved\./.test(t) && fs.length === 30 && !fs.some(f => f.name === 'Number 30'),
      ev: JSON.stringify({ t, n: fs.length, modals: await H.modals(page) }),
    };
  });
  await H.cancelTop(page).catch(() => {});
  await sleep(300);
  await check('K3', 'at 30 fields Add field is aria-disabled with the note; clicking opens nothing', page, async () => {
    const dis = await page.getAttribute('[data-a="newField"]', 'aria-disabled');
    const note = norm(
      await page
        .locator('#fields-cap')
        .innerText()
        .catch(() => ''),
    );
    await page.locator('[data-a="newField"]').click({ force: true });
    await sleep(300);
    return { pass: dis === 'true' && note === 'A workspace can have up to 30 fields' && (await H.modals(page)) === 0, ev: JSON.stringify({ dis, note }) };
  });
  await page.screenshot({ path: L.OUT + '/K-cap.png' });
  await L.api('PATCH', '/collections/workspace_lists/records/' + cur2.id, { doc: { ...cur2.doc, fields: base } });
  await sleep(2000);
} catch (e) {
  console.log('SCRIPT ERROR', e);
}
console.log('ERRS', JSON.stringify(page.errs));
console.log('RESULT', L.results.pass, 'pass', L.results.fail, 'fail');
await b.close();
