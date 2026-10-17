#!/usr/bin/env node
/* Fault-injection HTTP proxy for sync-failure testing. No dependencies.

     node proxy.mjs [--listen 127.0.0.1:8091] [--target 127.0.0.1:8095] [--log proxy.log.jsonl]

   Control endpoint (served by the proxy itself, never forwarded):
     GET /__fault               -> {"mode":"ok","since":<ms epoch>}   (also the readiness probe)
     GET /__fault?mode=ok       -> pass everything through (the /api/realtime SSE stream is piped, not buffered)
     GET /__fault?mode=5xx      -> every /api/* request answers HTTP 500 with a PocketBase-style JSON body; open SSE streams are cut
     GET /__fault?mode=down     -> every connection is destroyed without an answer; open SSE streams are cut

   Log: one JSON object per line, appended synchronously (readable while the run is going):
     {"ms":1700000000000,"t":"2026-..Z","method":"PATCH","path":"/api/collections/tasks/records/abc","status":200,"mode":"ok"}
     {"ms":..., "event":"mode","mode":"5xx"}            <- marker for every mode switch (t=0 of a fault)
     {"ms":..., "event":"sse-open"|"sse-close", ...}    <- realtime stream lifecycle ("sse-close" carries how it ended)
   A request is logged when its answer is complete (an SSE stream when its headers are out); status 0 means no answer
   (dropped by mode "down", or the connection broke). */
import http from 'node:http';
import fs from 'node:fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const [LHOST, LPORT] = arg('listen', '127.0.0.1:8091').split(':');
const [THOST, TPORT] = arg('target', '127.0.0.1:8095').split(':');
const LOG = arg('log', 'proxy.log.jsonl');

const MODES = new Set(['ok', '5xx', 'down']);
let mode = 'ok';
let since = Date.now();
const sse = new Set(); // { req: upstream ClientRequest, res: client ServerResponse }

const BODY_500 = JSON.stringify({ status: 500, message: 'Something went wrong while processing your request.', data: {} });

function log(entry) {
  const ms = Date.now();
  fs.appendFileSync(LOG, JSON.stringify({ ms, t: new Date(ms).toISOString(), ...entry }) + '\n');
}

function cutStreams(why) {
  for (const s of [...sse]) {
    s.why = why;
    s.req.destroy();
    s.res.destroy();
  }
}

function setMode(next) {
  mode = next;
  since = Date.now();
  log({ event: 'mode', mode });
  if (mode !== 'ok') cutStreams(`cut by mode ${mode}`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = req.url.split('#')[0];

  if (url.pathname === '/__fault') {
    const want = url.searchParams.get('mode');
    if (want !== null && !MODES.has(want)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `unknown mode ${want}`, modes: [...MODES] }));
      return;
    }
    if (want !== null) setMode(want);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ mode, since }));
    return;
  }

  if (mode === 'down') {
    log({ method: req.method, path, status: 0, mode, note: 'dropped' });
    req.socket.destroy();
    return;
  }

  if (mode === '5xx' && url.pathname.startsWith('/api/')) {
    req.resume();
    res.writeHead(500, { 'content-type': 'application/json; charset=UTF-8', 'content-length': Buffer.byteLength(BODY_500) });
    res.end(BODY_500);
    log({ method: req.method, path, status: 500, mode, note: 'injected' });
    return;
  }

  // pass through
  const isSse = url.pathname === '/api/realtime' && req.method === 'GET';
  const headers = { ...req.headers, host: `${THOST}:${TPORT}` };
  const up = http.request({ host: THOST, port: Number(TPORT), method: req.method, path: req.url, headers }, upRes => {
    res.writeHead(upRes.statusCode, upRes.headers);
    if (isSse) {
      res.flushHeaders();
      res.socket?.setNoDelay(true);
      const entry = { req: up, res };
      sse.add(entry);
      log({ event: 'sse-open', method: req.method, path, status: upRes.statusCode, mode });
      const closed = how => {
        if (!sse.delete(entry)) return;
        log({ event: 'sse-close', path, how: entry.why || how });
      };
      res.on('close', () => {
        closed('client closed');
        up.destroy(); // the page is gone: do not leave its stream open on PocketBase
      });
      upRes.on('end', () => closed('upstream ended'));
      upRes.on('error', () => closed('upstream error'));
      upRes.pipe(res);
    } else {
      upRes.pipe(res);
      upRes.on('end', () => log({ method: req.method, path, status: upRes.statusCode, mode }));
      upRes.on('error', err => {
        log({ method: req.method, path, status: 0, mode, note: `upstream error: ${err.code || err.message}` });
        res.destroy(); // a body cut short must not leave the client waiting
      });
    }
  });
  up.on('error', err => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 502, message: `proxy: ${err.message}`, data: {} }));
    } else res.destroy();
    if (!isSse) log({ method: req.method, path, status: 0, mode, note: `upstream error: ${err.code || err.message}` });
  });
  res.on('close', () => {
    if (!res.writableEnded && !isSse) up.destroy();
  });
  req.pipe(up);
});

server.keepAliveTimeout = 0;
server.listen(Number(LPORT), LHOST, () => {
  fs.appendFileSync(
    LOG,
    JSON.stringify({ ms: Date.now(), t: new Date().toISOString(), event: 'proxy-start', listen: `${LHOST}:${LPORT}`, target: `${THOST}:${TPORT}` }) + '\n',
  );
  console.log(`fault proxy on http://${LHOST}:${LPORT} -> http://${THOST}:${TPORT}, log ${LOG}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
