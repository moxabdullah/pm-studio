// Part 2 b: keyboard only
import * as L from './lib.mjs';
const b = await L.launch();
const ctx = await L.newCtx(b);
const page = await L.open(ctx, 'adm');
await L.login(page, 'hello@example.com');
await L.goProjects(page);
await page.locator('.seg button', { hasText: 'Board' }).click();
await L.sleep(500);
const desc = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    const bd = document.querySelector('.pboard')?.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    const inBoard = bd ? r.left >= bd.left - 1 && r.right <= bd.right + 1 : null;
    return `${a.tagName.toLowerCase()}${a.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''}:${(a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)}${bd && a.closest('.pboard') ? (inBoard ? ' (visible in board)' : ' (CLIPPED by board scroll)') : ''}`;
  });
const tab = async n => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
  }
  await L.sleep(120);
  return desc();
};
const sl = () => page.evaluate(() => Math.round(document.querySelector('.pboard').scrollLeft));
const srvStage = async name => (await L.pbList('projects')).find(p => p.doc.name === name)?.doc.stage;

let trace = [];
await L.check('b1', 'Tab from the layout toggle reaches a card stage button (tab order trace)', page, async () => {
  await page.locator('.seg button', { hasText: 'Board' }).focus();
  trace = [await desc()];
  let hit = false;
  for (let i = 0; i < 20; i++) {
    trace.push(await tab(1));
    if (/Move .* to another stage/.test(trace[trace.length - 1])) {
      hit = true;
      break;
    }
  }
  return { pass: hit, ev: `${trace.length - 1} Tab presses: ${trace.join('  >  ')}` };
});

let focusedId;
await L.check('b2', 'Enter on the stage button opens the picker; arrows + Enter pick Procurement; move happens; focus after', page, async () => {
  focusedId = await page.evaluate(() => document.activeElement.dataset.id);
  const name = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await page.keyboard.press('Enter');
  await L.sleep(400);
  const open = await page.locator('.pop.floating').count();
  const f0 = await desc();
  const items = await L.popItems(page);
  let steps = 0;
  let cur = f0;
  while (!/Procurement/.test(cur) && steps < 15) {
    await page.keyboard.press('ArrowDown');
    steps++;
    cur = await desc();
  }
  await page.keyboard.press('Enter');
  await L.sleep(800);
  const toast = await L.toastsTxt(page);
  const f1 = await desc();
  const col = await page.evaluate(id => document.querySelector(`.pbcard[data-id="${id}"]`)?.closest('section')?.getAttribute('aria-label'), focusedId);
  const st = await srvStage('Marketing Campaign');
  const focusId = await page.evaluate(() => document.activeElement.dataset.id + '/' + document.activeElement.dataset.pop);
  const pend = await L.pend(page);
  return {
    pass: open === 1 && col === 'Procurement' && st === 'procurement' && focusId === focusedId + '/pstage' && !pend.length,
    ev: `"${name}"; picker open=${open}, items=${items.length}, focus on open: ${f0}; ArrowDown x${steps} -> Enter; toast=${JSON.stringify(toast)}; card now in ${col}, server stage=${st}; focus after: ${f1}; scrollLeft=${await sl()}`,
  };
});

await L.shot(page, 'b2b-focus-clipped-after-pick');
await L.check('b2b', 'after the pick, the focused stage button is on screen (not clipped off by the board scroll)', page, async () => {
  const d = await desc();
  return { pass: /visible in board/.test(d), ev: d };
});

await L.check('b3', 'Escape closes the picker and returns focus to the stage button', page, async () => {
  await page.keyboard.press('Enter');
  await L.sleep(300);
  const open = await page.locator('.pop.floating').count();
  await page.keyboard.press('Escape');
  await L.sleep(300);
  const d = await desc();
  const closed = (await page.locator('.pop.floating').count()) === 0;
  return { pass: open === 1 && closed && /Move Marketing Campaign/.test(d), ev: `opened=${open}, closed after Esc=${closed}, focus: ${d}` };
});

await L.check('b4', 'pick a finished stage (Closed) by keyboard under the Active filter: card leaves the board; where does focus go', page, async () => {
  await page.keyboard.press('Enter');
  await L.sleep(300);
  await page.keyboard.press('End');
  await L.sleep(100); // Home/End are wired
  let cur = await desc();
  let steps = 0;
  while (!/Closed/.test(cur) && steps < 14) {
    await page.keyboard.press('ArrowUp');
    steps++;
    cur = await desc();
  }
  await page.keyboard.press('Enter');
  await L.sleep(800);
  const toast = await L.toastsTxt(page);
  const d = await desc();
  await L.shot(page, 'b4-focus-on-body-card-left-board');
  const gone = (await page.locator('.pbcard', { hasText: 'Marketing Campaign' }).count()) === 0;
  return { pass: gone && d !== 'BODY', ev: `picked "${cur}"; toast=${JSON.stringify(toast.slice(-1))}; card left board=${gone}; focus after: ${d}` };
});

// restore Marketing Campaign to tender via API
{
  const r = await L.pbGet('projects', 'seed000000000p3');
  await L.api('PATCH', '/collections/projects/records/seed000000000p3', { doc: { ...r.doc, stage: 'tender' } });
  await L.sleep(1200);
}

await L.check('b5', 'Tab through the collapsed finished strips; Enter expands "Closed", Space expands "Cancelled"', page, async () => {
  await page.locator('.pbcard[data-id="seed000000000p5"] [data-pop="pstage"]').focus(); // Installation card (last card on the board)
  const seq = [];
  let strip = null;
  for (let i = 0; i < 12; i++) {
    const d = await tab(1);
    seq.push(d);
    if (/^button:Expand Closed/.test(d)) {
      strip = d;
      break;
    }
  }
  if (!strip) return { pass: false, ev: 'never reached the Closed strip: ' + seq.join(' > ') };
  await page.keyboard.press('Enter');
  await L.sleep(500);
  const expanded = await page.locator('section.bcol[aria-label="Closed"]').count();
  const fAfter = await desc();
  await L.shot(page, 'b5-strip-expanded-focus-clipped');
  // Tab on to the Cancelled strip
  let seq2 = [];
  let strip2 = false;
  for (let i = 0; i < 8; i++) {
    const d = await tab(1);
    seq2.push(d);
    if (/^button:Expand Cancelled/.test(d)) {
      strip2 = true;
      break;
    }
  }
  if (strip2) {
    await page.keyboard.press('Space');
    await L.sleep(500);
  }
  const expanded2 = await page.locator('section.bcol[aria-label="Cancelled"]').count();
  const fAfter2 = await desc();
  return {
    pass: expanded === 1 && strip2 && expanded2 === 1,
    ev: `Tabs: ${seq.join(' > ')}; Enter on strip -> section "Closed" present=${expanded}, focus: ${fAfter}; then Tab x${seq2.length} -> ${seq2.join(' > ')}; Space -> "Cancelled" expanded=${expanded2}, focus: ${fAfter2}`,
  };
});

await L.check('b6', 'collapse an expanded column back with Enter on its header button: focus after', page, async () => {
  await page.locator('section.bcol[aria-label="Closed"] [data-a="togglePipeCol"]').focus();
  await page.keyboard.press('Enter');
  await L.sleep(500);
  const strip = await page.locator('button.bcol.collapsed[aria-label^="Expand Closed"]').count();
  const d = await desc();
  return { pass: strip === 1 && d !== 'BODY', ev: `collapsed again=${strip}; focus after: ${d}` };
});
console.log('console errors:', JSON.stringify(page.errs));
await b.close();
