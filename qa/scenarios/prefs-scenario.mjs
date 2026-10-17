/* P1: is a user_prefs update pending from page load, and does a PATCH 200 clear it?
   SCENARIO=prefs-scenario.mjs node run.mjs <checkout> <out>. Samples sync.pendingDetails() and records every user_prefs request. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runScenario(cfg) {
  const { baseUrl, proxyUrl, outDir, email, password } = cfg;
  const fault = async mode => (await fetch(`${proxyUrl}/__fault?mode=${mode}`)).json();
  const out = { phases: [], requests: [], console: [] };
  const t0 = Date.now();
  const save = () => fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', m => {
      const t = m.text();
      if (/status of 5\d\d/.test(t)) return;
      if (m.type() === 'error' || m.type() === 'warning' || /sync/.test(t))
        out.console.push({ s: (Date.now() - t0) / 1000, type: m.type(), text: t.slice(0, 400) });
    });
    page.on('pageerror', e => out.console.push({ s: (Date.now() - t0) / 1000, type: 'pageerror', text: String(e).slice(0, 300) }));
    page.on('response', async res => {
      const req = res.request();
      if (!/user_prefs/.test(req.url())) return;
      let body = '';
      try {
        body = (await res.text()).slice(0, 1500);
      } catch {
        // no readable body
      }
      out.requests.push({
        s: (Date.now() - t0) / 1000,
        method: req.method(),
        url: req
          .url()
          .replace(/^https?:\/\/[^/]+/, '')
          .slice(0, 160),
        sent: (req.postData() || '').slice(0, 1500),
        status: res.status(),
        patchHdr: res.headers()['x-doc-patch'] || null,
        body,
      });
    });
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForSelector('#l-email', { timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#l-email', { timeout: 60000 });
    await page.fill('#l-email', email);
    await page.fill('#l-pw', password);
    await page.click('#login-btn');
    const ready = () =>
      page.waitForFunction(
        () => {
          const g = window.__pmspace;
          return g && g.pb.authStore.isValid && !g.S.ui.loading && !document.querySelector('.auth-card');
        },
        null,
        { timeout: 60000, polling: 100 },
      );
    await ready();

    const sample = async (name, ms) => {
      const ph = { name, start: (Date.now() - t0) / 1000, samples: [] };
      out.phases.push(ph);
      let last = null;
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const v = await page
          .evaluate(() => ({
            d: window.__pmspace.sync.pendingDetails(),
            off: !!window.__pmspace.S.ui.offline,
            prefs: JSON.stringify(window.__pmspace.S.prefs),
          }))
          .catch(e => ({ err: String(e).slice(0, 200) }));
        const key = JSON.stringify(v);
        if (key !== last) ph.samples.push({ s: (Date.now() - t0) / 1000, ...v });
        last = key;
        await sleep(200);
      }
      save();
    };

    await sample('after-login', 20000);
    await page.reload({ waitUntil: 'load' });
    await ready();
    await sample('after-reload', 15000);
    await fault('5xx');
    await sample('outage-5xx', 10000);
    await fault('ok');
    await sample('after-outage', 45000);
    // a second, fresh page (new context, new login): what does a load see now that the server has whatever was written?
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await c2.newPage();
    await p2.goto(baseUrl, { waitUntil: 'load' });
    await p2.waitForSelector('#l-email', { timeout: 60000 });
    await p2.fill('#l-email', email);
    await p2.fill('#l-pw', password);
    await p2.click('#login-btn');
    await p2.waitForFunction(
      () => {
        const g = window.__pmspace;
        return g && g.pb.authStore.isValid && !g.S.ui.loading && !document.querySelector('.auth-card');
      },
      null,
      { timeout: 60000, polling: 100 },
    );
    await sleep(8000);
    out.secondPage = await p2.evaluate(() => ({ d: window.__pmspace.sync.pendingDetails(), prefs: JSON.stringify(window.__pmspace.S.prefs) }));
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    await fault('ok').catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    save();
    console.log(
      JSON.stringify({
        phases: out.phases.map(p => ({ name: p.name, n: p.samples.length, last: p.samples.at(-1)?.d })),
        requests: out.requests.length,
        error: out.error || null,
      }),
    );
  }
  return out;
}
