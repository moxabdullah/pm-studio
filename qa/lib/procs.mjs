/* Process management for the kits: start things detached with their output in a log file, and stop all of them again, whatever
   happens (normal end, failure, Ctrl+C, SIGTERM). A Stack only ever signals processes it started itself and, for its ports, only
   after it has checked they were free when it began. */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function listeners(port) {
  const r = spawnSync('ss', ['-ltnHp', `sport = :${port}`], { encoding: 'utf8' });
  return [...(r.stdout || '').matchAll(/pid=(\d+)/g)].map(m => Number(m[1]));
}

// the process group first (npx vite has children), then the process itself
export function killTree(pid, sig) {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, sig);
      return;
    } catch {
      // not that kind of target, or already gone
    }
  }
}

export async function waitHttp(url, what, ms, child) {
  const end = Date.now() + ms;
  for (;;) {
    if (child && child.exitCode !== null) throw new Error(`${what} exited with code ${child.exitCode} before it was ready`);
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
    this.cleaned = false;
    this.owned = false;
    this.onSignal = async sig => {
      this.log(`${sig}: stopping everything`);
      await this.cleanup();
      process.exit(130);
    };
  }

  /* Refuses to start (exit code 3) when one of the ports is already in use: it belongs to a stranger and is left alone. */
  claimPorts() {
    const busy = this.ports.filter(p => listeners(p).length);
    if (busy.length) {
      this.cleaned = true; // nothing of ours is running: never sweep a stranger's processes
      console.error(`ports already in use: ${busy}. Stop whatever holds them or choose other ports (PB_PORT, VITE_PORT, PROXY_PORT).`);
      process.exit(3);
    }
    this.owned = true;
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, this.onSignal);
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
    this.log(`started ${name} (pid ${child.pid})`);
    return child;
  }

  async stopOne(child, grace = 4000) {
    if (!child.pid || child.exitCode !== null) return;
    killTree(child.pid, 'SIGTERM');
    const end = Date.now() + grace;
    while (child.exitCode === null && Date.now() < end) await sleep(100);
    killTree(child.pid, 'SIGKILL');
    this.procs.delete(child);
  }

  async freePort(port, ms = 8000) {
    const end = Date.now() + ms;
    while (listeners(port).length && Date.now() < end) await sleep(100);
    if (listeners(port).length && this.owned) for (const pid of listeners(port)) killTree(pid, 'SIGKILL');
  }

  async cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const child of this.procs) if (child.pid) killTree(child.pid, 'SIGTERM');
    await sleep(800);
    for (const child of this.procs) if (child.pid) killTree(child.pid, 'SIGKILL');
    if (this.owned) for (const port of this.ports) for (const pid of listeners(port)) killTree(pid, 'SIGKILL');
    await sleep(300);
    const left = this.ports.filter(p => listeners(p).length);
    this.log(left.length ? `WARNING: ports still in use: ${left}` : 'all processes stopped, ports free');
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(sig, this.onSignal);
  }
}
