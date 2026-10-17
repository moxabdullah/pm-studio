// helpers shared by the smoke sections
import * as L from '../lib/browser.mjs';
export const { sleep } = L;
export const norm = s => String(s).replace(/\s+/g, ' ').trim();
export const W1 = L.W1,
  W2 = L.W2;
export const P = n => 'seed000000000p' + n;
export async function mkPage(b, email, w = 1280, h = 800, tag = email.split('@')[0]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await L.open(ctx, tag);
  await L.login(page, email);
  page.ctx = ctx;
  return page;
}
export const modals = page => page.evaluate(() => window.__pmspace.S.ui.modals.length);
export const toastTexts = page =>
  page
    .locator('.toast')
    .allInnerTexts()
    .then(a => a.map(norm));
export const listRec = async ws => (await L.lists()).find(r => r.workspace === (ws || W1));
export const fieldsOnServer = async ws => (await listRec(ws))?.doc?.fields;
export const projRec = async pid => (await L.api('GET', '/collections/projects/records/' + pid)).body;
export const fkeys = rec =>
  Object.keys(rec.doc)
    .filter(k => k.startsWith('f_'))
    .sort();
export async function goSettings(page, sec = 'fields') {
  await page.evaluate(s => window.__pmspace.go('settings', { sec: s }), sec);
  await sleep(450);
}
export async function goProject(page, pid, tab = 'overview') {
  await page.evaluate(([i, t]) => window.__pmspace.go('project', { id: i, tab: t }), [pid, tab]);
  await sleep(600);
}
export async function goProjects(page, view) {
  await page.evaluate(() => window.__pmspace.go('projects'));
  await sleep(450);
  if (view) {
    await page.evaluate(v => {
      window.__pmspace.S.ui.projView = v;
      window.__pmspace.render();
    }, view);
    await sleep(300);
  }
}
// the enhanced select: open its button, click the item with that text
export async function pick(page, id, text) {
  await page.locator(`button.select-btn[data-for="${id}"]`).scrollIntoViewIfNeeded(); // (a scroll closes the menu)
  await sleep(250);
  await page.click(`button.select-btn[data-for="${id}"]`);
  await sleep(150);
  await page
    .locator('.select-menu .mi', { hasText: new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') })
    .first()
    .click();
  await sleep(250);
}
export const fieldRowNames = page => page.$$eval('.set-in .srow .t', els => els.map(e => e.textContent.trim()));
export const fieldRowMeta = page => page.$$eval('.set-in .srow', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
export async function newField(page, { name, type = 'Text', table = false, options = [] }) {
  await page.click('[data-a="newField"]');
  await sleep(350);
  await page.fill('#fd-name', name);
  if (type !== 'Text') await pick(page, 'fd-type', type);
  if (type === 'Dropdown') {
    for (const [i, o] of options.entries()) {
      await page.click('[data-a="fdOptAdd"]');
      await sleep(120);
      await page.fill(`#fd-opt-${i}`, o);
    }
  }
  if (table) await page.check('#fd-table');
  else await page.uncheck('#fd-table');
}
export const saveField = async page => {
  await page.locator('.modal-f [data-a="submitField"]').click();
  await sleep(600);
};
export const errText = page =>
  page
    .locator('#fd-name-err, #fd-list-err')
    .first()
    .innerText()
    .then(norm)
    .catch(() => '');
export const confirmInfo = async page => ({
  title: norm(await page.locator('h2[id="mt-confirm"]').last().innerText()),
  body: norm(await page.locator('.modal p.muted').last().innerText()),
  ok: norm(await page.locator('[data-a="confirmOk"]').innerText()),
});
export const noHScroll = page =>
  page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth }));
export async function setProjectValues(pid, vals) {
  const r = await projRec(pid);
  await L.api('PATCH', '/collections/projects/records/' + pid, { doc: { ...r.doc, ...vals } });
}
export const waitVal = (page, pid, k, v) =>
  page
    .waitForFunction(([i, key, val]) => window.__pmspace.D().projects.find(x => x.id === i)?.[key] === val, [pid, k, v], { timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
export async function waitD(page, fn, arg, ms = 15000) {
  return page.waitForFunction(fn, arg, { timeout: ms }).then(
    () => true,
    () => false,
  );
}
export const cancelTop = async page => {
  await page.locator('.modal [data-a="closeModal"]').last().click();
  await sleep(300);
};
export const okTop = async page => {
  await page.locator('[data-a="confirmOk"]').last().click();
  await sleep(700);
};
export const detailRows = page =>
  page.$$eval('dl dt', els => els.map(e => [e.innerText.replace(/\s+/g, ' ').trim(), e.nextElementSibling?.innerText.replace(/\s+/g, ' ').trim()]));
export const tableHead = page => page.$$eval('table.perm-t thead th', els => els.map(e => e.innerText.trim()));
export const tableRow = (page, pid) => page.$$eval(`table.perm-t tr[data-id="${pid}"] td`, els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
export const fid = async (name, ws) => (await fieldsOnServer(ws))?.find(f => f.name === name)?.id;
export async function openEdit(page, pid) {
  await goProject(page, pid);
  await page.click(`[data-a="editProject"][data-id="${pid}"]`);
  await sleep(400);
}
export const saveProject = async page => {
  await page.locator('.modal-f [data-a="submitProject"]').click();
  await sleep(700);
};
export const rowBtn = (page, a, name) =>
  page.locator(
    `[data-a="${a}"][aria-label="${a === 'editField' ? 'Edit' : a === 'delField' ? 'Delete' : name.dir ? 'Move' : ''} ${name.n || name}${name.dir ? ' ' + name.dir : ''}"]`,
  );
// the theme through the app's own action (a button with data-a="setTheme" is all the click handler needs), so the preference is saved the way a click on it would
export const setTheme = async (page, v) => {
  await page.evaluate(t => {
    const b = document.createElement('button');
    b.dataset.a = 'setTheme';
    b.dataset.v = t;
    b.style.display = 'none';
    document.body.appendChild(b);
    b.click();
    b.remove();
  }, v);
  await sleep(500);
};
