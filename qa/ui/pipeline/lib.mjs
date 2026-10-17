/* Helpers of the project-pipeline board suite. The browser helpers are the kit's
   own (../../lib/browser.mjs); `api` differs on purpose: it returns the parsed body and throws on a non-2xx answer. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as B from '../../lib/browser.mjs';

export * from '../../lib/browser.mjs';
const { sleep, OUT, PBU, BASE } = B;
export { BASE };

await B.suLogin();
const SU = B.suToken();

export async function newCtx(browser, { w = 1280, h = 800, dark = false } = {}) {
  return browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
}

export async function api(method, apiPath, body) {
  const r = await fetch(PBU + '/api' + apiPath, {
    method,
    headers: { Authorization: SU, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = t;
  }
  if (!r.ok) throw new Error(`${method} ${apiPath} -> ${r.status} ${t.slice(0, 200)}`);
  return j;
}
export const pbGet = (coll, id) => api('GET', `/collections/${coll}/records/${id}`);
export const pbList = async (coll, filter = '') =>
  (await api('GET', `/collections/${coll}/records?perPage=200${filter ? '&filter=' + encodeURIComponent(filter) : ''}`)).items;

export const cards = page => page.evaluate(() => [...document.querySelectorAll('.pcard')].map(c => c.querySelector('b')?.textContent.trim()));
export const rows = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.mini[data-a="go"], tbody tr[data-a="go"]')].map(c =>
      (c.querySelector('b, td span span')?.textContent || c.textContent).trim().slice(0, 40),
    ),
  );
export const goProjects = async page => {
  await page.evaluate(() => window.__pmspace.go('projects'));
  await sleep(500);
};
export const goProj = async (page, id, tab = 'overview') => {
  await page.evaluate(([i, t]) => window.__pmspace.go('project', { id: i, tab: t }), [id, tab]);
  await sleep(600);
};
export const popItems = page =>
  page
    .locator('.pop.floating .mi')
    .allInnerTexts()
    .then(a => a.map(s => s.trim().replace(/\s+/g, ' ')));
export const popPick = async (page, text) => {
  await page.locator('.pop.floating .mi', { hasText: text }).first().click();
  await sleep(300);
};
export async function stageHistRows(page) {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Stage history');
    if (!h) return null;
    const body = h.closest('section').querySelector('.panel-b');
    return [...body.children].map(r => r.innerText.replace(/\s+/g, ' ').trim());
  });
}
export const goStages = async page => {
  await page.evaluate(() => window.__pmspace.go('settings', { sec: 'stages' }));
  await sleep(600);
};
export const pills = page =>
  page.evaluate(() => {
    const o = {};
    for (const c of document.querySelectorAll('.pcard')) o[c.querySelector('b').textContent.trim()] = c.querySelector('.pstatus')?.textContent.trim();
    return o;
  });
export const ssRoot = 'form[data-submit="submitStageSet"]';
export const ssSave = async page => {
  await page.locator('.modal-f [data-a="submitStageSet"], [data-a="submitStageSet"].btn').first().click();
  await sleep(900);
};
export const setsOnServer = async () => pbList('stage_sets');
export const stageNames = s => s.doc.stages.map(x => x.name);

export const defSet = async () => (await import(pathToFileURL(path.join(B.SRC, 'src', 'core', 'constants.js')).href)).DEFAULT_STAGE_SET;
export const mkSet = (workspace, name, stages) => api('POST', '/collections/stage_sets/records', { workspace, name, doc: { stages } });
export const toastsTxt = page => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
export const actCount = page => page.evaluate(() => window.__pmspace.D().activity.length);
export const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
export const RED = page =>
  page.evaluate(() => {
    const pr = document.createElement('i');
    pr.style.background = 'var(--red)';
    document.body.append(pr);
    const c = getComputedStyle(pr).backgroundColor;
    pr.remove();
    return c;
  });
export const cssVar = (page, v) =>
  page.evaluate(v => {
    const pr = document.createElement('i');
    pr.style.background = `var(--${v})`;
    document.body.append(pr);
    const c = getComputedStyle(pr).backgroundColor;
    pr.remove();
    return c;
  }, v);
