/* Where things are and which ports to use. Everything is overridable from the environment:

   PM_SRC        the checkout under test (default: the repository this qa/ folder lives in)
   PM_PB_BIN     the PocketBase binary (default: <PM_SRC>/server/pocketbase)
   PB_PORT       the throwaway PocketBase (8095)
   VITE_PORT     vite, started in PM_SRC against that PocketBase (5180)
   PROXY_PORT    the fault proxy of the scenarios (8091)
   PM_OUT        output folder (default: qa/out/<suite>-<timestamp>; for "all" it is the parent of one folder per suite)

   Never point any of these at the real server on :8090 or at its pb_data. */
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

export const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
