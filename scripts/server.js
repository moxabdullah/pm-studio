/* Runs the local PocketBase server with this repo's migrations, hooks and built app (npm run server).
   Extra arguments go straight to `pocketbase serve` and win over the defaults, e.g.
     npm run server -- --http=127.0.0.1:8091
   PB_DIR points the data directory somewhere else (npm run seed:dev reads the same variable). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'server');
const windows = process.platform === 'win32';
const bin = path.join(server, windows ? 'pocketbase.exe' : 'pocketbase');

if (!fs.existsSync(bin)) {
  console.error(`PocketBase is not installed (${path.relative(root, bin)} is missing).`);
  console.error(`Run ${windows ? 'scripts\\get-pocketbase.ps1' : 'scripts/get-pocketbase.sh'} first.`);
  process.exit(1);
}

const args = [
  'serve',
  '--http=127.0.0.1:8090',
  `--dir=${process.env.PB_DIR ? path.resolve(process.env.PB_DIR) : path.join(server, 'pb_data')}`,
  `--migrationsDir=${path.join(server, 'pb_migrations')}`,
  `--hooksDir=${path.join(server, 'pb_hooks')}`,
  `--publicDir=${path.join(server, 'pb_public')}`,
  ...process.argv.slice(2),
];

// On POSIX the child gets its own process group, so a terminal's Ctrl+C reaches only this script, which passes it on
// exactly once (a second signal would cut PocketBase's graceful shutdown short). The Windows console delivers Ctrl+C
// to both processes, and kill() there would end PocketBase abruptly, so on Windows we just wait for it to exit.
const child = spawn(bin, args, { cwd: root, stdio: 'inherit', detached: !windows });
let stopping = false;
child.on('error', err => {
  console.error(`Could not start ${bin}: ${err.message}`);
  process.exit(1);
});
child.on('exit', code => process.exit(code ?? (stopping ? 0 : 1)));

for (const [received, forwarded] of [
  ['SIGINT', 'SIGINT'],
  ['SIGTERM', 'SIGTERM'],
  ['SIGHUP', 'SIGTERM'],
  ['SIGBREAK', 'SIGTERM'],
]) {
  process.on(received, () => {
    if (stopping) return;
    stopping = true;
    if (!windows) child.kill(forwarded);
  });
}
