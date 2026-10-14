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
                    applies the user's saved preferences, and subscribes to live updates (first, so that no change can fall between
                    the load and the stream). Rejects when the load fails (a
                    ClientResponseError; check .status). With boot: true it first refreshes the stored session and, while the server
                    cannot be reached or fails on its own (a 5xx), shows the offline state and keeps trying (every 3 s; with doubling
                    waits, up to 30 s, while it is the server that fails); it only rejects for a session the server refuses, another
                    4xx, or a server that has failed on its own for a minute in a row (at least 3 tries: see "a server that keeps failing"), so that the
                    caller can say so instead of showing the skeleton for ever. A start that stopSync() or a newer startSync() cut
                    short rejects with .cancelled and touches nothing.
     stopSync({ flush })
                    Ends the session's sync: unsubscribes, stops every timer, forgets what was loaded. With flush: true it first sends
                    any unsaved change (when online). Sign-out calls this; it does not touch the auth store or S.data.
     flush()        Sends what differs between S.data and the server's copy. store.js save() calls it 150 ms after the last change.
                    Runs one at a time; a call during a run makes it go round once more. Resolves true when nothing was left behind.
     retryNow()     Tries to leave the offline state right now (new stream, reload, flush). Resolves true when back online. Wired to
                    the "Try again" button and the offline toast.
     sessionGen()   Changes whenever a session starts or stops, never while one recovers: a refused edit's "Try again" checks it so
                    that it never lands in a later sign-in.
     resubscribe() / quietResync()
                    For when the account's token was replaced (the password was changed, actions.js savePassword): PocketBase then
                    keeps the live stream open but unauthenticated, so nothing arrives on it any more. resubscribe() opens a new stream
                    with the current token (resolving true when the server has registered it), quietResync() reloads and merges what
                    was missed meanwhile. Neither throws.
     adopt(key, record)
                    Puts a record the caller already created on the server (a file upload, say) into S.data and the sync baseline
                    without sending it again. `key` is the app key or collection name ('files'), `record` the raw PocketBase record
                    the create call returned. Returns the app object (an existing one if the live update arrived first). The caller
                    renders. Idempotent.
     snapshotState() / restoreState(token)
                    Undo support behind actions.js snapshot()/restore(): the token is opaque; restoring puts S.data back as it was and
                    then re-applies the changes other people made since, so Undo never reverts their work. restoreState() returns
                    false (and does nothing) when the session was restarted since the snapshot.
     pendingChanges()  Number of record creates, updates and deletes the server has not confirmed; unsent settings (user_prefs) count as
                    one. A change the server refused is not counted: it is dealt with, see flush.
     hasUnsaved()   pendingChanges() > 0 or a flush in progress. Sign-out (actions.js), the unload prompt and uploads (files.js) ask.
     stats          Counters and timings of the last flush, for diagnosis.

   Model
     base      What the server is known to hold, per collection: Map(id -> { p, s, u }): p the canonical payload (sync-map's
               toRecord() of the app object, so "has this record changed" is one string compare), s its stable string, u the
               record's `updated` time. It only ever advances to a state the server confirmed (a load, a live update, or the answer
               to our own request), never to what we merely sent. So while a write is in flight it still shows what the server had,
               and the user's edit is still recognisably "mine" if someone else's change to the same record arrives meanwhile.
               Every record read from the server reaches S.data through fromRecord(), which normalizes it (a value of the wrong type
               is coerced, a missing one added: sync-map.js, normalize.js), and base holds the payload of that normalized object. So a
               malformed record is never "changed" and never written back, and what the app itself writes must come out of
               normalization unchanged, or its record would differ from base for ever (see stuck()).
     flush     Diffs S.data against base and sends creates and updates together, a create that needs a parent created in the same
               flush after it, then deletes. A create carries the whole record. An update carries only the top-level fields that
               changed, and of `doc` only the keys that changed (docPatch: key -> new value, docUnset: keys that went away), which
               the server applies to its own copy, so nobody's change to one key undoes somebody else's change to another
               (server/pb_hooks/doc_patch.pb.js). A server that does not confirm them (no X-Doc-Patch header on the answer: the hook is not
               loaded) is remembered for the session, and `doc` goes whole from then on. A 404 on delete counts as done. The server's answer
               to each create and update is applied like a live update. Network failure -> offline. A server error (another 5xx)
               -> offline too: the change stays unsent and goes out when the server takes it, but not for ever: an op (collection and id)
               that has failed with server errors at least 3 times over a minute in a row is refused like a 4xx (its toast stays until it
               is dismissed), and the queue goes on (see weary()).
               401 -> sign-in page. Any other 4xx -> one toast, and the server's version of the record replaces the local one (so a
               rejected change is never sent again). Should that version not be readable right now (the server fails or cannot be
               reached: the page goes offline), a refused update of a record goes back at once to the copy the baseline holds (see
               putBack()), so the field snaps back where it was edited; any other refusal takes the local one as the baseline instead.
               Either way the change is never sent again, and the reload that recovery makes brings the server's version in; flush
               resolves false then. Should it be unreadable for another reason (a 4xx on the read-back, a cancelled request), the local
               one is the baseline as well and a quiet reload follows once no recovery or reload is running, so the refused value does
               not stay on screen (a 401 there ends the session). An update that the server stores differently from what was sent (it
               rewrites the value) is not sent again once that is clear: one console.error names the record and fields, and the
               server's version is taken, without a toast (see stuck()).
     live      One subscription per collection. An event is dropped when it is older than base (by `updated`: a late echo of an
               earlier write) or equal to it (our own echo). Otherwise it is merged per top-level field and per top-level `doc` key
               (3-way against base): fields with an unsent local edit keep the local value, the rest take the remote one. The
               object is patched in place.
     offline   Entered when a request cannot reach the server (or a proxy answers 502-504) or fails with a server error of its own,
               or the live stream stays down and the server does not answer a health check. Both causes are alike wherever the page
               decides between staying offline and carrying on: a health check, a reload or a send that fails either way keeps it
               offline (a reload or health check only until it has failed for a minute: see below), so recovery never says "synced"
               after one. Polls on the SDK's reconnect and by timer: every 3 s while the
               server cannot be reached, with the wait doubling up to 30 s while it answers but fails (each try is a ping, a stream,
               a full load and a send), and back to 3 s on a network failure or on success (see poll()). Recovery, in this order: a
               new stream, registered on the server before anything is read (so no change can fall between the reload and the
               stream); then reload by merging (not replacing, so nothing typed meanwhile is lost); then send what is unsent (built on
               the fresh copy, so it does not overwrite other people's changes to the same record). See recover(). A stream that
               cannot be registered (a proxy that buffers it) does not hold recovery or the first load back for ever: they go on
               without it, say so, and the safety net replaces the stream and reloads. So does the first load, once the stream has
               come up late. A reload the server answers with a 4xx, or fails on its own for a minute in a row (the same rule as for a write,
               see weary()), does not keep the page offline either (it could never end): the page carries on with what it has, sends
               what is unsent, and says so (it does not say "synced"). After a minute of 5xxs, though, it does so only once the server
               has answered some request for data in that try (another list, a write): a server that fails everything keeps the page
               offline until it mends. Nor does it say "synced" when a change was refused since the page went offline.
     access    PocketBase sends a client no event when it stops being able to see a record (it was taken off a private project's members,
               the project was made private ...): the open page would show the project for ever. So every round of the safety net
               (20 s) asks which projects the server still shows this user, and lets go of the others with their tasks, comments,
               activity, files, events and saved views, as if somebody else had deleted them (dropRevoked()). Nothing is written.
     prefs     A user without a settings record (user_prefs) gets one with the first save after a setting has changed, not at sign-in.
               Until then, the first record to arrive (another tab made it) is merged against the settings held at sign-in (prefsInit),
               also when it is handed over by a refused create (a second tab's, which the unique `user` rejects); the tab's own create,
               recognised by its id, is not: what was changed since it was sent stays, even if that is the sign-in value again.
               A live record is merged a level deeper than other records (mergePrefs()): a setting, a view, a notification setting, a
               favourite is each its own entry, so an unsent change to one does not overwrite another tab's change to a different one.
               What it names that this tab has not loaded (a favourite's project or task, a workspace) is kept, not erased by the next
               save and not left pending: see prefsPayload() and wantedWs().
     sessions  Every wait in this module (a request, a timer, the boot loop's pause) captures st.gen first and gives up quietly, touching
               nothing and showing nothing, when it has changed by the time it wakes: sign-out and a newer start both change it at once.
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

const POLL_MS = 3000; // offline: how soon to try again
const POLL_MAX_MS = 30000; // ... and the longest wait while the server keeps failing on its own (see poll())
const st = {
  active: false, // between startSync and stopSync
  ready: false, // the first load has been installed
  stopping: false,
  broken: false, // the last flush failed on a bug (not a server answer) and the user has been told
  gen: 0, // bumps on every start and stop: work begun under an older value gives up quietly
  me: '', // the signed-in user's id
  offline: false,
  refusedAtOffline: 0, // how many changes had been refused when the page went offline: recover() says so if there are more by the time it is back
  cause: 'network', // why: 'network' (cannot be reached) or 'server' (answers, but fails): sets the pace of the offline poll
  wait: POLL_MS, // the poll's current wait
  flushing: null, // promise of the running flush
  again: false, // a flush was asked for while one ran
  busy: null, // promise of the running recovery or reload
  reloading: false, // a full reload is merging in: skip per-record follow-up fetches
  queue: [], // live events that arrived while the first load was in flight
  prefsId: '', // id for the user_prefs record this user does not have yet
  prefsInit: null, // the settings (doc) this user had at sign-in when no settings record existed: until they differ there is nothing to create
  wsWanted: null, // { id, had }: the workspace a live settings record names that is not loaded here, and the one this tab was in then (see wantedWs())
  pollT: 0, // the offline poll's timer
  netT: 0,
  graceT: 0,
  rtDown: false, // the live stream dropped and has not come back
  hiddenAt: 0,
  wake: null, // lets retryNow() cut a boot-time wait short
};
export const stats = { flushes: 0, lastDiffMs: 0, lastFlushMs: 0, lastOps: 0, received: 0, log: [] };
const DEV = !!import.meta.env?.DEV;

const same = (a, b) => stableStringify(a) === stableStringify(b);
/* Resolves when `promise` has settled (however it ended) or after `ms`, whichever comes first. */
const within = (promise, ms) =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
const STREAM_WAIT_MS = 3000;
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
   no good), 'abort', 'server' (it failed: another 5xx; nothing was said about the change itself, so a write is tried
   again, see flushOnce and weary()), or 'rejected' (the server understood and said no). */
function classify(err) {
  if (err?.isAbort) return 'abort';
  const s = err?.status;
  if (s === 0 || s === 502 || s === 503 || s === 504) return 'network';
  if (s === 401) return 'auth';
  if (s >= 500) return 'server';
  return 'rejected';
}
/* The server can take no request right now: it cannot be reached, or it fails on its own. A change then stays unsent and the page goes
   offline (and a read that fails this way keeps it offline), whatever the cause. */
const failing = kind => kind === 'network' || kind === 'server';
/* Why such a failure put the page offline, for the pace of the poll. */
const causeOf = err => (classify(err) === 'server' ? 'server' : 'network');
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
   swaps two values and rewrites nothing else, and a project the server has not seen yet gets a value between its neighbours. That value
   can equal a hidden project's (their values are not known here): ties are settled by id, so the visible order does not change, and
   it is only if that project is ever shown that it lands next to the new one. */
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
let wholeDoc = false; // the server turned out to ignore docPatch: send `doc` whole for the rest of the session
/* What an update request carries: the top-level fields of `after` that differ from `before`. Columns go as they are. `doc` goes as
   the keys that changed (docPatch: key -> new value) and the keys that went away (docUnset), which the server applies to its own
   copy of the doc. Sent whole, a doc built a moment ago would put back the old value of every key somebody else changed since.
   (Creates, which have no older copy to spoil, still send everything.) */
function changedFields(before, after) {
  const out = {};
  for (const f of Object.keys(after)) if (f !== 'id' && f !== 'doc' && !same(after[f], before[f])) out[f] = after[f];
  const was = before.doc || {};
  const now = after.doc || {};
  if (wholeDoc) {
    if (!same(now, was)) out.doc = now;
    return out;
  }
  const patch = {};
  const unset = [];
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (same(now[k], was[k])) continue;
    if (now[k] === undefined) unset.push(k);
    else patch[k] = now[k];
  }
  if (Object.keys(patch).length) out.docPatch = patch;
  if (unset.length) out.docUnset = unset;
  return out;
}
/* Does this update carry docPatch/docUnset? Then the server's answer must carry an X-Doc-Patch header (see patchFetch()), or it ignored them. */
const isPatch = op => !!(op.fields?.docPatch || op.fields?.docUnset);
/* What an update sent that the answer (a canonical payload) does not hold: [{ field, got, was }], where `was` is what the field held
   when we sent. A column is named by itself, a doc key as doc.<key>, a whole doc as doc. Empty when the server stored what it was given. */
function notStored(op, theirs) {
  const out = [];
  const was = op.was || {};
  const doc = theirs.doc || {};
  const wasDoc = was.doc || {};
  for (const [f, v] of Object.entries(op.fields || {})) {
    if (f === 'docPatch') {
      for (const [k, x] of Object.entries(v)) if (!same(doc[k], x)) out.push({ field: `doc.${k}`, got: doc[k], was: wasDoc[k] });
    } else if (f === 'docUnset') {
      for (const k of v) if (k in doc) out.push({ field: `doc.${k}`, got: doc[k], was: wasDoc[k] });
    } else if (!same(theirs[f], v)) out.push({ field: f, got: theirs[f], was: was[f] });
  }
  return out;
}
/* The names an update op writes, for diagnosis: columns, and doc.<key> / -doc.<key> for patched and removed doc keys. */
function fieldNames(fields) {
  return Object.keys(fields).flatMap(f => {
    if (f === 'docPatch') return Object.keys(fields.docPatch).map(k => `doc.${k}`);
    if (f === 'docUnset') return fields.docUnset.map(k => `-doc.${k}`);
    return [f];
  });
}
/* The user_prefs payload the app would write now. Two parts of the record can name something this tab does not have, and the payload
   passes them through as the baseline holds them, so that they are not a difference (they would stay pending for ever) and a save
   does not erase them:
   - favourites: the ids of the baseline's favs whose project or task is not loaded here (it has not arrived yet, or the user cannot
     see it). This tab decides only about the records it has. `held` is the favs to take them from: the baseline's, except at install(),
     which sets the baseline from this payload. insertObject() flags a record that arrives later from the same baseline. Accepted: the
     id of a record deleted elsewhere (or here) stays in the list for good. Harmless: applyFavs() flags only what is loaded.
   - the workspace: the one a live record named that is not loaded here, while the tab is still where it was then (wantedWs()). */
function prefsPayload(id, held = prefsEntry()?.p.doc?.favs) {
  const out = buildUserPrefs(S, id);
  for (const key of ['projects', 'tasks']) {
    const have = new Set((D()[key] || []).map(x => x.id));
    const away = (held?.[key] || []).filter(x => !have.has(x));
    if (away.length) out.favs[key] = [...new Set([...out.favs[key], ...away])].sort();
  }
  const ws = wantedWs();
  if (ws) out.ws = ws;
  return toRecord(USER_PREFS, out, { me: D().me });
}
const prefsEntry = () => base.get(USER_PREFS).values().next().value;
const favSet = key => new Set(prefsEntry()?.p.doc?.favs?.[key] || []);
/* The workspace a live settings record names that this tab has not loaded (it was created or shared meanwhile): applyUserPrefs()
   ignores such an id, and sending the old one back would undo the other tab's choice. It is remembered with the workspace this tab was
   in then, and is the payload's `ws` for as long as the tab is still in that one. refreshWs() moves the tab to it when it arrives. A
   tab that has moved on (the user picked a workspace here) has made its own choice, and that is what goes out: this forgets the
   memory the first time it finds the tab elsewhere (a save follows every switch, and builds the payload). */
function wantedWs() {
  const w = st.wsWanted;
  if (w && D().ws.id !== w.had) st.wsWanted = null;
  return st.wsWanted?.id;
}

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
/* merge3() for the settings record, one level deeper where it holds independent entries, so that an unsent change to one setting does
   not overwrite another tab's change to a different one. Same rule: an entry `mine` still has as `b` had takes `theirs` (absent
   included: `undefined` is absent, and an absent entry stays out of the result); any other stays mine. Applied to
     - prefs, notifPrefs: per key; views: per page key (one view is a unit, a view changed on both sides is mine);
     - favs.projects, favs.tasks: as sets, theirs plus the ids mine added since `b`, minus the ids mine removed since `b`, sorted;
   and not to recentSearches, ws and collapsed, which are single values. A part that is not a map in `mine` or `theirs` (the record lacks
   it) goes by the whole-part rule of merge3(). The result is what cleanPrefs() would give it: a view at its default is in none of
   the three, so not in the result either, and prefs come out whole as long as theirs has them whole. Sent as before, whole top-level keys. */
const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined); // (a key named like a method of Object.prototype is an entry)
function mergeEntries(b, mine, theirs) {
  const rows = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const v = same(own(mine, k), own(b, k)) ? own(theirs, k) : own(mine, k);
    if (v !== undefined) rows.push([k, v]);
  }
  return Object.fromEntries(rows); // (an own "__proto__" key stays a plain key)
}
function mergeIds(b = [], mine = [], theirs = []) {
  const was = new Set(b);
  const has = new Set(mine);
  const gone = new Set(b.filter(id => !has.has(id)));
  return [...new Set([...theirs, ...mine.filter(id => !was.has(id))])].filter(id => !gone.has(id)).sort();
}
function mergePrefs(b, mine, theirs) {
  const out = merge3(b, mine, theirs);
  const bd = b.doc || {};
  const md = mine.doc || {};
  const td = theirs.doc || {};
  for (const k of ['prefs', 'views', 'notifPrefs']) if (isMap(md[k]) && isMap(td[k])) out.doc[k] = mergeEntries(isMap(bd[k]) ? bd[k] : {}, md[k], td[k]);
  if (isMap(md.favs) && isMap(td.favs)) {
    const was = isMap(bd.favs) ? bd.favs : {};
    out.doc.favs = { projects: mergeIds(was.projects, md.favs.projects, td.favs.projects), tasks: mergeIds(was.tasks, md.favs.tasks, td.favs.tasks) };
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
/* D().ws mirrors the current workspace's entry in D().workspaces (and falls back to the first one). The workspace a live settings
   record named before it was loaded (wantedWs()) is the current one once it is, unless the user chose another meanwhile. */
function refreshWs() {
  const d = D();
  const want = wantedWs();
  const arrived = want && d.workspaces.find(x => x.id === want);
  if (arrived) st.wsWanted = null;
  const w = arrived || d.workspaces.find(x => x.id === d.ws.id) || d.workspaces[0];
  // (the current one was deleted: the fallback is not the user's choice, so the wanted one stays wanted from there)
  if (want && !arrived && w && w.id !== d.ws.id) st.wsWanted.had = w.id;
  const next = w && wsFromWorkspace(w);
  if (next && !same(d.ws, next)) d.ws = next;
}
/* Whatever the view held about something that is gone. */
function forgetUi(key, id) {
  const u = S.ui;
  // A dialog about it has nothing left to show: the share or settings dialog of a project, the edit form of a task, a file's preview.
  const open = u.modals.filter(m => {
    if (key === 'projects') return !(m.id === id || m.pid === id || (m.type === 'project' && m.edit === id));
    if (key === 'tasks') return !((m.type === 'task' && m.edit === id) || m.tid === id);
    return true;
  });
  if (open.length !== u.modals.length) u.modals = open;
  if (key === 'projects' && u.pop?.id === id) u.pop = null;
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
  // A tab that signed in without a settings record and is handed the first one (another tab created it) measures its own edits
  // against the settings it had at sign-in: what the user has not touched here takes theirs, instead of overwriting it. Not when the
  // record is this tab's own create (its answer or its echo, the id is ours): that holds what this tab sent, so what the user changed
  // since (even back to the sign-in value) is the only difference and must win.
  const from = b ? b.p : rec.id !== st.prefsId && st.prefsInit && { ...mine, doc: st.prefsInit };
  const merged = force ? theirs : from ? mergePrefs(from, mine, theirs) : mine;
  known.set(rec.id, entryOf(theirs, rec.updated));
  st.prefsInit = null; // there is a baseline now
  const changed = !same(merged, mine);
  if (changed) applyUserPrefs(S, { id: rec.id, ...merged.doc });
  // A workspace that is not loaded here cannot be applied: remember it (or forget an earlier one the record no longer names).
  const ws = merged.doc.ws;
  const d = D();
  st.wsWanted = ws && ws !== d.ws.id && !d.workspaces.some(x => x.id === ws) ? { id: ws, had: d.ws.id } : null;
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
    if (gen === st.gen && failing(classify(err))) goOffline(causeOf(err));
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
/* How many reads and writes the server answered without failing on its own (a count that only grows): recover() looks at what moved
   during one try, to tell a server that fails one list from one that fails everything. */
let answered = 0;
const SETTLE_MS = 3000;
/* Every collection the user may read, in parallel, as { appKey: [records], user_prefs: [record] }. The activity feed and the
   notification list load only their newest entries. When one read fails, the others are given up to SETTLE_MS to land (and be
   counted) before the failure is thrown. */
async function loadAll() {
  const full = coll => pb.collection(coll).getFullList({ batch: 500, sort: 'created,id' });
  const newest = (coll, n) =>
    pb
      .collection(coll)
      .getList(1, n, { sort: '-created,id', skipTotal: true })
      .then(r => r.items);
  const jobs = COLLECTIONS.map(({ key, coll }) => [key, CAPS[key] ? newest(coll, CAPS[key]) : full(coll)]);
  jobs.push([USER_PREFS, full(USER_PREFS)]);
  let open = true; // a read that lands after the failure was thrown counts for nobody: the next try would take it as its own
  const reads = jobs.map(j =>
    j[1].then(r => {
      if (open) answered++;
      return r;
    }),
  );
  try {
    const done = await Promise.all(reads);
    return Object.fromEntries(jobs.map((j, i) => [j[0], done[i]]));
  } catch (err) {
    await within(Promise.allSettled(reads), SETTLE_MS);
    open = false;
    throw err;
  }
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
  st.wsWanted = null; // (a workspace the record names that is not loaded falls back to a loaded one here, and the baseline says so)
  const rec = all[USER_PREFS][0];
  const saved = rec && fromRecord(USER_PREFS, rec);
  if (saved) applyUserPrefs(S, saved);
  refreshWs();
  // (the favourites of records that are not loaded are the record's: see prefsPayload())
  if (rec) base.get(USER_PREFS).set(rec.id, entryOf(prefsPayload(rec.id, saved.favs), rec.updated));
  else st.prefsInit = prefsPayload('').doc;
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
      const gone = await Promise.all(missing.map(id => confirmGone(key, coll, id, gen)));
      if (gen !== st.gen) return false; // the session ended while asking: this answer is for somebody else's data
      for (const [i, id] of missing.entries()) {
        if (gone[i]) changed = removeRecord(key, id) || changed;
      }
    }
    if (all[USER_PREFS][0]) changed = applyRecord(USER_PREFS, all[USER_PREFS][0]) || changed;
    if (changed) sortLists(D());
    readSick = null; // the server serves reads again
    return changed;
  } finally {
    if (gen === st.gen) st.reloading = false;
  }
}
async function confirmGone(key, coll, id, gen) {
  try {
    const rec = await pb.collection(coll).getOne(id);
    if (gen === st.gen) applyRecord(key, rec);
    return false;
  } catch (err) {
    if (err?.status === 404) return true;
    throw err;
  }
}

/* ---------- live updates ---------- */
/* Replaces whatever stream there is with a new one, and resolves once the server has registered its subscriptions: from then on every
   change committed on the server is sent down it. (What was committed before is for the caller to fetch afterwards: see recover().) */
async function subscribeAll(gen) {
  if (gen !== st.gen) return false; // the session ended: the stream, if there is one, is a newer session's, not ours to close or fill
  pb.realtime.onDisconnect = onDisconnect;
  await pb.realtime.unsubscribe(); // drop what an earlier attempt left behind (this also closes an open stream)
  if (gen !== st.gen) return false;
  // While the SDK is retrying a lost connection by itself (it keeps trying for as long as the server is down, every 0.2 to 2 s),
  // subscribe() does not connect: it records the subscriptions and returns at once, and the SDK's next retry sends them. A caller
  // that has just seen the server answer must not mistake that for a live stream, so the retrying is ended here and the subscribes
  // below connect right away. disconnect() is an SDK internal (private in its type definitions), like the clientId the safety net
  // uses: another reason package.json pins pocketbase to an exact version.
  pb.realtime.disconnect();
  const colls = [...COLLECTIONS.map(c => c.coll), USER_PREFS];
  await Promise.all(colls.map(coll => pb.collection(coll).subscribe('*', e => onEvent(coll, e))));
  if (gen !== st.gen) return false; // (subscribing now would open a stream again after sign-out)
  await pb.realtime.subscribe('PB_CONNECT', onConnect); // fires on every (re)connect
  return true;
}
/* A new stream, for when the old one cannot be trusted. Never throws: the safety net tries again. Resolves true when the server has
   registered the subscriptions, false when it could not be done (or the session ended meanwhile). */
async function streamUp(gen) {
  try {
    return await subscribeAll(gen);
  } catch (err) {
    console.warn('sync: live updates are not connected', err);
    return false;
  }
}
export const resubscribe = () => streamUp(st.gen);
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
    st.prefsInit = null;
    save(); // (until then the settings count as an unsent change, see computeDiff())
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
  const gen = st.gen;
  st.graceT = setTimeout(async () => {
    if (!st.rtDown || !st.ready) return;
    try {
      await ping();
    } catch (err) {
      const kind = classify(err);
      if (gen === st.gen && (failing(kind) || kind === 'abort')) goOffline(causeOf(err));
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
      } else if (differs(p, b)) updates.push({ type: 'update', key, coll, id: p.id, fields: changedFields(b.p, p), was: b.p });
    }
    if (!updateOnly) for (const id of known.keys()) if (!seen.has(id)) deletes.push({ type: 'delete', key, coll, id });
  }
  const cur = prefsEntry();
  const id = cur ? cur.p.id : st.prefsId || (st.prefsId = uid());
  const p = prefsPayload(id);
  let prefs = null;
  if (!cur) {
    // A user the dashboard created has no settings record, and signing in does not give them one: it is created by the first save
    // after a setting (a view, a favourite, the theme, the workspace ...) has come to differ from what it was at sign-in.
    if (!st.prefsInit || !same(p.doc, st.prefsInit)) prefs = { type: 'create', key: USER_PREFS, coll: USER_PREFS, id, payload: p };
  } else if (differs(p, cur)) prefs = { type: 'update', key: USER_PREFS, coll: USER_PREFS, id, fields: changedFields(cur.p, p), was: cur.p };
  return { creates, updates, deletes: deletes.reverse(), prefs };
}
export function pendingChanges() {
  if (!st.ready) return 0;
  const d = computeDiff();
  return d.creates.length + d.updates.length + d.deletes.length + (d.prefs ? 1 : 0); // the settings are one record
}
export const hasUnsaved = () => !!st.flushing || pendingChanges() > 0;
/* What pendingChanges() counts, one line per op ("update tasks/t3 status,doc.title"), settings included. For diagnosis. */
export function pendingDetails() {
  const d = computeDiff();
  return [...d.creates, ...d.updates, ...d.deletes, ...(d.prefs ? [d.prefs] : [])].map(
    o => `${o.type} ${o.key}/${o.id}${o.fields ? ' ' + fieldNames(o.fields).join(',') : ''}`,
  );
}

const NOT_RELATIONS = ['id', 'doc', 'docPatch', 'docUnset']; // the payload fields that never hold the id of another record
/* The ops in the rounds they go out in. Creates, updates and the user's settings go together, except that one that points at a
   record created in this same flush (a task in a new project, a comment on a new task) waits for it. Deletes go last: an update
   may move a child out of the record being deleted. Everything within a round is sent at once, so an ordinary save is one round
   trip, which also matters when the page is about to close (a round that has not started by then is never sent). Deletes need no
   order among themselves: deleting a parent removes its children on the server, and a child already gone counts as deleted. */
function rounds(diff) {
  const creating = new Set(diff.creates.map(op => op.id));
  const waitsFor = op => {
    const ids = [];
    for (const [field, value] of Object.entries(op.payload || op.fields)) if (!NOT_RELATIONS.includes(field)) ids.push(...[].concat(value));
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
/* ---------- a write that never sticks ---------- */
/* An update whose answer holds something other than what was sent leaves the record different from the server's copy. That is only
   possible when the server stores values differently from how the app writes them (a mapping that does not round-trip, a server-side
   hook), and the app then cannot get that record to match: it keeps sending the same update, or, when the answer happens to equal the
   baseline, keeps it as "unsent" for ever. Either way, once it is clear that sending again will not help, stop: one console.error
   names the record and the fields, and the server's version is taken, as for a refused change but without a toast. That is clear when
     - the same update (identical fields) was answered with something other than what it sent more than LOOP_MAX times within LOOP_MS
       (the answers keep changing: a request every save() delay, for ever), or
     - the same update was answered the same way twice in a row, or
     - the answer keeps the old value of everything that did not stick.
   A different update to the record, or one the server stores as sent, starts the count over, so typing, however fast, never gets here. */
const LOOP_MAX = 5;
const LOOP_MS = 30000;
const loops = new Map(); // 'key/id' -> { sig, n, ans, since } for the last update that was not stored as sent
function stuck(op, theirs) {
  const mark = `${op.key}/${op.id}`;
  const bad = notStored(op, theirs);
  if (!bad.length) {
    loops.delete(mark);
    return false;
  }
  const sig = stableStringify(op.fields);
  const ans = stableStringify(theirs);
  const now = Date.now();
  const last = loops.get(mark);
  const again = !!last && last.sig === sig && now - last.since < LOOP_MS;
  const n = again ? last.n + 1 : 1;
  loops.set(mark, { sig, n, ans, since: again ? last.since : now });
  if (n <= LOOP_MAX && !(again && last.ans === ans) && !bad.every(d => same(d.got, d.was))) return false;
  loops.delete(mark);
  console.error(
    `sync: the server stores ${op.coll}/${op.id} differently from what is sent (${bad.map(d => d.field).join(', ')}). Not sending it again; taking the server's version.`,
  );
  return true;
}
/* ---------- a server that keeps failing ---------- */
/* A server error (5xx other than 502-504) says nothing about the change or the data, so it is tried again, from the offline poll. But
   one record that cannot be written, or one read that always fails, would keep the page offline for ever (and a first load on the
   skeleton), so it is not tried for ever. What gives up is a streak: at least SICK_TRIES failures with server errors, the last SICK_MS
   or more after the first.
   - A write: an op (collection and id) with such a streak is refused like a 4xx: one toast, the server's copy taken (refuse()), and
     the rest of the queue goes on (weary()). A success or the server saying no ends the streak, and so does the op leaving the diff
     (the user took the edit back, and what comes back is a new edit: flushOnce()) or changing (the user edited the record again,
     which the description editor allows while offline: what goes out is a new edit, and is not given up on with the old one: weary()).
     A recovery that fails with a server error counts as one more failure of each op already in a streak, though nothing is sent for
     it (stepSick()).
   - The reload (recovery's or a quiet one): such a streak is taken as the server saying no, as for a 4xx (wearyReload()), except that
     recovery leaves the offline state only once the server has answered a request for data (recover()). The first load keeps a streak of
     its own, and fails at its end (startSync()).
   Failures more than SICK_GAP_MS apart are not a streak. That is a little over the longest wait of the offline poll, so a poll that has
   backed off keeps one alive, while a page that is throttled or asleep (a timer a minute apart, say: two tries would then be "a minute
   in a row") or an outage in between breaks it: what the server did meanwhile is unknown. Time and tries, not a count alone, so the
   pace of the poll does not change what this means. */
const SICK_MS = 60000;
const SICK_TRIES = 3;
const SICK_GAP_MS = POLL_MAX_MS + 15000;
const sick = new Map(); // 'key/id' -> { since, last, n, sig }: the first and the latest failure of the op's streak, how many there were, and what it sent
let readSick = null; // the same for the reload
/* The streak after one more server error at `now`: `was` goes on when its latest failure is recent enough, else a new one starts. */
function streakOf(was, now) {
  const on = !!was && now - was.last <= SICK_GAP_MS;
  return { since: on ? was.since : now, last: now, n: on ? was.n + 1 : 1 };
}
const worn = s => s.n >= SICK_TRIES && s.last - s.since >= SICK_MS; // long enough to give up on
const sigOf = op => `${op.type} ${stableStringify(op.fields || op.payload || {})}`; // what an op sends: a streak is of one version of it
/* Notes how an attempt at `op` went. Returns true when the op has now failed with server errors for long enough to give up on. */
function weary(op, status) {
  const mark = `${op.key}/${op.id}`;
  if (status !== 'server') {
    if (status === 'ok' || status === 'rejected') sick.delete(mark);
    return false;
  }
  const sig = sigOf(op);
  const was = sick.get(mark);
  const s = { ...streakOf(was?.sig === sig ? was : null, Date.now()), sig }; // an op that has changed since it last failed is a new edit
  if (!worn(s)) {
    sick.set(mark, s);
    return false;
  }
  sick.delete(mark);
  console.warn(
    `sync: ${mark} has failed with a server error ${s.n} times over ${Math.round((s.last - s.since) / 1000)} s. Not sending it again; taking the server's version.`,
  );
  return true;
}
/* Notes a reload that failed with a server error. Returns true when that has gone on long enough to stop waiting for the server to mend.
   It stays true while the failures keep coming; a reload that works (resync()) or the end of the session starts it over. */
function wearyReload() {
  readSick = streakOf(readSick, Date.now());
  return worn(readSick);
}
/* Notes a recovery that failed with a server error: that is a failed attempt of every change that is already failing and waiting
   behind it (recover() sends only after the reload, so nothing is sent for it). It never gives up on one itself: that happens on
   the next real send (weary()), which is what lets the write be given up on at the pace of the poll rather than after the reload
   has been. An edit made during the outage has no entry, so its streak starts at its first real send; so does one made to a record
   whose change was failing already, as the op it is sent in is not the one that failed (weary()). */
function stepSick() {
  const now = Date.now();
  for (const [mark, s] of sick) sick.set(mark, { ...streakOf(s, now), sig: s.sig });
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
    if (op.type === 'update') {
      if (isPatch(op) && op.patched !== true) {
        // No X-Doc-Patch header: the server dropped the doc part of this update without a word (no doc_patch hook: an older
        // deployment, hooks that were not loaded). Send `doc` whole instead, from now on.
        if (!wholeDoc) console.warn('sync: the server does not apply doc patches (no doc_patch hook loaded?). Sending `doc` whole from now on.');
        wholeDoc = true;
        st.again = true; // the answer holds the old doc, so nothing else would send the edit again: go round once more
      } else if (stuck(op, canon(op.key, rec))) return applyRecord(op.key, rec, true);
    }
    return applyRecord(op.key, rec);
  } catch (err) {
    console.error("sync: could not apply the server's answer", err);
    return false;
  }
}
/* A fetch for an update that carries a docPatch: it notes whether the server says it applies them (doc_patch.pb.js sets X-Doc-Patch). */
const patchFetch = op => async (url, init) => {
  const res = await fetch(url, init);
  op.patched = res.headers.get('X-Doc-Patch') === 'yes';
  return res;
};
/* Sends one op. Never throws: resolves { op, status, changed } with status 'ok', 'network', 'auth', 'abort', 'server' or 'rejected'.
   An answer that comes after the session ended (`gen` is no longer current) is not applied, to the data or the baseline of the
   session that may have started since: the status is 'abort'. */
async function sendOne(op, options, gen) {
  const api = pb.collection(op.coll);
  let rec;
  if (op.type === 'delete') deleted.set(`${op.key}/${op.id}`, Date.now()); // its echo may beat the answer
  try {
    if (op.type === 'create') rec = await api.create(op.payload, options);
    else if (op.type === 'update') rec = await api.update(op.id, op.fields, isPatch(op) ? { ...options, fetch: patchFetch(op) } : options);
    else await api.delete(op.id, options);
  } catch (err) {
    if (gen !== st.gen) return { op, status: 'abort' };
    if (op.type === 'delete' && err?.status === 404) return { op, status: 'ok', changed: settle(op) }; // already gone: a cascade got there first
    if (op.type === 'delete') deleted.delete(`${op.key}/${op.id}`);
    const status = classify(err);
    // An id (or a second user_prefs record) that already exists means an earlier attempt got through after all.
    const silent = status === 'rejected' && op.type === 'create' && !!(err.response?.data?.id || err.response?.data?.user);
    return { op, err, status, silent };
  }
  if (gen !== st.gen) return { op, status: 'abort' };
  return { op, status: 'ok', changed: settle(op, rec) };
}
async function flushOnce(options, gen) {
  const t0 = performance.now();
  const diff = computeDiff();
  stats.lastDiffMs = performance.now() - t0;
  if (sick.size) {
    // An op that has left the diff (the user took the change back) is a new one when it comes back: it does not inherit the streak.
    const open = new Set([...diff.creates, ...diff.updates, ...diff.deletes, ...(diff.prefs ? [diff.prefs] : [])].map(op => `${op.key}/${op.id}`));
    for (const mark of sick.keys()) if (!open.has(mark)) sick.delete(mark);
  }
  const phases = rounds(diff).filter(p => p.length);
  stats.lastOps = phases.reduce((n, p) => n + p.length, 0);
  if (!phases.length) return true;
  const rejected = [];
  let fatal = '';
  let changed = false;
  for (const phase of phases) {
    for (const r of await Promise.all(phase.map(op => sendOne(op, options, gen)))) {
      changed = changed || !!r.changed;
      if (r.status === 'ok' || r.status === 'rejected') answered++; // (before weary() words a worn 5xx as refused)
      if (weary(r.op, r.status)) {
        r.status = 'rejected'; // told and refused like a 4xx: the queue goes on without it
        r.worn = true; // ... but for failing so long, not because the server said no: refuse() words it differently
      }
      if (r.status === 'rejected') rejected.push(r);
      else if (r.status !== 'ok' && !fatal) fatal = r.status;
    }
    if (fatal || gen !== st.gen) break;
  }
  stats.lastFlushMs = performance.now() - t0;
  stats.flushes++;
  if (gen !== st.gen) return false;
  // the changes stay unsent, and the offline poll tries them again
  if (failing(fatal)) goOffline(fatal);
  else if (fatal === 'auth') expire();
  let down = false;
  if (rejected.length) down = await refuse(rejected, gen);
  else if (changed) hooks.render();
  return !fatal && !down; // a refusal whose server copy could not be read back put the page offline: not "nothing left behind"
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
    for (const [k, e] of loops) if (Date.now() - e.since > LOOP_MS) loops.delete(k);
    for (const [k, e] of sick) if (Date.now() - e.last > SICK_GAP_MS) sick.delete(k);
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
let refusals = 0; // how many changes were refused and told so (a count that only grows): setOffline() notes it, recover() compares it
const NAME_MAX = 40;
/* How the user knows a record, for the toast that says a change to it was discarded: its name or title (a member has both: the name),
   cut to NAME_MAX characters. It is the name the screen shows after the change is taken back, so the baseline's copy comes first; only
   a record that was just created here has none, and the object is read then. '' for what has no name worth showing: comments, activity,
   notifications, the settings. Read before the refused change is taken back, which can replace the object or remove it (see
   adoptServerTruth()). */
function nameFor(key, id) {
  if (key === USER_PREFS || key === 'activity' || key === 'notifs') return '';
  const e = base.get(key).get(id);
  const obj = e ? fromRecord(key, e.p) : find(key, id);
  const v = [obj?.name, obj?.title].find(x => typeof x === 'string' && x.trim());
  if (!v) return '';
  const chars = [...v.replace(/\s+/g, ' ').trim()];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join('').trimEnd()}…` : chars.join('');
}
/* The server refused some changes: say so once, and take its version of those records so the same change is never sent again.
   A change that was given up on for failing so long (see weary()) is worded as that, in a toast of its own that stays until it is
   dismissed: the user was not there to see it happen, and the change is gone (it is "discarded" whether or not the screen has gone back
   yet: a refused create or delete is only settled by the reload). The server said no to the others, and they are shown as before.
   Resolves true when that put the page offline (a server copy could not be read back: see adoptServerTruth()). */
async function refuse(list, gen) {
  if (gen !== st.gen) return false; // the session is over (expire() bumps the generation at once): there is nobody to tell
  const loud = list.filter(r => !r.silent);
  const worn = loud.filter(r => r.worn);
  const said = loud.filter(r => !r.worn);
  // The activity and notifications that go with a change are not changes the user made: "(and N more)" leaves them out.
  const others = rs => Math.max(rs.filter(r => r.op.key !== 'activity' && r.op.key !== 'notifs').length - 1, 0);
  if (said.length) {
    const n = others(said);
    hooks.toast(`Couldn't save: ${describe(said[0].err)}${n ? ` (and ${n} more)` : ''}`, { kind: 'err', ms: 7000 });
  }
  if (worn.length) {
    const named = worn.map(r => nameFor(r.op.key, r.op.id)).find(Boolean);
    const n = others(worn);
    // It stays until it is dismissed when a change of the user's is lost; the activity of a change that was saved goes like any toast.
    const mine = worn.some(r => r.op.key !== 'activity' && r.op.key !== 'notifs');
    hooks.toast(
      `Couldn't save ${named ? `your change to “${named}”` : 'a change'}${n ? ` (and ${n} more)` : ''}. The server kept failing, so ${n ? 'they were' : 'it was'} discarded.`,
      mine
        ? { kind: 'err', sticky: true, key: 'refused', replaces: 'refused' } // a second give-up takes the place of the first
        : { kind: 'err', ms: 7000 },
    );
  }
  const left = await Promise.all(list.map(r => adoptServerTruth(r.op, gen)));
  refusals += loud.length; // after the above: a refusal that puts the page offline is lost when it is back (see setOffline())
  if (gen === st.gen) hooks.render();
  if (left.includes('stale')) reloadSoon(gen);
  return left.includes('down');
}
/* A quiet reload, once a recovery or reload that is running has ended (quietResync() does nothing while one runs, and the version it
   would bring in is not in that one: the refused change was sent after it read). It does nothing if the page is offline then: recovery
   reloads. */
function reloadSoon(gen) {
  const go = () => gen === st.gen && quietResync();
  if (st.busy) st.busy.then(go, go);
  else go();
}
/* Takes the server's version of a record it refused a change to. Resolves 'down' when it could not be read because the server failed or
   cannot be reached (the page is offline then, and the reload that recovery makes brings it in), 'stale' when it could not be read for
   another reason (a 4xx, a request that was cancelled) and the page is not offline, so that a reload is needed to bring it in, else ''.
   Either way the refused change is already out of the queue, see putBack() and baseline(). */
async function adoptServerTruth(op, gen) {
  const { type, key, coll, id } = op;
  try {
    if (key === USER_PREFS) {
      const rec = (await pb.collection(coll).getFullList())[0];
      if (gen !== st.gen) return '';
      // A create the server refused because the user has a settings record already (another tab made it first, or an earlier try got
      // through) is about the id, not the content: this tab's unsent settings are merged into that record (applyPrefsRecord()), not
      // overwritten by it. Any other refusal takes the server's.
      if (rec) applyRecord(key, rec, type !== 'create');
      else {
        // None exists. An update that lost its record is made again by the next flush; a refused create is not (the server said no to
        // it): the next one is made when the settings differ from these.
        base.get(key).clear();
        st.prefsInit = type === 'create' ? prefsPayload(id).doc : null;
        if (type !== 'create') save(); // the next flush makes it again: without this the settings would count as unsent until some other save
      }
    } else {
      const rec = await pb.collection(coll).getOne(id);
      if (gen === st.gen) applyRecord(key, rec, true);
    }
    return '';
  } catch (err) {
    if (gen !== st.gen) return '';
    const kind = classify(err);
    if (err?.status === 404 && key !== USER_PREFS) {
      removeRecord(key, id, true); // gone, or not ours to see
      return '';
    }
    // Cannot read it back. The server said no to the change: stop sending it, whatever the reason for not reading, rather than send it
    // for ever (or again and again when the server is merely failing right now).
    if (failing(kind)) {
      putBack(op); // the page is offline for a while: an update's refused value is not left on screen until it is back
      goOffline(kind); // the reload that recovery makes brings the server's version in
      return 'down';
    }
    baseline(key, id);
    if (kind === 'auth') {
      expire(); // the session is over: nothing to reload
      return '';
    }
    return 'stale'; // the refused value is still shown, and nothing else would bring in the server's
  }
}
/* A refused update of a collection record, when the server's version cannot be read: what was refused goes back to the copy the
   baseline holds (the last one the page read or the server confirmed), so the field snaps back where it was edited rather than when
   the server is next reachable. It comes in as a live update would, from what was sent to that copy: merge3() puts back each field
   that still holds what was sent, and keeps one that was edited again since the request was built (the description editor saves
   while offline), which stays unsent and goes out later. It is journaled like one too, so an Undo does not bring the refused value
   back. A baseline entry is a payload, which has the columns of a record, so it stands for one; what a payload leaves out (a member's
   email, a file's stored name) is read from the object. The baseline ends as that copy, so the refused change is not sent again, and
   the reload that recovery makes merges cleanly (and brings in whatever changed on the server meanwhile). A change to a project's
   order is put back whole (reorderProjects() would read the order from the stand-in), and where part of what was refused would still
   be sent (that order, which is kept in a list the entry does not cover) the change is baselined as before: a change must never be
   sent again.
   Everything else is baselined, as it was before, and settled by the reload that recovery makes:
   - a delete is not put back: a project put back goes last, and projectOrders() would send an `order` for every project after it.
   - a create is not removed: what was made with it and is not sent yet would be left without it (the palette and the search read
     `proj(t.project).name` unguarded).
   - the settings are not put back: the server's copy can hold what the page cannot rebuild (a workspace id it does not load:
     applyUserPrefs() ignores one), so putting it back would not empty the diff. */
function putBack(op) {
  const { type, key, id } = op;
  const known = base.get(key);
  const old = known.get(id);
  const obj = key === USER_PREFS ? null : find(key, id);
  if (type !== 'update' || !old || !obj) return baseline(key, id);
  try {
    const rec = { ...obj, ...old.p, updated: old.u };
    if ('order' in op.fields) applyRecord(key, rec, true);
    else {
      known.set(id, entryOf(withFields(old.p, op.fields), old.u)); // the stand-in: the server's copy, had it taken the change
      applyRecord(key, rec);
    }
    if (notStored(op, payloadOf(key, find(key, id))).length < fieldNames(op.fields).length) baseline(key, id);
  } catch (err) {
    console.error('sync: could not put back the refused change', key, id, err);
    baseline(key, id);
  }
}
/* Payload `was` with update `fields` applied, as the server would store it. */
function withFields(was, fields) {
  const out = { ...was };
  for (const [f, v] of Object.entries(fields)) {
    if (f === 'docPatch') out.doc = { ...out.doc, ...v };
    else if (f === 'docUnset') out.doc = Object.fromEntries(Object.entries(out.doc || {}).filter(([k]) => !v.includes(k)));
    else out[f] = v;
  }
  return out;
}
/* Takes the app's version of a record whose change the server refused as the baseline, so computeDiff() finds nothing to send. The
   next reload then brings the server's version in as any remote change: the refused edit is "unchanged" against this baseline, so
   merge3() takes theirs; a refused create is missing from the reload and goes (confirmGone); a refused delete (no object, no
   baseline) comes back as a record new to this browser. The baseline's `updated` is empty, so no answer is dropped as older. (A capped list,
   activity or notifs, is not checked for what is missing, so a refused create there stays until the page is reloaded.)
   This is for a refusal whose server copy cannot be read (see adoptServerTruth()), except for an update of a record while the server
   fails or cannot be reached: that is put back (putBack(), which falls back to this). */
function baseline(key, id) {
  const known = base.get(key);
  if (key === USER_PREFS) {
    if (known.has(id)) known.set(id, entryOf(prefsPayload(id)));
    else st.prefsInit = prefsPayload(id).doc; // a refused create: nothing more to create until the settings differ from these
    // (Known limitation: merged later with another tab's record, this tab's earlier unsent settings edits are part of "these", and lose.)
    return;
  }
  const obj = find(key, id);
  if (obj) known.set(id, entryOf(payloadOf(key, obj)));
  else known.delete(id);
}

/* ---------- offline and recovery ---------- */
function setOffline(on) {
  if (st.offline === on) return;
  st.offline = on;
  S.ui.offline = on;
  clearTimeout(st.pollT);
  st.pollT = 0;
  if (on) {
    st.refusedAtOffline = refusals;
    if (st.ready) poll();
  } else Object.assign(st, { cause: 'network', wait: POLL_MS }); // the next outage starts over
  hooks.render();
}
/* The offline poll: a recovery attempt after `wait`, then the next one once it has ended (it is over when the page is back online).
   While the server cannot be reached it is every 3 s: it may be back any moment and finding out costs one ping. While it answers but
   fails (a 5xx of its own) an attempt costs a ping, a new stream, a full load and a send, and it may take a while to be fixed, so the
   wait doubles up to POLL_MAX_MS for as long as that is the cause; a network failure, or a success, starts it over. */
function poll() {
  const gen = st.gen;
  clearTimeout(st.pollT);
  st.pollT = setTimeout(async () => {
    let ok = false;
    try {
      ok = await recover();
    } catch (err) {
      console.error('sync: recovery failed', err); // never let the poll die: the page would stay offline for ever
    }
    if (gen !== st.gen || !st.offline) return;
    st.wait = !ok && st.cause === 'server' ? Math.min(st.wait * 2, POLL_MAX_MS) : POLL_MS;
    poll();
  }, st.wait);
}
/* The page cannot save: `kind` is why ('network' or 'server'), noted for the poll even when the page is offline already. */
function goOffline(kind = 'network') {
  if (!st.ready) return;
  st.cause = kind === 'server' ? 'server' : 'network';
  if (st.offline) return;
  setOffline(true);
  hooks.toast("Your changes couldn't be saved. You're offline.", { kind: 'err', action: 'Try again', onAction: retryNow, ms: 8000, key: 'offline' });
}
/* One recovery or reload at a time. */
function exclusive(fn) {
  if (!st.busy) {
    const run = fn().finally(() => {
      if (st.busy === run) st.busy = null; // not the one of a newer session, if teardown() cleared this one meanwhile
    });
    st.busy = run;
  }
  return st.busy;
}
/* A request that must not hang the recovery loop if the server accepts connections but never answers. */
const ping = () => pb.health.check({ signal: AbortSignal.timeout(5000) });
/* Reacts to a failed reload (or health check). Returns 'offline' when the server cannot be reached or fails on its own (the page is
   offline then, or stays so: a server that 5xxs the reload is no more "back" than one that cannot be reached), 'ended' when the session
   is over, else 'other' (the server answered and said no, or has failed on its own for so long that the page stops waiting for the
   reload: it would stay offline for ever, with no edit saved; see wearyReload(), and recover() for when the page is back online). */
function reloadFailure(err) {
  const kind = classify(err);
  if (kind === 'auth') {
    expire();
    return 'ended';
  }
  if (kind === 'server' && wearyReload()) return 'other';
  if (!failing(kind) && kind !== 'abort') return 'other';
  goOffline(causeOf(err));
  return 'offline';
}
/* Leaves the offline state: the server answers, live updates are back, everything is reloaded and merged, unsent changes are sent.
   The order matters twice.
   - Stream first, reload second. A change reaches this browser by one of two doors: the stream (if the server had the stream's
     subscriptions registered when the change was committed) or the reload (if the change was committed before the reload read the
     records). Opening the stream last left a gap between them: a change committed after the reload read and before the new stream was
     registered came through neither, and the page stayed stale until the next reload. Registering first leaves no gap: whatever was
     committed before it is in the reload, which reads afterwards, and whatever is committed after it is on the stream. A change that
     comes through both is applied once (applyRecord drops an event that is older than the baseline or identical to it). The safety
     net and the password change already work in this order. The stream is replaced rather than trusted, because after an outage the
     old one may be dead without the browser knowing.
     (A second reload once the stream is up would close the gap too, but it makes every recovery do the work of a full reload twice,
     in every browser at once when the server comes back. Reordering costs nothing.)
   - Merge before send. The reload keeps unsent edits (it merges, it does not replace), so what goes out is worked out against the
     server's current copy: only what we really changed, and nothing the server already holds. */
function recover() {
  return exclusive(async () => {
    const gen = st.gen;
    const was = answered;
    let live = false;
    let refused = ''; // what the server said to the reload, when it answered but said no
    let tired = false; // ... and it was not a no, but failing on its own for so long (see wearyReload())
    try {
      await ping();
      if (gen !== st.gen) return false; // signed out meanwhile: no stream for nobody
      live = await streamUp(gen);
      if (gen !== st.gen) return false;
      await resync();
    } catch (err) {
      if (gen !== st.gen) return false;
      const why = reloadFailure(err);
      if (why === 'offline' && classify(err) === 'server') stepSick(); // the server failed on its own: a network failure says nothing
      if (why !== 'other') return false;
      // The server answers but refuses the reload (or has failed on it for so long that it is not worth waiting for). Waiting for it
      // would never end, so carry on with what is loaded: send what is unsent, and go online (see below for a server that fails).
      refused = describe(err);
      tired = classify(err) === 'server';
    }
    // Back online only when the send worked too, or when the server said no to what it was sent; if it failed (cannot be reached, a
    // 5xx) the page stays offline, however well the reload went, and the next try is the poll's.
    if (!(await flush({ recovering: true })) || gen !== st.gen) return false;
    // A server that has failed the reload for so long may be failing every request: having nothing to send (or giving up on what there
    // was) does not show that it is back. Going online then put the page offline again at its next request, and back online at the next
    // try, about every 20 s for as long as the outage lasted. So it stays offline until the server has answered, in this try, a request
    // for this session's data: a list read, or a change it stored or said no to. (Not the stream: that it registered says little about
    // whether records can be read or written.) One list that always fails on a server that otherwise works passes that, the other lists
    // being read, and the page goes on without it.
    if (tired && answered === was) {
      st.cause = 'server'; // reloadFailure() did not note it: the poll backs off as for any server that fails
      return false;
    }
    setOffline(false);
    // "Synced" only when it is: the reload and the send worked, and no change was refused since the page went offline (each was told,
    // with its own toast, and the server's version of the record replaced the change; but one given up on in an earlier try of the
    // poll is as lost as one refused in this send). A stream that would not register does not keep the page offline (the server answers,
    // so changes can be saved, and a proxy that buffers the stream would otherwise never let go): the safety net replaces it and
    // reloads, in under 20 s.
    if (refused) hooks.toast(`Reconnected, but your data could not be reloaded: ${refused}`, { kind: 'err' });
    else if (refusals !== st.refusedAtOffline) hooks.toast("Reconnected, but some changes couldn't be saved.", { kind: 'info' });
    else if (!live) hooks.toast('Reconnected. Live updates will follow shortly.');
    else hooks.toast('Reconnected. All changes are synced.');
    flush(); // whatever was edited while this ran
    return true;
  });
}
/* Reloads and merges, showing nothing unless the server turns out to be unreachable. */
async function reloadQuietly() {
  const gen = st.gen;
  try {
    if (await resync()) hooks.render();
  } catch (err) {
    if (gen !== st.gen) return;
    if (reloadFailure(err) === 'other') console.warn('sync: reload failed', err); // (offline or ended: reloadFailure() has dealt with it)
  }
}
/* After the live stream was down for a moment, events may have been missed. */
export function quietResync() {
  if (!st.ready || st.offline || st.busy) return;
  exclusive(reloadQuietly);
}
export const sessionGen = () => st.gen;
export async function retryNow() {
  if (!st.active) return false;
  if (!st.ready) {
    st.wake?.(); // still waiting for the first load: try now
    return false;
  }
  if (!st.offline) return flush();
  const gen = st.gen;
  const ok = await recover();
  if (gen === st.gen && !ok && st.offline) {
    const why = st.cause === 'server' ? 'The server is having trouble right now' : "Still can't reach the server";
    hooks.toast(`${why}. We'll keep trying.`, { kind: 'err' });
  }
  return ok;
}

/* ---------- start and stop ---------- */
export async function startSync({ boot = false } = {}) {
  if (st.active) await teardown();
  const gen = ++st.gen;
  Object.assign(st, { active: true, ready: false, me: authStore.record?.id || '', queue: [] });
  wholeDoc = false; // a new session finds out again whether the server patches
  loops.clear();
  sick.clear();
  readSick = null;
  resetBase();
  const cancelled = () => Object.assign(new Error('sync stopped'), { cancelled: true });
  try {
    let all;
    let late; // the stream's registration, when the load did not wait for it to finish
    let pause = POLL_MS; // the wait before the next try while the server is down
    let failed = null; // the streak of server errors (see streakOf()): when it is long enough the server's answer is taken as final
    while (!all) {
      try {
        if (boot) await pb.collection('users').authRefresh();
        if (gen !== st.gen) throw cancelled();
        // The stream first, then the load, as in recover(): started together, the load can read a record just before a colleague
        // changes it and the server only then registers the stream, and the change is in neither. What arrives during the load waits in
        // st.queue. A stream that will not connect (a proxy that buffers it) holds the load back for three seconds, not the SDK's fifteen.
        let registered = false;
        const stream = subscribeAll(gen).then(
          ok => (registered = ok),
          err => console.warn('sync: live updates are not connected', err),
        );
        await within(stream, STREAM_WAIT_MS);
        late = registered ? null : stream; // the load below may then have missed a change made before the server took the subscriptions
        all = await loadAll();
      } catch (err) {
        // Before anything below touches the state: a session that was stopped while this waited must not mark its successor offline.
        if (gen !== st.gen) throw cancelled();
        const kind = classify(err);
        if (!boot || !failing(kind)) throw err;
        if (kind === 'server') {
          failed = streakOf(failed, Date.now());
          if (worn(failed)) throw err; // it has failed for a minute in a row: the app says so, instead of showing the skeleton for ever
          console.warn('sync: the server failed while loading; trying again', err);
        }
        setOffline(true); // the server is down or failing: show the offline bar and try again (less often while it is failing)
        await new Promise(resolve => {
          st.wake = resolve;
          setTimeout(resolve, pause);
        });
        pause = kind === 'server' ? Math.min(pause * 2, POLL_MAX_MS) : POLL_MS;
      }
      if (gen !== st.gen) throw cancelled();
    }
    install(all);
    st.ready = true;
    for (const [coll, e] of st.queue.splice(0)) applyEvent(coll, e); // events that arrived during the load
    setOffline(false);
    st.netT = setInterval(safetyNet, NET_MS);
    // The stream came up after the load began: read once more, now that nothing can slip by. (One that never registers is the safety net's.)
    late?.then(ok => ok && gen === st.gen && quietResync());
    return true;
  } catch (err) {
    if (gen === st.gen) await teardown(); // (else the session was torn down already, and a newer one may own the state by now)
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
  clearTimeout(st.pollT);
  clearInterval(st.netT);
  clearTimeout(st.graceT);
  st.wake?.(); // a boot-time wait ends now, and finds that its session is over
  Object.assign(st, {
    pollT: 0,
    netT: 0,
    graceT: 0,
    wake: null,
    offline: false,
    cause: 'network',
    wait: POLL_MS,
    flushing: null,
    again: false,
    busy: null,
    reloading: false,
    queue: [],
    prefsId: '',
    prefsInit: null,
    wsWanted: null,
    rtDown: false,
  });
  S.ui.offline = false;
  resetBase();
  deleted.clear();
  loops.clear();
  sick.clear();
  readSick = null;
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
/* ---------- access that was taken away ----------
   PocketBase sends a client the events of the records it can see, and of those only. When somebody is taken off a private project's
   members, or the project is made private, or an admin stops being one, the project and everything in it stop being visible to
   them, and no event says so: their open page goes on showing them until a reload. So every round of the safety net asks which
   projects the server shows this user (ids only) and lets go of the ones it no longer shows, with everything that hangs off them.
   - Only projects the server has told us about are considered. One we have just created and not yet sent has no baseline entry.
   - A project missing from the answer is asked for by id before it goes: the list may have been read just before it was created, or
     the answer may be wrong. A 404 on its own id is what "cannot see it" looks like; anything else keeps it for this round.
   - Nothing is written to the server. The removal is the ordinary one (removeRecord), so the baseline entries go with the records and
     nothing looks deleted or new, and the work done on those records offline is dropped with them (it could not be saved any more).
   - The removals are recorded in the journal like any change somebody else made. That is what keeps Undo from bringing them back:
     Undo restores a snapshot, which still holds these records, and replays the journal over it, which removes them again. */
const patient = () => ({ signal: AbortSignal.timeout(8000) }); // a request nobody answers ends after 8 s instead of holding the sync lock
async function dropRevoked(gen) {
  let visible;
  try {
    visible = new Set((await pb.collection('projects').getFullList({ fields: 'id', batch: 500, ...patient() })).map(r => r.id));
  } catch (err) {
    if (gen === st.gen && classify(err) === 'auth') expire();
    return; // cannot tell now; the next round asks again
  }
  if (gen !== st.gen) return;
  const known = base.get('projects');
  const missing = D().projects.filter(p => known.has(p.id) && !visible.has(p.id));
  if (!missing.length) return;
  const gone = [];
  let changed = false;
  await Promise.all(
    missing.map(async p => {
      try {
        const rec = await pb.collection('projects').getOne(p.id, patient());
        if (gen === st.gen) changed = applyRecord('projects', rec) || changed; // after all it is visible
      } catch (err) {
        if (err?.status === 404) gone.push(p);
      }
    }),
  );
  if (gen !== st.gen) return;
  if (gone.length) {
    dropProjects(new Set(gone.map(p => p.id)));
    const name = gone.length === 1 ? `“${gone[0].name}”` : `${gone.length} projects`;
    hooks.toast(`You no longer have access to ${name}.`, { kind: 'info', ms: 6000 });
  }
  if (gone.length || changed) hooks.render();
}
/* Removes projects and everything that hangs off them: tasks, their comments, activity, files, events and the user's saved views. */
function dropProjects(ids) {
  const tasks = D()
    .tasks.filter(t => ids.has(t.project))
    .map(t => t.id);
  const inTasks = new Set(tasks);
  const hanging = {
    comments: D().comments.filter(c => inTasks.has(c.task)),
    activity: D().activity.filter(a => ids.has(a.project) || inTasks.has(a.task)),
    files: D().files.filter(f => ids.has(f.project)),
    events: D().events.filter(e => ids.has(e.project)),
    savedViews: D().savedViews.filter(v => ids.has(v.project)),
  };
  for (const [key, list] of Object.entries(hanging)) for (const x of list) removeRecord(key, x.id, true);
  for (const id of tasks) removeRecord('tasks', id, true);
  for (const id of ids) removeRecord('projects', id, true);
}

/* Safety net, every 20 s. The live stream can die without anyone noticing (a server killed behind a proxy, a network that dropped):
   the browser keeps calling it open and no event ever arrives, so the page would go stale in silence. PocketBase forgets a stream's
   client id when it restarts, and answers 404 when asked to confirm the subscriptions of one it does not know. A stream that is
   not confirmed (or never connected, behind a proxy that buffers it) is replaced, and what was missed is reloaded. When the stream is
   confirmed, the round goes on to its other job: asking which projects this user can still see (dropRevoked, above).
   The SDK has no call for "is my stream still known to the server", so this repeats the request it makes itself when it subscribes,
   with its `clientId` and `lastSentSubscriptions`. Those are SDK internals (not in its documented API) that this relies on, which is
   why package.json pins pocketbase to an exact version (0.28.1): look at them again before upgrading. */
const NET_MS = 20000;
function safetyNet() {
  if (!st.ready || st.offline || st.busy) return;
  exclusive(async () => {
    const gen = st.gen;
    try {
      if (!pb.realtime.isConnected) throw Object.assign(new Error('no live stream'), { status: 404 });
      await pb.send('/api/realtime', { method: 'POST', body: { clientId: pb.realtime.clientId, subscriptions: pb.realtime.lastSentSubscriptions } });
    } catch (err) {
      if (gen !== st.gen) return;
      const kind = classify(err);
      if (failing(kind) || kind === 'abort') return goOffline(kind);
      if (kind === 'auth') return expire();
      await streamUp(gen);
      if (gen === st.gen) await reloadQuietly(); // a reload also lets go of what the user can no longer see
      return;
    }
    await dropRevoked(gen);
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
