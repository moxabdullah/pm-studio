/* ---------- sync: the server behind S.data ----------
   S.data stays the in-memory model; this module loads it from PocketBase, sends every change back, and applies other people's
   changes as they happen. It knows nothing about the DOM: the app binds it to the UI once at boot with bindSync().

   Exports
     bindSync({ render, toast, loggedOut })
                    Connects the engine to the UI. render() is called after the engine changed S.data (it should coalesce and must not
                    destroy what the user is typing, see src/shell/remote-render.js), toast(msg, opts) shows a toast, and
                    loggedOut(message) shows the sign-in page after the session ended.
     startSync({ boot })
                    Call once the PocketBase auth store holds a valid session. Loads everything the user may read, builds S.data,
                    applies the user's saved preferences, and subscribes to live updates. Rejects when the load fails (a
                    ClientResponseError; check .status). With boot: true it first refreshes the stored session and, while the server
                    cannot be reached, shows the offline state and keeps trying; it only rejects for a session the server refuses.
     stopSync({ flush })
                    Ends the session's sync: unsubscribes, stops every timer, forgets what was loaded. With flush: true it first sends
                    any unsaved change (when online). Sign-out calls this; it does not touch the auth store or S.data.
     flush()        Sends what differs between S.data and the server's copy. store.js save() calls it 150 ms after the last change.
                    Runs one at a time; a call during a run makes it go round once more. Resolves true when nothing was left behind.
     retryNow()     Tries to leave the offline state right now (flush, reload, resubscribe). Resolves true when back online. Wired to
                    the "Try again" button and the offline toast.
     adopt(key, record)
                    Puts a record the caller already created on the server (a file upload, say) into S.data and the sync baseline
                    without sending it again. `key` is the app key or collection name ('files'), `record` the raw PocketBase record
                    the create call returned. Returns the app object (an existing one if the live update arrived first). The caller
                    renders. Idempotent.
     snapshotState() / restoreState(token)
                    Undo support behind actions.js snapshot()/restore(): the token is opaque; restoring puts S.data back as it was and
                    then re-applies the changes other people made since, so Undo never reverts their work. restoreState() returns
                    false (and does nothing) when the session was restarted since the snapshot.
     pendingChanges()  Number of record creates, updates and deletes the server has not confirmed (settings in user_prefs not counted).
     hasUnsaved()   pendingChanges() > 0 or a flush in progress.
     stats          Counters and timings of the last flush, for diagnosis.

   Model
     base      What the server is known to hold, per collection: Map(id -> { p, s, u }): p the canonical payload (sync-map's
               toRecord() of the app object, so "has this record changed" is one string compare), s its stable string, u the
               record's `updated` time. It only ever advances to a state the server confirmed (a load, a live update, or the answer
               to our own request), never to what we merely sent. So while a write is in flight it still shows what the server had,
               and the user's edit is still recognisably "mine" if someone else's change to the same record arrives meanwhile.
     flush     Diffs S.data against base and sends creates and updates (only the top-level fields that changed; `doc` as a whole)
               together, a create that needs a parent created in the same flush after it, then deletes. A 404 on delete counts as
               done. The server's answer to each create and update is applied like a live update. Network failure -> offline.
               401 -> sign-in page. Any other 4xx -> one toast, and the server's version of the record replaces the local one (so
               a rejected change is never sent again).
     live      One subscription per collection. An event is dropped when it is older than base (by `updated`: a late echo of an
               earlier write) or equal to it (our own echo). Otherwise it is merged per top-level field and per top-level `doc` key
               (3-way against base): fields with an unsent local edit keep the local value, the rest take the remote one. The
               object is patched in place.
     offline   Entered when a request cannot reach the server (or a proxy answers 502-504), or the live stream stays down and the
               server does not answer a health check. Polls every 3 s and on the SDK's reconnect. Recovery: reload by merging (not
               replacing, so nothing typed meanwhile is lost), then send what is unsent (built on the fresh copy, so it does not
               overwrite other people's changes to the same record), then start a new stream.
     journal   The last minute of remote changes that were applied to S.data, for restoreState(). */
import { authStore, pb } from './pb.js';
import {
  COLLECTIONS,
  USER_PREFS,
  applyFavs,
  applyUserPrefs,
  buildUserPrefs,
  fromRecord,
  keyOf,
  projOrderFrom,
  stableStringify,
  toRecord,
  toRecords,
  wsFromWorkspace,
} from './sync-map.js';
import { D, S, emptyData, save } from './store.js';
import { uid } from './utils.js';

/* ---------- state ---------- */
const hooks = { render() {}, toast() {}, loggedOut() {} };
export function bindSync(h) {
  Object.assign(hooks, h);
}

const st = {
  active: false, // between startSync and stopSync
  ready: false, // the first load has been installed
  stopping: false,
  broken: false, // the last flush failed on a bug (not a server answer) and the user has been told
  gen: 0, // bumps on every start and stop: work begun under an older value gives up quietly
  me: '', // the signed-in user's id
  offline: false,
  flushing: null, // promise of the running flush
  again: false, // a flush was asked for while one ran
  busy: null, // promise of the running recovery or reload
  reloading: false, // a full reload is merging in: skip per-record follow-up fetches
  queue: [], // live events that arrived while the first load was in flight
  prefsId: '', // id for the user_prefs record this user does not have yet
  pollT: 0,
  netT: 0,
  graceT: 0,
  rtDown: false, // the live stream dropped and has not come back
  hiddenAt: 0,
  wake: null, // lets retryNow() cut a boot-time wait short
};
export const stats = { flushes: 0, lastDiffMs: 0, lastFlushMs: 0, lastOps: 0, received: 0, log: [] };
const DEV = !!import.meta.env?.DEV;

const same = (a, b) => stableStringify(a) === stableStringify(b);
/* A baseline entry: the payload p, its key-sorted string s, a plain string j of how the app builds it (see differs()), and u. */
const entryOf = (p, u = '') => ({ p, s: stableStringify(p), j: JSON.stringify(p), u });
/* Does the app's payload `p` differ from baseline entry `b`? The plain JSON string says "no" cheaply (the same payload built the same
   way gives the same string, and this is the usual answer for almost every record on every flush). Only when it differs is the
   key-sorted comparison made, which is authoritative (PocketBase returns keys sorted, the app does not), and its "same" is remembered. */
function differs(p, b) {
  const j = JSON.stringify(p);
  if (j === b.j) return false;
  if (stableStringify(p) !== b.s) return true;
  b.j = j;
  return false;
}
const FRONT = new Set(['activity', 'notifs', 'files']); // lists the app keeps newest first
const CAPS = { activity: 1000, notifs: 500 }; // collections of which only the newest are loaded
const find = (key, id) => D()[key].find(x => x.id === id);

/* What a failed request means: 'network' (the server cannot be reached; a proxy answering 502-504 counts), 'auth' (the session is
   no good), 'abort', or 'rejected' (the server understood and said no). */
function classify(err) {
  if (err?.isAbort) return 'abort';
  const s = err?.status;
  if (s === 0 || s === 502 || s === 503 || s === 504) return 'network';
  if (s === 401) return 'auth';
  return 'rejected';
}
function describe(err) {
  const r = err?.response || {};
  const [field, detail] = (r.data && Object.entries(r.data)[0]) || [];
  return `${r.message || err?.message || 'Unknown error'}${field ? ` (${field}: ${detail?.message || detail})` : ''}`;
}

/* ---------- the baseline: what the server is known to hold ---------- */
let base = new Map();
function resetBase() {
  base = new Map([...COLLECTIONS.map(c => c.key), USER_PREFS].map(k => [k, new Map()]));
}
resetBase();
/* Records we are deleting or deleted a moment ago. An older update of one that is still on its way over the live stream must not
   bring it back, and the server's report of the delete (and of the rows it removed along with it) is our own echo. */
const deleted = new Map();
const DELETED_MS = 10000;
const wasDeleted = (key, id) => Date.now() - (deleted.get(`${key}/${id}`) || 0) < DELETED_MS;
/* A delete event that our own delete caused: the record itself, or a row that hangs off it (a task's comments, a project's tasks). */
const ownDelete = (key, id, b) => wasDeleted(key, id) || (!!b && (wasDeleted('tasks', b.p.task) || wasDeleted('projects', b.p.project)));

/* ---------- payloads ---------- */
/* The canonical payload of a server record, comparable with what toRecords() makes of the app's own objects. */
const canon = (key, rec) => toRecord(key, fromRecord(key, rec), { me: st.me, order: rec.order });
/* The `order` to write for each project, as Map(id -> value). D().projOrder ranks only the projects this user can see, but the
   server's column ranks all of them (a member does not see a private project), so the position in that list cannot be the value:
   it would collide with the hidden ones. The server's own values are kept and handed out in the local order, so moving a project
   swaps two values and rewrites nothing else, and a project the server has not seen yet gets a value between its neighbours. */
function projectOrders() {
  const known = base.get('projects');
  const have = new Set(D().projects.map(p => p.id));
  const ids = [
    ...D().projOrder.filter(id => have.has(id)),
    ...D()
      .projects.map(p => p.id)
      .filter(id => !D().projOrder.includes(id)),
  ];
  const sorted = ids
    .filter(id => known.has(id))
    .map(id => known.get(id).p.order)
    .sort((a, b) => a - b);
  const out = new Map();
  let k = 0;
  for (const id of ids) if (known.has(id)) out.set(id, sorted[k++]);
  for (let i = 0; i < ids.length;) {
    if (out.has(ids[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < ids.length && !out.has(ids[j])) j++;
    const lo = i > 0 ? out.get(ids[i - 1]) : undefined;
    const hi = j < ids.length ? out.get(ids[j]) : undefined;
    for (let x = 0; x < j - i; x++) {
      if (lo === undefined) out.set(ids[i + x], hi === undefined ? x : hi - (j - i) + x);
      else out.set(ids[i + x], hi === undefined ? lo + x + 1 : lo + ((hi - lo) * (x + 1)) / (j - i + 1));
    }
    i = j;
  }
  return out;
}
/* The payload of one live app object. */
function payloadOf(key, obj) {
  return toRecord(key, obj, { me: D().me, order: key === 'projects' ? projectOrders().get(obj.id) : undefined });
}
/* The top-level fields of `after` that differ from `before`. */
function changedFields(before, after) {
  const out = {};
  for (const f of Object.keys(after)) if (f !== 'id' && !same(after[f], before[f])) out[f] = after[f];
  return out;
}
/* The user_prefs payload the app would write now. */
const prefsPayload = id => toRecord(USER_PREFS, buildUserPrefs(S, id), { me: D().me });
const prefsEntry = () => base.get(USER_PREFS).values().next().value;
const favSet = key => new Set(prefsEntry()?.p.doc?.favs?.[key] || []);

/* ---------- merging ---------- */
/* Three-way merge of two versions of a record against the version both started from, field by field: columns, and the top-level
   keys of `doc`. A field that `mine` still has as `b` had has no unsent edit, so `theirs` wins; a field I changed stays mine. */
function merge3(b, mine, theirs) {
  const out = { id: theirs.id };
  for (const f of Object.keys(theirs)) if (f !== 'id' && f !== 'doc') out[f] = same(mine[f], b[f]) ? theirs[f] : mine[f];
  const bd = b.doc || {};
  const md = mine.doc || {};
  const td = theirs.doc || {};
  out.doc = {};
  for (const k of new Set([...Object.keys(bd), ...Object.keys(md), ...Object.keys(td)])) {
    const v = same(md[k], bd[k]) ? td[k] : md[k];
    if (v !== undefined) out.doc[k] = v;
  }
  return out;
}
/* What changed between two versions (`before` -> `after`), put on top of `mine`. Used to replay remote changes onto restored data. */
function applyDelta(mine, before, after) {
  const out = { ...mine, doc: { ...mine.doc } };
  for (const f of Object.keys(after)) if (f !== 'id' && f !== 'doc' && !same(after[f], before[f])) out[f] = after[f];
  const bd = before.doc || {};
  const ad = after.doc || {};
  for (const k of new Set([...Object.keys(bd), ...Object.keys(ad)])) {
    if (same(ad[k], bd[k])) continue;
    if (ad[k] === undefined) delete out.doc[k];
    else out.doc[k] = ad[k];
  }
  return out;
}
/* Writes a payload into the live object, in place so references to it stay valid. `rec` supplies what payloads leave out (a user's
   email, a file's stored name); `mine` is the object's payload before, to see which doc keys went away. Per-user fields (fav) stay. */
function patchObject(key, obj, payload, rec, mine) {
  const next = fromRecord(key, { ...rec, ...payload });
  for (const k of Object.keys(mine.doc)) if (!(k in payload.doc)) delete obj[k];
  for (const [k, v] of Object.entries(next)) if (!same(obj[k], v)) obj[k] = v;
}

/* ---------- applying server records to S.data ---------- */
/* Project order lives in D().projOrder. The server's order is what base says; a user's own unsent re-order is kept. `before` is the
   server order from before the change that is being applied. */
const serverOrder = () => projOrderFrom([...base.get('projects').values()].map(e => e.p));
function reorderProjects(before) {
  const have = new Set(D().projects.map(p => p.id));
  const was = before.filter(id => have.has(id));
  const mine = D().projOrder.filter(id => have.has(id));
  const after = serverOrder().filter(id => have.has(id));
  if (mine.length === was.length && mine.every((id, i) => id === was[i])) D().projOrder = after;
  else D().projOrder = [...mine, ...after.filter(id => !mine.includes(id))];
}
function insertObject(key, obj) {
  const list = D()[key];
  if (FRONT.has(key)) list.unshift(obj);
  else list.push(obj);
  if (key === 'projects' || key === 'tasks') obj.fav = favSet(key).has(obj.id);
}
/* D().ws mirrors the current workspace's entry in D().workspaces (and falls back to the first one). */
function refreshWs() {
  const d = D();
  const w = d.workspaces.find(x => x.id === d.ws.id) || d.workspaces[0];
  const next = w && wsFromWorkspace(w);
  if (next && !same(d.ws, next)) d.ws = next;
}
/* Whatever the view held about something that is gone. */
function forgetUi(key, id) {
  const u = S.ui;
  if (key !== 'tasks') return;
  u.sel.delete(id);
  if (u.drawer === id) {
    u.drawer = null;
    u.drawerFull = false;
    u.subOpen = null;
  }
  if (u.editCell?.id === id) u.editCell = null;
  if (u.pop?.id === id) u.pop = null;
}

/* Applies one server record (a live update, a reload, or the answer to one of our own requests). Returns true when S.data changed.
   `force` takes the server's version even over unsent local edits (used after the server rejected ours). */
function applyRecord(key, rec, force = false) {
  if (key === USER_PREFS) return applyPrefsRecord(rec, force);
  const known = base.get(key);
  const b = known.get(rec.id);
  if (!force && b && rec.updated && rec.updated < b.u) return false; // older than what is known: a late echo of an earlier write
  const theirs = canon(key, rec);
  const s = stableStringify(theirs);
  if (!force && b && b.s === s) {
    if (rec.updated > b.u) b.u = rec.updated;
    return false; // nothing new: our own write coming back
  }
  const obj = find(key, rec.id);
  if (!obj && !b && !force && wasDeleted(key, rec.id)) return false; // news about something we have just deleted
  const before = key === 'projects' ? serverOrder() : null;
  const mine = obj ? payloadOf(key, obj) : null; // before the baseline moves on
  known.set(rec.id, entryOf(theirs, rec.updated));
  let changed = false;
  if (!obj) {
    // Unknown here: new, or it just became visible. (With a base entry but no object, the user deleted it and the delete is
    // not confirmed yet: it stays deleted.)
    if (!b || force) {
      insertObject(key, fromRecord(key, rec));
      journalAdd({ key, id: rec.id, action: 'create', rec });
      changed = true;
      if (key === 'projects' && st.ready && !st.reloading) adoptChildren(rec.id);
    }
  } else {
    const merged = force ? theirs : b ? merge3(b.p, mine, theirs) : mine;
    changed = !same(merged, mine);
    if (changed) {
      patchObject(key, obj, merged, rec, mine);
      if (!force) journalAdd({ key, id: rec.id, action: 'update', before: mine, after: merged, rec });
    }
    if (!same(merged, theirs)) save(); // unsent local edits remain: make sure they go out
  }
  if (key === 'projects') reorderProjects(before);
  if (key === 'workspaces') refreshWs();
  return changed;
}
/* The user's own settings, edited in another tab of theirs: merged like any record, then applied to the store. */
function applyPrefsRecord(rec, force) {
  const known = base.get(USER_PREFS);
  const b = known.get(rec.id);
  if (!force && b && rec.updated && rec.updated < b.u) return false;
  const theirs = toRecord(USER_PREFS, fromRecord(USER_PREFS, rec), { me: st.me });
  const s = stableStringify(theirs);
  if (!force && b && b.s === s) return false;
  const mine = prefsPayload(rec.id);
  const merged = force ? theirs : b ? merge3(b.p, mine, theirs) : mine;
  known.set(rec.id, entryOf(theirs, rec.updated));
  const changed = !same(merged, mine);
  if (changed) applyUserPrefs(S, { id: rec.id, ...merged.doc });
  if (!same(merged, theirs)) save();
  return changed;
}
/* Removes a record the server no longer has. `local` also removes an object the server never knew (after it refused it). */
function removeRecord(key, id, local = false) {
  const known = base.get(key);
  const b = known.get(id);
  const before = key === 'projects' ? serverOrder() : null;
  if (!known.delete(id) && !local) return false; // not something the server told us about: an unsent create of ours, or already gone
  const list = D()[key];
  const i = list.findIndex(x => x.id === id);
  if (i >= 0) list.splice(i, 1);
  if (!ownDelete(key, id, b)) journalAdd({ key, id, action: 'delete' });
  forgetUi(key, id);
  if (key === 'projects') reorderProjects(before);
  if (key === 'workspaces') refreshWs();
  return true;
}
/* A project that was not visible before (the user was just added to a private one) arrives without its tasks and the rest. */
async function adoptChildren(pid) {
  const gen = st.gen;
  const parts = [
    ['tasks', 'tasks', 'project = {:id}'],
    ['comments', 'comments', 'task.project = {:id}'],
    ['activity', 'activity', 'project = {:id}'],
    ['files', 'files', 'project = {:id}'],
    ['events', 'events', 'project = {:id}'],
    ['savedViews', 'saved_views', 'project = {:id}'],
  ];
  try {
    const found = await Promise.all(parts.map(([, coll, filter]) => pb.collection(coll).getFullList({ batch: 500, filter: pb.filter(filter, { id: pid }) })));
    if (gen !== st.gen) return;
    let changed = false;
    for (const [i, [key]] of parts.entries()) {
      for (const rec of found[i]) changed = applyRecord(key, rec) || changed;
    }
    if (changed) hooks.render();
  } catch (err) {
    if (classify(err) === 'network') goOffline();
  }
}

/* ---------- loading ---------- */
const byAtDesc = (a, b) => (b.at || 0) - (a.at || 0);
function sortLists(data) {
  data.activity.sort(byAtDesc);
  data.notifs.sort(byAtDesc);
  data.files.sort(byAtDesc);
  data.comments.sort((a, b) => (a.at || 0) - (b.at || 0));
  data.tasks.sort((a, b) => (a.order || 0) - (b.order || 0));
}
/* Every collection the user may read, in parallel, as { appKey: [records], user_prefs: [record] }. The activity feed and the
   notification list load only their newest entries. */
async function loadAll() {
  const full = coll => pb.collection(coll).getFullList({ batch: 500, sort: 'created,id' });
  const newest = (coll, n) =>
    pb
      .collection(coll)
      .getList(1, n, { sort: '-created,id', skipTotal: true })
      .then(r => r.items);
  const jobs = COLLECTIONS.map(({ key, coll }) => [key, CAPS[key] ? newest(coll, CAPS[key]) : full(coll)]);
  jobs.push([USER_PREFS, full(USER_PREFS)]);
  const done = await Promise.all(jobs.map(j => j[1]));
  return Object.fromEntries(jobs.map((j, i) => [j[0], done[i]]));
}
/* Builds S.data from the loaded records and takes them as the baseline (as payloads of the built objects, so the first save finds
   no difference), then applies the user's settings. */
function install(all) {
  const data = emptyData();
  data.me = st.me;
  resetBase();
  for (const { key } of COLLECTIONS) {
    const known = base.get(key);
    data[key] = all[key].map(rec => {
      const obj = fromRecord(key, rec);
      known.set(rec.id, entryOf(toRecord(key, obj, { me: st.me, order: rec.order }), rec.updated));
      return obj;
    });
  }
  data.projOrder = projOrderFrom(all.projects);
  sortLists(data);
  applyFavs(data, {});
  S.data = data;
  const rec = all[USER_PREFS][0];
  if (rec) applyUserPrefs(S, fromRecord(USER_PREFS, rec));
  refreshWs();
  if (rec) base.get(USER_PREFS).set(rec.id, entryOf(prefsPayload(rec.id), rec.updated));
}
/* Reloads everything and merges it in like a burst of live events: unsent local edits survive, new records appear, records the
   server no longer has go away. Returns true when S.data changed. */
async function resync() {
  const gen = st.gen;
  const all = await loadAll();
  if (gen !== st.gen) return false;
  st.reloading = true;
  try {
    let changed = false;
    for (const { key, coll } of COLLECTIONS) {
      const seen = new Set();
      for (const rec of all[key]) {
        seen.add(rec.id);
        changed = applyRecord(key, rec) || changed;
      }
      if (all[key].length >= (CAPS[key] || Infinity)) continue; // a capped list that filled up: what is missing may just be older
      // Missing from a complete load: gone, unless paging skipped it while records were being deleted. Ask before removing.
      const missing = [...base.get(key).keys()].filter(id => !seen.has(id));
      const gone = await Promise.all(missing.map(id => confirmGone(key, coll, id)));
      for (const [i, id] of missing.entries()) {
        if (gone[i]) changed = removeRecord(key, id) || changed;
      }
    }
    if (all[USER_PREFS][0]) changed = applyRecord(USER_PREFS, all[USER_PREFS][0]) || changed;
    if (changed) sortLists(D());
    return changed;
  } finally {
    st.reloading = false;
  }
}
async function confirmGone(key, coll, id) {
  try {
    applyRecord(key, await pb.collection(coll).getOne(id));
    return false;
  } catch (err) {
    if (err?.status === 404) return true;
    throw err;
  }
}

/* ---------- live updates ---------- */
async function subscribeAll() {
  pb.realtime.onDisconnect = onDisconnect;
  await pb.realtime.unsubscribe(); // drop what an earlier attempt left behind
  const colls = [...COLLECTIONS.map(c => c.coll), USER_PREFS];
  await Promise.all(colls.map(coll => pb.collection(coll).subscribe('*', e => onEvent(coll, e))));
  await pb.realtime.subscribe('PB_CONNECT', onConnect); // fires on every (re)connect
}
/* A new stream, for when the old one cannot be trusted. Never throws: the safety net tries again. */
async function resubscribe() {
  try {
    await subscribeAll();
  } catch (err) {
    console.warn('sync: live updates are not connected', err);
  }
}
function onEvent(coll, e) {
  if (!st.active || !e?.record) return;
  stats.received++;
  if (DEV) {
    stats.log.push(`${coll}:${e.action}:${e.record.id}`);
    if (stats.log.length > 500) stats.log.shift();
  }
  if (!st.ready) st.queue.push([coll, e]);
  else if (applyEvent(coll, e)) hooks.render();
}
function applyEvent(coll, { action, record }) {
  const key = coll === USER_PREFS ? USER_PREFS : keyOf(coll);
  if (!key) return false;
  try {
    if (action !== 'delete') return applyRecord(key, record);
    if (key !== USER_PREFS) return removeRecord(key, record.id);
    base.get(USER_PREFS).delete(record.id); // the next flush creates a fresh one
    return false;
  } catch (err) {
    console.error('sync: could not apply a live update', coll, action, err);
    return false;
  }
}
/* The SDK reports every close of the stream, including the one PocketBase makes itself after 5 idle minutes (it reconnects within a
   fraction of a second). Only a stream that stays down, with a server that does not answer, means offline. */
function onDisconnect(subs) {
  if (!st.ready || st.offline || !subs.length) return; // an unsubscribe of ours reports an empty list
  st.rtDown = true;
  clearTimeout(st.graceT);
  st.graceT = setTimeout(async () => {
    if (!st.rtDown || !st.ready) return;
    try {
      await ping();
    } catch (err) {
      if (['network', 'abort'].includes(classify(err))) goOffline();
    }
  }, 2000);
}
function onConnect() {
  if (!st.ready) return;
  clearTimeout(st.graceT);
  const wasDown = st.rtDown;
  st.rtDown = false;
  if (st.offline) recover();
  else if (wasDown) quietResync(); // events may have been missed while the stream was down
}

/* ---------- sending changes ---------- */
/* What differs between S.data and base: { creates, updates, deletes, prefs }, each op { type, key, coll, id, ... }. */
function computeDiff() {
  const creates = [];
  const updates = [];
  const deletes = [];
  for (const { key, coll, updateOnly } of COLLECTIONS) {
    const known = base.get(key);
    const seen = new Set();
    const payloads = toRecords(key, D());
    if (key === 'projects') {
      const orders = projectOrders();
      for (const p of payloads) p.order = orders.get(p.id);
    }
    for (const p of payloads) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const b = known.get(p.id);
      if (!b) {
        if (!updateOnly) creates.push({ type: 'create', key, coll, id: p.id, payload: p });
      } else if (differs(p, b)) updates.push({ type: 'update', key, coll, id: p.id, fields: changedFields(b.p, p) });
    }
    if (!updateOnly) for (const id of known.keys()) if (!seen.has(id)) deletes.push({ type: 'delete', key, coll, id });
  }
  const cur = prefsEntry();
  const id = cur ? cur.p.id : st.prefsId || (st.prefsId = uid());
  const p = prefsPayload(id);
  let prefs = null;
  if (!cur) prefs = { type: 'create', key: USER_PREFS, coll: USER_PREFS, id, payload: p };
  else if (differs(p, cur)) prefs = { type: 'update', key: USER_PREFS, coll: USER_PREFS, id, fields: changedFields(cur.p, p) };
  return { creates, updates, deletes: deletes.reverse(), prefs };
}
export function pendingChanges() {
  if (!st.ready) return 0;
  const d = computeDiff();
  return d.creates.length + d.updates.length + d.deletes.length;
}
export const hasUnsaved = () => !!st.flushing || pendingChanges() > 0;
/* What pendingChanges() counts, one line per op ("update projects/p1 order"), settings included. For diagnosis. */
export function pendingDetails() {
  const d = computeDiff();
  return [...d.creates, ...d.updates, ...d.deletes, ...(d.prefs ? [d.prefs] : [])].map(
    o => `${o.type} ${o.key}/${o.id}${o.fields ? ' ' + Object.keys(o.fields).join(',') : ''}`,
  );
}

/* The ops in the rounds they go out in. Creates, updates and the user's settings go together, except that one that points at a
   record created in this same flush (a task in a new project, a comment on a new task) waits for it. Deletes go last: an update
   may move a child out of the record being deleted. Everything within a round is sent at once, so an ordinary save is one round
   trip, which also matters when the page is about to close (a round that has not started by then is never sent). Deletes need no
   order among themselves: deleting a parent removes its children on the server, and a child already gone counts as deleted. */
function rounds(diff) {
  const creating = new Set(diff.creates.map(op => op.id));
  const waitsFor = op => {
    const ids = [];
    for (const [field, value] of Object.entries(op.payload || op.fields)) if (field !== 'id' && field !== 'doc') ids.push(...[].concat(value));
    return ids.filter(id => creating.has(id) && id !== op.id);
  };
  const out = [];
  const done = new Set();
  let left = [...diff.creates, ...diff.updates, ...(diff.prefs ? [diff.prefs] : [])];
  while (left.length) {
    const ready = new Set(left.filter(op => waitsFor(op).every(id => done.has(id))));
    if (!ready.size) {
      out.push(left); // cannot happen (relations never loop), but never stall on it
      break;
    }
    out.push([...ready]);
    for (const op of ready) if (op.type === 'create') done.add(op.id);
    left = left.filter(op => !ready.has(op));
  }
  return [...out, diff.deletes];
}
/* The server accepted an op: its answer is the new baseline. An answer that carries more than what was sent (someone else's change
   to the same record got in first) is merged like a live update. Returns true when S.data changed. */
function settle(op, rec) {
  try {
    const mark = `${op.key}/${op.id}`;
    if (op.type === 'delete') {
      base.get(op.key).delete(op.id);
      deleted.set(mark, Date.now());
      return false;
    }
    deleted.delete(mark);
    return applyRecord(op.key, rec);
  } catch (err) {
    console.error("sync: could not apply the server's answer", err);
    return false;
  }
}
/* Sends one op. Never throws: resolves { op, status, changed } with status 'ok', 'network', 'auth', 'abort' or 'rejected'. */
async function sendOne(op, options) {
  const api = pb.collection(op.coll);
  let rec;
  if (op.type === 'delete') deleted.set(`${op.key}/${op.id}`, Date.now()); // its echo may beat the answer
  try {
    if (op.type === 'create') rec = await api.create(op.payload, options);
    else if (op.type === 'update') rec = await api.update(op.id, op.fields, options);
    else await api.delete(op.id, options);
  } catch (err) {
    if (op.type === 'delete' && err?.status === 404) return { op, status: 'ok', changed: settle(op) }; // already gone: a cascade got there first
    if (op.type === 'delete') deleted.delete(`${op.key}/${op.id}`);
    const status = classify(err);
    // An id (or a second user_prefs record) that already exists means an earlier attempt got through after all.
    const silent = status === 'rejected' && op.type === 'create' && !!(err.response?.data?.id || err.response?.data?.user);
    return { op, err, status, silent };
  }
  return { op, status: 'ok', changed: settle(op, rec) };
}
async function flushOnce(options, gen) {
  const t0 = performance.now();
  const diff = computeDiff();
  stats.lastDiffMs = performance.now() - t0;
  const phases = rounds(diff).filter(p => p.length);
  stats.lastOps = phases.reduce((n, p) => n + p.length, 0);
  if (!phases.length) return true;
  const rejected = [];
  let fatal = '';
  let changed = false;
  for (const phase of phases) {
    for (const r of await Promise.all(phase.map(op => sendOne(op, options)))) {
      changed = changed || !!r.changed;
      if (r.status === 'rejected') rejected.push(r);
      else if (r.status !== 'ok' && !fatal) fatal = r.status;
    }
    if (fatal || gen !== st.gen) break;
  }
  stats.lastFlushMs = performance.now() - t0;
  stats.flushes++;
  if (gen !== st.gen) return false;
  if (fatal === 'network') goOffline();
  else if (fatal === 'auth') expire();
  if (rejected.length) await refuse(rejected);
  else if (changed) hooks.render();
  return !fatal;
}
/* Sends what differs from the server's copy. Resolves true when nothing was left behind (rejected changes count as dealt with). */
export function flush(options = {}) {
  if (!st.ready) return Promise.resolve(true);
  if (st.offline && !options.recovering) return Promise.resolve(false);
  if (st.flushing) {
    st.again = true;
    return st.flushing;
  }
  const gen = st.gen;
  const request = options.keepalive ? { keepalive: true } : undefined; // lets the request finish while the page unloads
  const run = (async () => {
    for (const [k, t] of deleted) if (Date.now() - t > DELETED_MS) deleted.delete(k);
    let ok = true;
    try {
      do {
        st.again = false;
        ok = await flushOnce(request, gen);
      } while (st.again && ok && gen === st.gen);
      st.broken = false;
    } catch (err) {
      // A bug, not a server answer. Nothing was sent for this round, so say so (once) rather than lose changes in silence.
      console.error('sync: could not save', err);
      if (!st.broken) hooks.toast("Couldn't save your changes. Reload the page and try again.", { kind: 'err' });
      st.broken = true;
      ok = false;
    } finally {
      if (st.flushing === run) st.flushing = null;
    }
    return ok;
  })();
  st.flushing = run;
  return run;
}
/* The server refused some changes: say so once, and take its version of those records so the same change is never sent again. */
async function refuse(list) {
  const loud = list.filter(r => !r.silent);
  if (loud.length) {
    const more = loud.length > 1 ? ` (and ${loud.length - 1} more)` : '';
    hooks.toast(`Couldn't save: ${describe(loud[0].err)}${more}`, { kind: 'err', ms: 7000 });
  }
  await Promise.all(list.map(r => adoptServerTruth(r.op)));
  hooks.render();
}
async function adoptServerTruth({ key, coll, id }) {
  try {
    if (key === USER_PREFS) {
      const rec = (await pb.collection(coll).getFullList())[0];
      if (rec) applyRecord(key, rec, true);
      else base.get(key).clear(); // none exists: the next flush creates it
    } else applyRecord(key, await pb.collection(coll).getOne(id), true);
  } catch (err) {
    const kind = classify(err);
    if (err?.status === 404 && key !== USER_PREFS) {
      removeRecord(key, id, true); // gone, or not ours to see
    } else if (kind === 'network') goOffline();
    else if (kind === 'rejected') {
      // Cannot even read it back. Stop trying to send it rather than send it forever.
      const known = base.get(key);
      const obj = key === USER_PREFS ? { id } : find(key, id);
      if (!obj) known.delete(id);
      else known.set(id, entryOf(key === USER_PREFS ? prefsPayload(id) : payloadOf(key, obj)));
    }
  }
}

/* ---------- offline and recovery ---------- */
function setOffline(on) {
  if (st.offline === on) return;
  st.offline = on;
  S.ui.offline = on;
  clearInterval(st.pollT);
  st.pollT = on && st.ready ? setInterval(() => recover(), 3000) : 0;
  hooks.render();
}
function goOffline() {
  if (!st.ready || st.offline) return;
  setOffline(true);
  hooks.toast("Your changes couldn't be saved. You're offline.", { kind: 'err', action: 'Try again', onAction: retryNow, ms: 8000 });
}
/* One recovery or reload at a time. */
function exclusive(fn) {
  if (!st.busy) st.busy = fn().finally(() => (st.busy = null));
  return st.busy;
}
/* A request that must not hang the recovery loop if the server accepts connections but never answers. */
const ping = () => pb.health.check({ signal: AbortSignal.timeout(5000) });
/* Reacts to a failed reload. Returns 'offline' when the server cannot be reached, 'ended' when the session is over, else 'other'. */
function reloadFailure(err) {
  const kind = classify(err);
  if (kind === 'auth') {
    expire();
    return 'ended';
  }
  return kind === 'network' || kind === 'abort' ? 'offline' : 'other';
}
/* Leaves the offline state: the server answers, unsent changes are sent, everything is reloaded and merged, live updates are back. */
function recover() {
  return exclusive(async () => {
    const gen = st.gen;
    try {
      await ping();
      // Merge first, then send. The reload keeps unsent edits (it merges, it does not replace), and `doc` is written whole: sent
      // first, an edit built on a stale copy would overwrite what other people changed in the same record meanwhile.
      await resync();
      if (!(await flush({ recovering: true }))) return false;
      await resubscribe(); // after an outage the old stream may be dead without the browser knowing
    } catch (err) {
      if (reloadFailure(err) !== 'other') return false;
      // The server answers but refuses the reload. Staying offline would never end, so carry on with what is loaded.
      hooks.toast(`Couldn't reload your data: ${describe(err)}`, { kind: 'err' });
    }
    if (gen !== st.gen) return false;
    setOffline(false);
    hooks.toast('Reconnected. All changes are synced.');
    flush(); // whatever was edited while this ran
    return true;
  });
}
/* Reloads and merges, showing nothing unless the server turns out to be unreachable. */
async function reloadQuietly() {
  try {
    if (await resync()) hooks.render();
  } catch (err) {
    const failure = reloadFailure(err);
    if (failure === 'offline') goOffline();
    else if (failure === 'other') console.warn('sync: reload failed', err);
  }
}
/* After the live stream was down for a moment, events may have been missed. */
function quietResync() {
  if (!st.ready || st.offline || st.busy) return;
  exclusive(reloadQuietly);
}
export async function retryNow() {
  if (!st.active) return false;
  if (!st.ready) {
    st.wake?.(); // still waiting for the first load: try now
    return false;
  }
  if (!st.offline) return flush();
  const ok = await recover();
  if (!ok && st.offline) hooks.toast("Still can't reach the server. We'll keep trying.", { kind: 'err' });
  return ok;
}

/* ---------- start and stop ---------- */
export async function startSync({ boot = false } = {}) {
  if (st.active) await teardown();
  const gen = ++st.gen;
  Object.assign(st, { active: true, ready: false, me: authStore.record?.id || '', queue: [] });
  resetBase();
  const cancelled = () => Object.assign(new Error('sync stopped'), { cancelled: true });
  try {
    let all;
    while (!all) {
      try {
        if (boot) await pb.collection('users').authRefresh();
        [all] = await Promise.all([loadAll(), subscribeAll().catch(err => console.warn('sync: live updates are not connected', err))]);
      } catch (err) {
        if (!boot || classify(err) !== 'network') throw err;
        setOffline(true); // the server is down: show the offline bar and try again
        await new Promise(resolve => {
          st.wake = resolve;
          setTimeout(resolve, 3000);
        });
      }
      if (gen !== st.gen) throw cancelled();
    }
    install(all);
    st.ready = true;
    for (const [coll, e] of st.queue.splice(0)) applyEvent(coll, e); // events that arrived during the load
    setOffline(false);
    st.netT = setInterval(safetyNet, NET_MS);
    return true;
  } catch (err) {
    await teardown();
    throw err;
  }
}
export async function stopSync({ flush: send = false } = {}) {
  if (!st.active || st.stopping) return;
  st.stopping = true;
  try {
    if (send && st.ready && !st.offline) await flush();
  } finally {
    await teardown();
    st.stopping = false;
  }
}
async function teardown() {
  st.active = false;
  st.ready = false;
  st.gen++;
  clearInterval(st.pollT);
  clearInterval(st.netT);
  clearTimeout(st.graceT);
  Object.assign(st, {
    pollT: 0,
    netT: 0,
    graceT: 0,
    offline: false,
    flushing: null,
    again: false,
    busy: null,
    reloading: false,
    queue: [],
    prefsId: '',
    rtDown: false,
  });
  S.ui.offline = false;
  resetBase();
  deleted.clear();
  journal.length = 0;
  try {
    await pb.realtime.unsubscribe();
  } catch {
    /* the stream is already closed */
  }
}
/* The session ended without the user asking (expired, or signed out in another tab): back to the sign-in page. */
async function expire(message = 'Your session expired. Sign in again.') {
  if (!st.active || st.stopping) return;
  await stopSync();
  authStore.clear();
  hooks.loggedOut(message);
}
authStore.onChange(() => {
  // Another tab signed out, or signed in as somebody else: never keep writing as the wrong person.
  if (st.active && !st.stopping && (!authStore.isValid || authStore.record?.id !== st.me)) expire('Your session ended in another tab. Sign in again.');
});
/* Safety net, every 20 s. The live stream can die without anyone noticing (a server killed behind a proxy, a network that dropped):
   the browser keeps calling it open and no event ever arrives, so the page would go stale in silence. PocketBase forgets a stream's
   client id when it restarts, and answers 404 when asked to confirm the subscriptions of one it does not know. A stream that is
   not confirmed (or never connected, behind a proxy that buffers it) is replaced, and what was missed is reloaded. */
const NET_MS = 20000;
function safetyNet() {
  if (!st.ready || st.offline || st.busy) return;
  exclusive(async () => {
    const gen = st.gen;
    try {
      if (!pb.realtime.isConnected) throw Object.assign(new Error('no live stream'), { status: 404 });
      await pb.send('/api/realtime', { method: 'POST', body: { clientId: pb.realtime.clientId, subscriptions: pb.realtime.lastSentSubscriptions } });
    } catch (err) {
      const kind = classify(err);
      if (kind === 'network' || kind === 'abort') return goOffline();
      if (kind === 'auth') return expire();
      await resubscribe();
      if (gen === st.gen) await reloadQuietly();
    }
  });
}

/* Adds a record the caller created on the server itself. */
export function adopt(key, rec) {
  const k = keyOf(key) || key;
  if (k === USER_PREFS || !base.has(k)) throw new Error(`sync: cannot adopt into "${key}"`);
  applyRecord(k, rec);
  return find(k, rec.id);
}

/* ---------- undo across remote changes ---------- */
const JOURNAL_MS = 60000;
const journal = []; // { seq, at, key, id, action: 'create' | 'update' | 'delete', rec?, before?, after? }
let seq = 0;
function journalAdd(entry) {
  entry.seq = ++seq;
  entry.at = Date.now();
  journal.push(entry);
  while (journal.length && entry.at - journal[0].at > JOURNAL_MS) journal.shift();
}
export function snapshotState() {
  return { json: JSON.stringify(S.data), seq, gen: st.gen, at: Date.now() };
}
/* Puts one remote change onto restored data. An update carries what it changed (`before` -> `after`, both payloads of the object
   as it was when the change was applied), so it never undoes the parts of the record the user's Undo is putting back. */
function replay(e) {
  const list = D()[e.key];
  const obj = list.find(x => x.id === e.id);
  if (e.action === 'delete') {
    if (obj) list.splice(list.indexOf(obj), 1);
    forgetUi(e.key, e.id);
  } else if (!obj) insertObject(e.key, fromRecord(e.key, e.rec));
  else if (e.action === 'update') {
    const mine = payloadOf(e.key, obj);
    patchObject(e.key, obj, applyDelta(mine, e.before, e.after), e.rec, mine);
  }
}
export function restoreState(token) {
  // An older token could be missing journal entries that have already been dropped.
  if (!st.active || token.gen !== st.gen || Date.now() - token.at > JOURNAL_MS) return false;
  S.data = JSON.parse(token.json);
  const touched = new Set();
  for (const e of journal) {
    if (e.seq <= token.seq) continue;
    replay(e);
    touched.add(e.key);
  }
  if (touched.has('projects')) {
    const have = new Set(D().projects.map(p => p.id));
    const server = serverOrder().filter(id => have.has(id));
    D().projOrder = [...server, ...D().projOrder.filter(id => have.has(id) && !server.includes(id))];
  }
  if (touched.has('workspaces')) refreshWs();
  return true;
}

/* ---------- the page coming and going ---------- */
addEventListener('beforeunload', e => {
  if (!st.ready || st.stopping || !hasUnsaved()) return;
  if (!st.offline) flush({ keepalive: true });
  e.preventDefault(); // the browser asks before leaving with changes that are not safely on the server
  e.returnValue = '';
});
addEventListener('pagehide', () => {
  if (st.ready && !st.offline) flush({ keepalive: true });
});
addEventListener('pageshow', e => {
  if (e.persisted && st.ready) quietResync(); // back from the browser's page cache: the stream is long dead
});
document.addEventListener('visibilitychange', () => {
  if (!st.ready) return;
  if (document.visibilityState === 'hidden') {
    st.hiddenAt = Date.now();
    if (!st.offline) flush({ keepalive: true });
  } else if (st.hiddenAt && Date.now() - st.hiddenAt > 60000) quietResync();
});
