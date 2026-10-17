// Round 2, suite C: the fields editor: focus after Delete and after Type (item 3), copy and confirms (6), live announcement (6), the name checked again at write time (8)
import * as L from '../lib/browser.mjs';
import * as H from './h.mjs';
import * as X from '../lib/fixtures.mjs';
const { sleep, norm } = H;
const check = L.check;
await L.suLogin();
const T = (id, name) => ({ id, name, type: 'text', inTable: false });
await X.putFields([T('fa1', 'Alpha'), T('fb2', 'Bravo'), T('fc3', 'Charlie'), T('fd4', 'Delta'), T('fe5', 'Echo')]);
const b = await L.launch();
const A = await H.mkPage(b, 'hello@example.com', 1280, 800, 'adminA');
const B = await H.mkPage(b, 'sarah@example.com', 1280, 800, 'adminB');
const errs = () => [...A.errs, ...B.errs];
const focus = page =>
  page.evaluate(() => {
    const e = document.activeElement;
    return e
      ? {
          tag: e.tagName.toLowerCase(),
          a: e.dataset?.a || null,
          id: e.dataset?.id || e.id || null,
          label: e.getAttribute('aria-label') || null,
          connected: e.isConnected,
        }
      : null;
  });
const isEdit = (f, id) => f && f.a === 'editField' && f.id === id && f.connected;
const names = page => H.fieldRowNames(page);
// Delete with the keyboard: focus the row's Delete button, Enter; in the question, focus OK and press Enter
async function delByKey(page, name) {
  await page.focus(`[data-a="delField"][aria-label="Delete ${name}"]`);
  await page.keyboard.press('Enter');
  await sleep(400);
  await page.focus('[data-a="confirmOk"]');
  await page.keyboard.press('Enter');
  await sleep(900);
}
try {
  await H.goSettings(A);
  await H.goSettings(B);
  await sleep(500);
  const n0 = await names(A);
  await check('C0', 'setup: five fields Alpha..Echo', A, async () => ({ pass: n0.join() === 'Alpha,Bravo,Charlie,Delta,Echo', ev: n0 }));

  // ---- 3. focus after Delete
  await delByKey(A, 'Charlie');
  let f = await focus(A);
  await check(
    'C1',
    'delete a middle field (Charlie) with the keyboard: focus lands on the Edit button of the row that took its place (Delta)',
    A,
    async () => ({ pass: isEdit(f, 'fd4'), ev: f }),
  );
  await delByKey(A, 'Echo');
  f = await focus(A);
  await check('C2', "delete the last field (Echo): focus lands on the previous row's Edit (Delta)", A, async () => ({ pass: isEdit(f, 'fd4'), ev: f }));
  await A.focus('[data-a="delField"][aria-label="Delete Alpha"]');
  await A.keyboard.press('Enter');
  await sleep(400);
  await A.locator('.modal [data-a="closeModal"]').last().click();
  await sleep(400);
  f = await focus(A);
  await check('C3', "delete cancelled: focus goes back to that row's Delete button", A, async () => ({
    pass: f?.a === 'delField' && f.label === 'Delete Alpha' && (await names(A)).join() === 'Alpha,Bravo,Delta',
    ev: f,
  }));
  await delByKey(A, 'Alpha');
  f = await focus(A);
  await check('C4', 'delete the first field (Alpha): focus lands on the Edit of the row that took its place (Bravo)', A, async () => ({
    pass: isEdit(f, 'fb2'),
    ev: f,
  }));
  await delByKey(A, 'Delta');
  f = await focus(A);
  await check('C5', "delete the last of two (Delta): focus lands on the previous row's Edit (Bravo)", A, async () => ({ pass: isEdit(f, 'fb2'), ev: f }));
  await delByKey(A, 'Bravo');
  f = await focus(A);
  const left = await names(A);
  await check('C6', 'delete the only field (Bravo): focus lands on Add field', A, async () => ({
    pass: left.length === 0 && f?.a === 'newField' && f.connected,
    ev: { f, left },
  }));
  await check('C6b', 'the server list is empty after the five deletes; nothing pending', A, async () => ({
    pass: (await H.fieldsOnServer()).length === 0 && (await L.settle(A)).length === 0,
    ev: '',
  }));

  // ---- 3. Type -> Dropdown with the keyboard
  await A.focus('[data-a="newField"]');
  await A.keyboard.press('Enter');
  await sleep(500);
  await A.fill('#fd-name', 'Phase');
  await A.focus('button.select-btn[data-for="fd-type"]');
  await A.keyboard.press('Enter');
  await sleep(200);
  for (let i = 0; i < 3; i++) await A.keyboard.press('ArrowDown');
  await A.keyboard.press('Enter');
  await sleep(500);
  const ft = await A.evaluate(() => {
    const e = document.activeElement;
    return {
      trigger: e.matches('button.select-btn[data-for="fd-type"]'),
      connected: e.isConnected,
      expanded: e.getAttribute('aria-expanded'),
      text: e.textContent.trim(),
      options: !!document.querySelector('[data-a="fdOptAdd"]'),
    };
  });
  await check(
    'C7',
    'Add field: Type trigger, Enter, Down x3, Enter picks Dropdown; the dialog is drawn again and focus is on the (new) Type trigger',
    A,
    async () => ({ pass: ft.trigger && ft.connected && ft.expanded !== 'true' && ft.text.includes('Dropdown') && ft.options, ev: ft }),
  );
  await A.keyboard.press('Tab');
  const ft2 = await focus(A);
  await check('C7b', 'Tab from there moves on inside the dialog (it did not restart from the top)', A, async () => ({
    pass: !!ft2 && ft2.tag !== 'body' && (await A.evaluate(() => !!document.activeElement.closest('.modal'))) && ft2.id !== 'fd-name',
    ev: ft2,
  }));
  await H.cancelTop(A);

  // ---- 6. copy
  await X.putFields([
    T('client', 'Client'),
    {
      id: 'phase',
      name: 'Phase',
      type: 'select',
      inTable: false,
      options: [
        { id: 'o1', name: 'Alpha' },
        { id: 'o2', name: 'Beta' },
        { id: 'o3', name: 'Gamma' },
      ],
    },
    {
      id: 'rd',
      name: 'R&D <i>x</i>',
      type: 'select',
      inTable: false,
      options: [
        { id: 'r1', name: 'One' },
        { id: 'r2', name: 'Two' },
      ],
    },
  ]);
  await H.setProjectValues(H.P(1), { f_client: 'Acme', f_phase: 'o1', f_rd: 'r1' });
  await H.setProjectValues(H.P(2), { f_client: 'Beta Inc', f_phase: 'o1', f_rd: 'r2' });
  await H.setProjectValues(H.P(3), { f_phase: 'o2', f_rd: 'r1' });
  await sleep(2500);
  await H.goSettings(A);
  const all = norm(await A.locator('.set-in').innerText());
  await check(
    'K1',
    'Settings intro names the option: "...in the Projects table when “Show in the Projects table” is on."; "when ticked" is gone',
    A,
    async () => ({
      pass:
        all.includes(
          'Fill in values on a project’s Edit form. They show in its overview, and in the Projects table when “Show in the Projects table” is on.',
        ) && !/when ticked/.test(all),
      ev: all.slice(0, 220),
    }),
  );
  await A.click('[data-a="newField"]');
  await sleep(400);
  const dlg = norm(await A.locator('.modal').last().innerText());
  await check('K2', 'New field dialog subtitle: "Each project’s value is filled in on its Edit form."', A, async () => ({
    pass: dlg.includes('Each project’s value is filled in on its Edit form.') && !/A project’s values for it/.test(dlg),
    ev: dlg.slice(0, 120),
  }));
  await H.cancelTop(A);
  await A.click('[data-a="editField"][aria-label="Edit Client"]');
  await sleep(400);
  const ty = await A.evaluate(() => {
    const e = document.getElementById('fd-type');
    const n = document.getElementById('fd-name');
    const cs = getComputedStyle(e);
    return {
      readOnly: e.readOnly,
      disabled: e.disabled,
      desc: e.getAttribute('aria-describedby'),
      note: document.getElementById('fd-type-note')?.textContent.trim(),
      color: cs.color,
      nameColor: getComputedStyle(n).color,
      opacity: cs.opacity,
      val: e.value,
    };
  });
  await A.focus('#fd-name');
  await A.keyboard.press('Tab');
  const tabbed = await focus(A);
  await A.keyboard.type('xyz');
  const val2 = await A.inputValue('#fd-type');
  await check(
    'K3',
    'edit dialog: Type is a read-only input (not disabled), same text colour as the name, aria-describedby the note; Tab reaches it; typing does not change it',
    A,
    async () => ({
      pass:
        ty.readOnly &&
        !ty.disabled &&
        ty.desc === 'fd-type-note' &&
        ty.note === 'A field’s type can’t be changed after it’s created.' &&
        ty.color === ty.nameColor &&
        ty.opacity === '1' &&
        tabbed?.id === 'fd-type' &&
        val2 === 'Text' &&
        ty.val === 'Text',
      ev: { ty, tabbed, val2 },
    }),
  );
  await A.screenshot({ path: L.OUT + '/K-edit-dialog.png' });
  await H.cancelTop(A);
  // delete confirm
  const withClient = (await L.api('GET', '/collections/projects/records?perPage=200')).body.items.filter(r => r.doc.f_client).length;
  await A.click('[data-a="delField"][aria-label="Delete Client"]');
  await sleep(400);
  const dc = await H.confirmInfo(A);
  await check('K4', 'Delete-field confirm (several projects with a value): says the values stay on the projects but no longer show', A, async () => ({
    pass:
      dc.title === 'Delete the field “Client”?' &&
      dc.body ===
        `${withClient} projects have a value for it. Their values stay stored on the projects, but they won't show again, even if you add a field with the same name. Private projects you can't see aren't counted.` &&
      dc.ok === 'Delete field',
    ev: dc,
  }));
  await H.cancelTop(A);
  await A.click('[data-a="delField"][data-id="rd"]');
  await sleep(400);
  const dt2 = await A.evaluate(() => ({
    title: document.querySelector('h2[id="mt-confirm"]')?.innerText,
    kids: document.querySelector('h2[id="mt-confirm"]')?.querySelectorAll('i').length,
  }));
  await check('K4b', 'Delete-field question for a name with markup characters shows it literally (no <i> element made)', A, async () => ({
    pass: dt2.title === 'Delete the field “R&D <i>x</i>”?' && dt2.kids === 0,
    ev: dt2,
  }));
  await H.cancelTop(A);
  // remove-option confirms
  await A.click('[data-a="editField"][aria-label="Edit Phase"]');
  await sleep(400);
  await A.click('[data-a="fdOptRemove"][aria-label="Remove Beta"]');
  await sleep(200);
  await H.saveField(A);
  const c1 = await H.confirmInfo(A);
  await check(
    'K5',
    'remove one option in use by one project: title names the option and the field; body "1 project uses it. Its value stops showing."',
    A,
    async () => ({
      pass:
        c1.title === 'Remove the option “Beta” from Phase?' &&
        c1.body === "1 project uses it. Its value stops showing. Private projects you can't see aren't counted." &&
        c1.ok === 'Remove option',
      ev: c1,
    }),
  );
  await H.cancelTop(A);
  await A.click('[data-a="fdOptRemove"][aria-label="Remove Alpha"]');
  await sleep(200);
  await H.saveField(A);
  const c2 = await H.confirmInfo(A);
  await check(
    'K6',
    'remove two options in use (by 3 projects): "Remove 2 options from Phase?" with no names; "3 projects use them. Their values stop showing."',
    A,
    async () => ({
      pass:
        c2.title === 'Remove 2 options from Phase?' &&
        c2.body === "3 projects use them. Their values stop showing. Private projects you can't see aren't counted." &&
        c2.ok === 'Remove options',
      ev: c2,
    }),
  );
  await A.screenshot({ path: L.OUT + '/K-confirm.png' });
  await H.cancelTop(A);
  await H.cancelTop(A);
  await A.click('[data-a="editField"][aria-label="Edit Phase"]');
  await sleep(300);
  await A.click('[data-a="fdOptRemove"][aria-label="Remove Gamma"]');
  await sleep(200);
  await H.saveField(A);
  const gone = await H.modals(A); // Gamma is used by nobody: no question, saved
  await check('K7', 'removing an option nobody uses asks nothing: the dialog closes and it is saved', A, async () => ({
    pass: gone === 0 && (await H.fieldsOnServer()).find(x => x.id === 'phase').options.length === 2,
    ev: gone,
  }));
  // the field name is escaped in the question's title
  await A.click('[data-a="editField"][data-id="rd"]');
  await sleep(300);
  await A.click('[data-a="fdOptRemove"][data-i="0"]');
  await sleep(200);
  await H.saveField(A);
  const tt = await A.evaluate(() => ({
    title: document.querySelector('h2[id="mt-confirm"]')?.innerText,
    kids: document.querySelector('h2[id="mt-confirm"]')?.querySelectorAll('i').length,
    body: document.querySelector('.modal p.muted:last-of-type')?.innerText,
  }));
  await check('K8', "a field name with markup characters shows literally in the question's title (R&D <i>x</i>), no element made", A, async () => ({
    pass: tt.title === 'Remove the option “One” from R&D <i>x</i>?' && tt.kids === 0,
    ev: tt,
  }));
  await H.cancelTop(A);
  await H.cancelTop(A);

  // ---- 6. live announcement on a move
  await H.goSettings(A);
  await A.click('[data-a="moveField"][data-id="phase"][data-v="down"]');
  await sleep(400);
  const live1 = await A.$eval('#sr-live', e => e.textContent);
  const lv = await A.$eval('#sr-live', e => ({ live: e.getAttribute('aria-live'), role: e.getAttribute('role') }));
  await A.click('[data-a="moveField"][data-id="phase"][data-v="up"]');
  await sleep(400);
  const live2 = await A.$eval('#sr-live', e => e.textContent);
  await check('K9', 'moving a field says "Moved “Phase” down." / "…up." in the polite live region', A, async () => ({
    pass: live1 === 'Moved “Phase” down.' && live2 === 'Moved “Phase” up.' && lv.live === 'polite',
    ev: { live1, live2, lv },
  }));

  // ---- 8. the name is unique at write time
  await X.putFields([
    T('client', 'Client'),
    {
      id: 'phase',
      name: 'Phase',
      type: 'select',
      inTable: false,
      options: [
        { id: 'o1', name: 'Alpha' },
        { id: 'o2', name: 'Beta' },
      ],
    },
  ]);
  await H.setProjectValues(H.P(2), { f_phase: 'o1' });
  await sleep(2500);
  await H.goSettings(A);
  await H.goSettings(B);
  await sleep(500);
  // A: rename Phase to Region and remove an option in use -> the question. Meanwhile B adds Region. Then A confirms.
  await A.click('[data-a="editField"][aria-label="Edit Phase"]');
  await sleep(400);
  await A.fill('#fd-name', 'Region');
  await A.click('[data-a="fdOptRemove"][aria-label="Remove Alpha"]');
  await sleep(200);
  await H.saveField(A);
  const q = await H.confirmInfo(A);
  await H.newField(B, { name: 'Region' });
  await H.saveField(B);
  await L.settle(B);
  await sleep(2500); // (A's list now has B's Region; the question and the dialog are still open)
  const seen = await A.evaluate(() => window.__pmspace.D().ws && window.__pmspace.S.ui.modals.length);
  await H.okTop(A);
  await sleep(500);
  const t = (await H.toastTexts(A)).join('|');
  const dstate = { modals: await H.modals(A), err: await H.errText(A), focus: (await focus(A))?.id, toast: t };
  const srv = await H.fieldsOnServer();
  await check(
    'W1',
    'WRITE-TIME path: the validation passed (a question was asked), another admin added "Region", then OK: refused with a toast naming it; the dialog stays open with the inline error and focus on the name',
    A,
    async () => ({
      pass:
        /Remove the option/.test(q.title) &&
        dstate.modals === 1 &&
        /There is already a field called “Region”/.test(dstate.err) &&
        /There is already a field called “Region”\. Nothing was saved\./.test(t) &&
        dstate.focus === 'fd-name',
      ev: { q: q.title, modalsWhenOk: seen, dstate },
    }),
  );
  await check('W2', "the server has exactly one Region (B's), Phase untouched with both options", A, async () => ({
    pass:
      srv.filter(f => /^region$/i.test(f.name)).length === 1 &&
      srv.find(f => f.id === 'phase')?.name === 'Phase' &&
      srv.find(f => f.id === 'phase').options.length === 2,
    ev: srv.map(f => f.name),
  }));
  await A.screenshot({ path: L.OUT + '/W-refused.png' });
  // fixing the name lets it save (the same dialog)
  await A.fill('#fd-name', 'Phase 2');
  await H.saveField(A);
  await H.okTop(A);
  await sleep(300);
  const srv2 = await H.fieldsOnServer();
  await check('W3', 'rename it to something free in the same dialog: Save, OK: saved (Phase 2, one option left); the error is gone', A, async () => ({
    pass: (await H.modals(A)) === 0 && srv2.find(f => f.id === 'phase')?.name === 'Phase 2' && srv2.find(f => f.id === 'phase').options.length === 1,
    ev: srv2.map(f => f.name),
  }));
  // the validation path (the clash is already in the list when Save is pressed), for the record
  await A.click('[data-a="newField"]');
  await sleep(400);
  await A.fill('#fd-name', '  region ');
  await H.saveField(A);
  const e3 = await H.errText(A);
  await check('W4', 'VALIDATION path (the clash already in the list): "  region " is refused inline, the dialog stays', A, async () => ({
    pass: /already/i.test(e3) && (await H.modals(A)) === 1,
    ev: e3,
  }));
  await H.cancelTop(A);
  // write-time for a NEW field: A types Region2 in a new dialog; B adds Region2 first? (the dialog's validation sees it live) -> only the write-time path is tested above.
  await check('Z1', 'zero console errors in both sessions; nothing pending', A, async () => ({
    pass: errs().length === 0 && (await L.settle(A)).length === 0 && (await L.settle(B)).length === 0,
    ev: errs().slice(0, 5),
  }));
} catch (e) {
  console.log('SUITE ERROR', e);
  L.results.fail++;
}
console.log('RESULT', L.results.pass, 'pass', L.results.fail, 'fail');
await b.close();
