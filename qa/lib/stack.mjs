/* The stack a browser suite needs: a throwaway PocketBase (the checkout's migrations and hooks, data under the output folder),
   the dev seed, vite against that PocketBase, and the helpers to run a script against it. Everything started is stopped by
   cleanup(), which also runs on Ctrl+C. */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, REPO_DIR } from './env.mjs';
import { Stack, killTree, listeners, sleep, waitHttp } from './procs.mjs';

const MARK = '.qa-scratch';

const SEED_SU = 'dev@pmspace.local'; // created by seed:dev with a published password; replaced at once (see rotateSuperuser)
export const SU_EMAIL = 'qa@pmspace.local';

export class Qa {
  constructor({ proxy = false, quiet = false } = {}) {
    this.cfg = config();
    this.proxy = proxy;
    this.stack = new Stack({
      ports: [this.cfg.pbPort, this.cfg.vitePort, ...(proxy ? [this.cfg.proxyPort] : [])],
      log: quiet ? () => {} : (...a) => console.log('[qa]', ...a),
    });
    this.pb = null;
    this.vite = null;
    this.viteLog = null;
    this.log = (...a) => this.stack.log(...a);
  }

  /* Checks the checkout and takes the ports. Call once, first. */
  init() {
    const { src } = this.cfg;
    for (const f of ['package.json', 'scripts/seed-dev.js', 'server/pb_migrations', 'server/pb_hooks', 'src'])
      if (!fs.existsSync(path.join(src, f))) throw new Error(`${src} does not look like a pm-studio checkout (missing ${f})`);
    let bin = this.cfg.pbBin;
    if (!fs.existsSync(bin) && !process.env.PM_PB_BIN) bin = path.join(REPO_DIR, 'server', 'pocketbase');
    if (!fs.existsSync(bin)) throw new Error(`no PocketBase binary at ${this.cfg.pbBin}. Set PM_PB_BIN, or run scripts/get-pocketbase.sh in the checkout.`);
    this.cfg.pbBin = bin;
    // seed:dev runs <checkout>/server/pocketbase itself, so a bare worktree gets a link (the file is git-ignored)
    const inSrc = path.join(src, 'server', 'pocketbase');
    if (!fs.existsSync(inSrc)) {
      fs.symlinkSync(bin, inSrc);
      this.log(`linked ${inSrc} -> ${bin}`);
    }
    const nm = path.join(src, 'node_modules');
    if (!fs.existsSync(nm)) {
      const from = path.join(REPO_DIR, 'node_modules');
      if (!fs.existsSync(from)) throw new Error(`no node_modules in ${src}: run npm ci there`);
      // per-package links, not one link: a link to the whole folder would put vite's cache (.vite) into the other checkout's node_modules
      fs.mkdirSync(nm);
      for (const e of fs.readdirSync(from)) if (!['.vite', '.vite-temp', '.cache'].includes(e)) fs.symlinkSync(path.join(from, e), path.join(nm, e));
      this.log(`created ${nm} with per-package links into ${from}`);
    }
    this.sha = spawnSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'no-git';
    this.stack.claimPorts();
    this.log(`checkout ${src} @ ${this.sha}`);
  }

  /* vite for the checkout, its /api proxy pointed at `target` (PocketBase, or the fault proxy). */
  async startVite(outDir, target = this.cfg.pbUrl) {
    const { src, vitePort, baseUrl } = this.cfg;
    this.viteLog = path.join(outDir, 'vite.log');
    this.vite = this.stack.start('vite', 'npx', ['vite', '--port', String(vitePort), '--strictPort'], {
      cwd: src,
      env: { ...process.env, PB_URL: target },
      logFile: this.viteLog,
    });
    await waitHttp(`${baseUrl}/`, 'vite', 90000, this.vite);
  }

  /* A new empty PocketBase, the dev seed, a random-password superuser. Returns what a suite needs in its environment. */
  async freshDb(outDir) {
    const { src, pbBin, pbPort, pbUrl } = this.cfg;
    await this.stopPb();
    const dataDir = path.join(outDir, 'pb_data');
    // Only a folder this runner made (it holds the marker) is ever deleted, so a PM_OUT pointing at server/ can't wipe a real pb_data.
    if (fs.existsSync(dataDir)) {
      if (!fs.existsSync(path.join(dataDir, MARK))) throw new Error(`${dataDir} was not made by qa/: refusing to delete it`);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, MARK), '');
    const logFile = path.join(outDir, 'pocketbase.log');
    this.pb = this.stack.start(
      'pocketbase',
      pbBin,
      [
        'serve',
        `--http=127.0.0.1:${pbPort}`,
        `--dir=${dataDir}`,
        `--migrationsDir=${path.join(src, 'server', 'pb_migrations')}`,
        `--hooksDir=${path.join(src, 'server', 'pb_hooks')}`,
      ],
      { cwd: src, logFile },
    );
    await waitHttp(`${pbUrl}/api/health`, 'PocketBase', 60000, this.pb);
    const seed = spawnSync('npm', ['run', 'seed:dev', '--', '--dev-database'], {
      cwd: src,
      env: { ...process.env, PB_DIR: dataDir, PB_URL: pbUrl },
      encoding: 'utf8',
      timeout: 120000,
    });
    // the seed prints the published password of its own superuser: it is replaced below, and kept out of the log anyway
    const text = ((seed.stdout || '') + (seed.stderr || '')).replace(/^Superuser .*$/m, 'Superuser (replaced after the seed)');
    fs.writeFileSync(path.join(outDir, 'seed.log'), text);
    if (seed.status !== 0) throw new Error(`seed:dev failed (exit ${seed.status}), see ${path.join(outDir, 'seed.log')}`);
    const suPassword = this.rotateSuperuser(dataDir);
    return { suEmail: SU_EMAIL, suPassword, dataDir };
  }

  // a superuser with a random password for this database only; the one seed:dev made (published password) is deleted
  rotateSuperuser(dataDir) {
    const { pbBin } = this.cfg;
    const password = 'p' + crypto.randomBytes(18).toString('base64url'); // starts with a letter: base64url can start with "-", which the CLI reads as a flag
    const run = args => {
      const r = spawnSync(pbBin, [...args, `--dir=${dataDir}`], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`pocketbase ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || r.error?.message || '').slice(0, 200)}`);
    };
    run(['superuser', 'upsert', SU_EMAIL, password]);
    run(['superuser', 'delete', SEED_SU]);
    return password;
  }

  async stopPb() {
    if (this.pb) {
      await this.stack.stopOne(this.pb);
      this.pb = null;
    }
    await this.stack.freePort(this.cfg.pbPort);
  }

  /* Opens the app once so vite's first-load dependency pre-bundling (which can reload the page) is over before a suite starts. */
  async warmUp() {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${this.cfg.baseUrl}/`);
      await page.waitForSelector('#l-email', { timeout: 60000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.reload();
      await page.waitForSelector('#l-email', { timeout: 60000 });
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /* Runs a node script with the kit's environment; its output goes to <outDir>/<name>.out.txt. */
  async runScript(script, { outDir, name, env = {}, timeoutS = 1500, args = [] }) {
    const t0 = Date.now();
    const file = path.join(outDir, `${name}.out.txt`);
    const child = this.stack.start('script', process.execPath, [script, ...args], {
      cwd: path.dirname(script),
      env: { ...process.env, ...env },
      logFile: file,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, 'SIGKILL');
    }, timeoutS * 1000);
    const code = await new Promise(resolve => {
      if (child.exitCode !== null) resolve(child.exitCode);
      child.once('exit', (c, sig) => resolve(c ?? (sig ? 128 : 1)));
    });
    clearTimeout(timer);
    killTree(child.pid, 'SIGKILL'); // anything the script left behind (browsers)
    return { code, timedOut, secs: Math.round((Date.now() - t0) / 1000), file };
  }

  suiteEnv(db, outDir) {
    const { src, pbUrl, baseUrl, proxyUrl, pbPort, proxyPort, vitePort } = this.cfg;
    return {
      PM_SRC: src,
      PM_BASE: baseUrl,
      PM_PB: pbUrl,
      PM_OUT: outDir,
      PM_SU_EMAIL: db.suEmail,
      PM_SU_PASSWORD: db.suPassword,
      PM_PROXY: proxyUrl,
      PB_PORT: String(pbPort),
      PROXY_PORT: String(proxyPort),
      VITE_PORT: String(vitePort),
    };
  }

  cleanup() {
    return this.stack.cleanup();
  }

  listeners(port) {
    return listeners(port);
  }
}

export { sleep, waitHttp };
