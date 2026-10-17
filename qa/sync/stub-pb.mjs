// In-memory stand-in for src/core/pb.js: a fake server whose requests can be made to fail with a 5xx.
export const server = {
  down: 0,
  db: {},
  calls: 0,
  writes: [],
  rule: null,
  hold: {},
  log: [],
  patches: false,
  sent: [],
  subs: {},
  reads: [],
  notFound: 0,
  say: '',
};
// say: the message of the errors, when set. reads: every read of one record by id, as { via: 'getOne' | 'getList', c, id }; notFound: how many getOne() reads answered 404 (the browser logs each one).
// patches: apply docPatch/docUnset to the stored doc and answer with the X-Doc-Patch header, like server/pb_hooks/doc_patch.pb.js. sent: the fields of every update.
// subs: the live-event callbacks by collection; emit(coll, action, record) delivers one.
server.emit = (c, action, record) => {
  for (const cb of server.subs[c] || []) cb({ action, record });
};
// `rule(kind, coll, id)` (kind: read, create, update, delete, health, stream, send) may answer a status for one request (e.g. 400 for one record); else `down` applies to everything.
const fail = (kind = 'read', c = '', id = '') => {
  server.calls++;
  if (kind === 'create' || kind === 'update' || kind === 'delete') server.writes.push({ t: Date.now(), kind, c, id });
  const status = server.rule?.(kind, c, id) || server.down;
  if (status) throw Object.assign(new Error('boom'), { status, response: { message: server.say || (status >= 500 ? 'Server error' : 'Bad value') } });
};
const nf = () => Object.assign(new Error('nf'), { status: 404, response: { message: 'not found' } });
let ts = 1000;
export const authStore = { record: { id: 'u1' }, isValid: true, onChange() {}, clear() {} };
const coll = name => {
  const t = () => (server.db[name] ||= new Map());
  return {
    async getFullList() {
      fail('read', name);
      if (server.hold[name]) {
        server.log.push('hold ' + name);
        await server.hold[name];
        server.log.push('landed ' + name);
      }
      return [...t().values()];
    },
    // A filter of the form `id = "x"` (what pb.filter('id = {:id}', { id }) makes here) answers the record with that id, or no items: 200 either way, like the server.
    async getList(page, perPage, options) {
      const id = /^id = ("(?:[^"\\]|\\.)*")$/.test(options?.filter || '') ? JSON.parse(options.filter.slice(5)) : undefined;
      fail('read', name, id);
      if (id !== undefined) {
        server.reads.push({ via: 'getList', c: name, id });
        return { items: t().has(id) ? [t().get(id)] : [] };
      }
      if (server.hold[name]) await server.hold[name];
      return { items: [...t().values()] };
    },
    async getOne(id) {
      fail('read', name, id);
      server.reads.push({ via: 'getOne', c: name, id });
      if (!t().has(id)) {
        server.notFound++;
        throw nf();
      }
      return t().get(id);
    },
    async create(p) {
      fail('create', name, p.id);
      const r = { ...p, updated: String(++ts) };
      t().set(p.id, r);
      return r;
    },
    async update(id, f, options) {
      fail('update', name, id);
      server.sent.push({ c: name, id, f });
      const r = { ...t().get(id), ...f, updated: String(++ts) };
      delete r.docPatch;
      delete r.docUnset;
      if (server.patches) {
        if (f.doc === undefined) {
          r.doc = { ...t().get(id).doc, ...f.docPatch };
          for (const k of f.docUnset || []) delete r.doc[k];
        }
        if (options?.fetch) {
          const real = globalThis.fetch;
          globalThis.fetch = async () => ({ headers: { get: h => (h === 'X-Doc-Patch' ? 'yes' : null) } });
          try {
            await options.fetch('', {});
          } finally {
            globalThis.fetch = real;
          }
        }
      }
      t().set(id, r);
      return r;
    },
    async delete(id) {
      fail('delete', name, id);
      if (!t().delete(id)) throw nf();
    },
    async subscribe(topic, cb) {
      fail('stream', name);
      (server.subs[name] ||= []).push(cb);
    },
    async unsubscribe() {},
    async authRefresh() {
      fail();
    },
  };
};
export const pb = {
  collection: coll,
  health: {
    async check() {
      fail('health');
    },
  },
  realtime: {
    onDisconnect: null,
    isConnected: true,
    async unsubscribe() {
      server.subs = {};
    },
    disconnect() {},
    async subscribe() {},
  },
  filter: (s, params = {}) => s.replace(/\{:(\w+)\}/g, (_, k) => JSON.stringify(params[k])),
  authStore,
  async send() {
    fail('send');
  },
};

// (V2) the other exports of src/core/pb.js, so the pages and actions can be imported
export const setRemember = () => {};
export const fileUrl = async () => '';
