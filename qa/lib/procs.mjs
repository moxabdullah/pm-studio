/* Process management for the kits: start things detached with their output in a log file, and stop all of them again, whatever
   happens (normal end, failure, Ctrl+C, SIGTERM). A Stack only ever signals processes it started itself (or that sit in a process
   group it started); a listener on one of its ports that is not one of those is a port conflict and is left alone. */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* One entry per listener on the port: its pid, or null when ss lists a socket without showing the owner (another user's process).
   Throws when ss cannot run: a port that cannot be checked is not a free port. */
export function listeners(port) {
  const r = spawnSync('ss', ['-ltnHp', `sport = :${port}`], { encoding: 'utf8' });
  if (r.error || r.status !== 0)
    throw new Error(`cannot list the listeners on port ${port} (ss ${r.error ? r.error.message : `exited with ${r.status}`}): refusing to go on`);
  const out = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const pids = [...line.matchAll(/pid=(\d+)/g)].map(m => Number(m[1]));
    if (pids.length) out.push(...pids);
    else out.push(null);
  }
  return out;
}

// the process group of a pid (Linux), or null when it cannot be read
function pgidOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
  } catch {
    return null;
  }
}

// every child is started detached, so it leads a group of its own (npx vite has children): signal that group, never a bare pid
export function killTree(pid, sig) {
  try {
    process.kill(-pid, sig);
  } catch {
    // already gone
  }
}

const exited = child => child.exitCode !== null || child.signalCode !== null;

export async function waitHttp(url, what, ms, child) {
  const end = Date.now() + ms;
  for (;;) {
    if (child && exited(child)) throw new Error(`${what} exited (code ${child.exitCode}, signal ${child.signalCode}) before it was ready`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`${what} not ready at ${url} after ${ms} ms`);
    await sleep(250);
  }
}

export class Stack {
  constructor({ ports = [], log = (...a) => console.log('[qa]', ...a) } = {}) {
    this.ports = ports;
    this.log = log;
    this.procs = new Set();
    this.started = new Set(); // every pid started here (never pruned): each leads a process group of its own
    this.cleaned = false;
    this.onSignal = async sig => {
      this.log(`${sig}: stopping everything`);
      await this.cleanup();
      process.exit(130);
    };
  }

  /* Refuses to start (exit code 3) when one of the ports is already in use: it belongs to a stranger and is left alone. */
  claimPorts() {
    let busy;
    try {
      busy = this.ports.filter(p => listeners(p).length);
    } catch (e) {
      this.cleaned = true; // nothing of ours is running
      throw e;
    }
    if (busy.length) {
      this.cleaned = true; // nothing of ours is running: never sweep a stranger's processes
      console.error(`ports already in use: ${busy}. Stop whatever holds them or choose other ports (PB_PORT, VITE_PORT, PROXY_PORT).`);
      process.exit(3);
    }
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, this.onSignal);
  }

  // a pid this Stack started, or one inside a process group it started
  isOurs(pid) {
    if (pid == null) return false;
    return this.started.has(pid) || this.started.has(pgidOf(pid));
  }

  killOurs(pid, sig) {
    const group = this.started.has(pid) ? pid : pgidOf(pid);
    if (this.started.has(group)) killTree(group, sig);
  }

  /* After a service says it is ready: the process listening on its port must be one this Stack started. A stranger that took the
     port (or won the race for it) would otherwise answer the readiness check, and the suite would run against it. */
  verifyOwn(port, what) {
    const found = listeners(port);
    const foreign = found.filter(p => !this.isOurs(p));
    if (!found.length || foreign.length)
      throw new Error(
        `${what} answers on port ${port}, but the listener there (${found.length ? found.map(p => p ?? 'unknown pid').join(', ') : 'none'}) is not the one this run started: port conflict`,
      );
  }

  start(name, cmd, args, { cwd, env, logFile } = {}) {
    const file = logFile || path.join(process.cwd(), `${name}.log`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'a');
    const child = spawn(cmd, args, { cwd, env: env || process.env, detached: true, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    child.on('error', err => this.log(`${name} failed to start: ${err.message}`));
    child.once('exit', () => this.procs.delete(child));
    this.procs.add(child);
    if (child.pid) this.started.add(child.pid);
    this.log(`started ${name} (pid ${child.pid})`);
    return child;
  }

  async stopOne(child, grace = 4000) {
    if (!child.pid || exited(child)) return;
    killTree(child.pid, 'SIGTERM');
    const end = Date.now() + grace;
    while (!exited(child) && Date.now() < end) await sleep(100);
    killTree(child.pid, 'SIGKILL');
    this.procs.delete(child);
  }

  /* Waits for the port to clear. What is still listening afterwards is killed only if this Stack started it; anyone else's
     listener is a port conflict (an error), never a target. */
  async freePort(port, ms = 8000) {
    const end = Date.now() + ms;
    while (listeners(port).length && Date.now() < end) await sleep(100);
    const left = listeners(port);
    if (!left.length) return;
    const foreign = left.filter(p => !this.isOurs(p));
    if (foreign.length)
      throw new Error(
        `port ${port} is held by ${foreign.map(p => p ?? 'a process whose pid is not visible').join(', ')}, which this run did not start: left alone`,
      );
    for (const pid of left) this.killOurs(pid, 'SIGKILL');
    await sleep(300);
    if (listeners(port).length) throw new Error(`port ${port} is still in use after its process was killed`);
  }

  async cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const child of this.procs) if (child.pid) killTree(child.pid, 'SIGTERM');
    await sleep(800);
    for (const child of this.procs) if (child.pid) killTree(child.pid, 'SIGKILL');
    // a broken ss must not stop the rest of the cleanup
    const holders = port => {
      try {
        return listeners(port);
      } catch (e) {
        this.log(`WARNING: ${e.message}`);
        return [];
      }
    };
    for (const port of this.ports) for (const pid of holders(port)) if (this.isOurs(pid)) this.killOurs(pid, 'SIGKILL');
    await sleep(300);
    const left = this.ports.filter(p => holders(p).length);
    this.log(left.length ? `WARNING: ports still in use: ${left} (a process this run did not start is never signalled)` : 'all processes stopped, ports free');
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(sig, this.onSignal);
  }
}
