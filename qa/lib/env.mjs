/* Where things are and which ports to use. Everything is overridable from the environment:

   PM_SRC        the checkout under test (default: the repository this qa/ folder lives in)
   PM_PB_BIN     the PocketBase binary (default: <PM_SRC>/server/pocketbase)
   PB_PORT       the throwaway PocketBase (8095)
   VITE_PORT     vite, started in PM_SRC against that PocketBase (5180)
   PROXY_PORT    the fault proxy of the scenarios (8091)
   PM_OUT        output folder (default: qa/out/<suite>-<timestamp>; for "all" it is the parent of one folder per suite)

   Never point any of these at the real server on :8090 or at its pb_data. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(QA_DIR, '..');

const port = (name, dflt) => {
  const n = Number(process.env[name] || dflt);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} is not a port: ${process.env[name]}`);
  return n;
};

export function config() {
  const src = path.resolve(process.env.PM_SRC || REPO_DIR);
  const pbPort = port('PB_PORT', 8095);
  const vitePort = port('VITE_PORT', 5180);
  const proxyPort = port('PROXY_PORT', 8091);
  if ([pbPort, vitePort, proxyPort].includes(8090)) throw new Error('port 8090 is the real server: refusing to use it');
  return {
    src,
    pbBin: path.resolve(process.env.PM_PB_BIN || path.join(src, 'server', 'pocketbase')),
    pbPort,
    vitePort,
    proxyPort,
    pbUrl: `http://127.0.0.1:${pbPort}`,
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    // vite may listen on ::1 only, so the browser goes through "localhost"
    baseUrl: `http://localhost:${vitePort}`,
  };
}

// the real path of something that may not exist yet: the nearest existing parent is resolved, so a link into server/ is seen too
function realPath(p) {
  let head = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...rest.reverse());
    } catch {
      const up = path.dirname(head);
      if (up === head) return path.resolve(p);
      rest.push(path.basename(head));
      head = up;
    }
  }
}

/* An output folder gets a throwaway pb_data, logs and screenshots. Refuses server/ of this repo or of any given checkout (and
   anything under it): that is where a normal server keeps its pb_data. Returns the resolved folder. */
export function assertScratchDir(dir, ...checkouts) {
  const d = realPath(dir);
  for (const root of new Set([REPO_DIR, ...checkouts.filter(Boolean).map(c => path.resolve(c))])) {
    const server = realPath(path.join(root, 'server'));
    const rel = path.relative(server, d);
    if (rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)))
      throw new Error(`output folder ${dir} is the server folder ${server} or inside it: refusing to use it`);
  }
  return path.resolve(dir);
}

export const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
