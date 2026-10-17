// The sync harness: `node qa/sync/run.mjs [checkout] [-v] [--only=views,msgs,prefs]`.
//
// Bundles each test file against <checkout>/src (default: the repo this file lives in) with a fake PocketBase in place of src/core/pb.js
// (stub-pb.mjs), then runs the bundles under Node. Needs no server and no browser. Exits 0 only if no check printed FAIL; KNOWN checks
// (bugs on main that a check already covers) do not fail the run.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const only = args.find(a => a.startsWith('--only='));
const checkout = resolve(args.find(a => !a.startsWith('-')) || repo);
const src = join(checkout, 'src');
const out = join(repo, 'qa/out/sync');
const GROUPS = ['views', 'msgs', 'prefs'].filter(g => !only || only.slice(7).split(',').includes(g));

if (!existsSync(join(src, 'core/sync.js'))) {
  console.error(`sync: ${src}/core/sync.js not found (usage: node qa/sync/run.mjs [checkout])`);
  process.exit(2);
}

// esbuild comes with vite: the checkout's own copy first, else this repo's.
function loadEsbuild() {
  for (const root of [checkout, repo]) {
    try {
      return createRequire(join(root, 'package.json'))('esbuild');
    } catch {
      /* next */
    }
  }
  console.error('sync: esbuild not found in the checkout or the repo (run npm ci)');
  process.exit(2);
}

const stubs = {
  name: 'sync-harness',
  setup(b) {
    // `app/x.js` in the tests is <checkout>/src/x.js; `qa:src` is the path itself, for the tests that read the source.
    b.onResolve({ filter: /^app\// }, a => ({ path: join(src, a.path.slice(4)) }));
    b.onResolve({ filter: /^qa:src$/ }, a => ({ path: a.path, namespace: 'qa' }));
    b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: `export const SRC = ${JSON.stringify(src)};`, loader: 'js' }));
    b.onResolve({ filter: /\/pb\.js$/ }, () => ({ path: join(here, 'stub-pb.mjs') }));
    b.onResolve({ filter: /^virtual:icons$/ }, () => ({ path: join(here, 'stub-icons.mjs') }));
    // The real render() needs a browser DOM, and the actions call it after every change. Pages and actions are otherwise the real files.
    b.onLoad({ filter: /[\\/]shell[\\/]render\.js$/ }, a => {
      const head = 'export function render() {';
      const text = readFileSync(a.path, 'utf8');
      if (!text.includes(head)) throw new Error(`${a.path}: no "${head}" to guard (qa/sync/run.mjs patches it)`);
      return { contents: text.replace(head, `${head}\n  if (globalThis.__noRender) return;`), loader: 'js' };
    });
  },
};

mkdirSync(out, { recursive: true });
await loadEsbuild().build({
  entryPoints: Object.fromEntries(GROUPS.map(g => [g, join(here, `${g}.test.mjs`)])),
  outdir: out,
  outExtension: { '.js': '.mjs' },
  inject: [join(here, 'shim.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env': '{}' },
  nodePaths: [join(checkout, 'node_modules'), join(repo, 'node_modules')], // (files.js imports pocketbase itself; a scratch copy of src/ has no node_modules)
  logLevel: 'error',
  plugins: [stubs],
});

const t0 = Date.now();
const total = { ok: 0, FAIL: 0, KNOWN: 0 };
const runGroup = g =>
  new Promise(done => {
    const n = { ok: 0, FAIL: 0, KNOWN: 0 };
    const lines = [];
    let rest = '';
    const take = chunk => {
      rest += chunk;
      const parts = rest.split('\n');
      rest = parts.pop();
      for (const line of parts) {
        const m = /^ {4}(ok|FAIL|KNOWN)\b/.exec(line);
        if (m) n[m[1]]++;
        if (m || verbose || line.startsWith('== ')) lines.push(line);
      }
    };
    // stderr is the app's own console.warn/error (the give-up and offline messages the checks provoke): shown with -v, or when the group dies.
    let err = '';
    const child = spawn(process.execPath, [join(out, `${g}.mjs`)], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', c => (err += c));
    child.on('close', (code, signal) => {
      take('\n');
      // A group that ends other than by finishing (a throw, a hang cut short) counts as one FAIL, so it can't pass by printing less.
      if (code !== (n.FAIL ? 1 : 0) || n.ok + n.KNOWN === 0) {
        lines.push(`    FAIL ${g}: the run ended abnormally (exit ${code ?? signal}, ${n.ok + n.FAIL + n.KNOWN} checks)`);
        n.FAIL++;
        lines.push(...err.split('\n').slice(-30));
      } else if (verbose) lines.push(...err.split('\n'));
      done({ g, n, lines });
    });
  });

for (const r of await Promise.all(GROUPS.map(runGroup))) {
  console.log(`\n#### ${r.g}`);
  for (const line of r.lines) console.log(line);
  console.log(`${r.g}: ${r.n.ok} ok, ${r.n.FAIL} FAIL, ${r.n.KNOWN} KNOWN`);
  for (const k of Object.keys(total)) total[k] += r.n[k];
}
console.log(`\nsync: ${total.ok} ok, ${total.FAIL} FAIL, ${total.KNOWN} KNOWN (${((Date.now() - t0) / 1000).toFixed(1)} s, against ${src})`);
process.exit(total.FAIL ? 1 : 0);
