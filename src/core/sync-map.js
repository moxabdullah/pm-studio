/* ---------- sync-map: app objects <-> PocketBase records ----------
   The data contract between the app (the shapes seed() returns and the UI mutates) and the PocketBase collections defined in
   server/pb_migrations. Pure functions only: no DOM, and no imports from other app modules but normalize.js (also pure). The browser
   sync engine (src/core/sync.js) and scripts/seed-dev.js both build on it, so records seeded in development have exactly the shape
   the app syncs.

   Every record is { id, ...columns, doc }. The columns are what PocketBase needs for filtering and access rules (relations, status,
   flags). `doc` is the rest of the app object as-is. Fields of the app object that are not columns therefore need no mapping.

   COLLECTIONS   ordered list of { key, coll, updateOnly? } for the array-backed collections: `key` is the property on S.data, `coll`
                 the PocketBase collection. Parents come first, so creating in this order and deleting in reverse satisfies every relation.
                   members->users (first; the app only ever UPDATES users: admins create accounts in PocketBase),
                   workspaces, teams, projects, tasks, comments, activity, notifs, files, events, savedViews->saved_views
   USER_PREFS    'user_prefs': the one composite collection, see buildUserPrefs/applyUserPrefs. Not an array on S.data.
   keyOf(coll)   app key for a PocketBase collection name ('saved_views' -> 'savedViews'); null if not synced
   collOf(key)   PocketBase collection name for an app key

   Everything below takes `coll` as either the app key or the collection name ('savedViews' or 'saved_views').

   toRecord(coll, obj, ctx)     -> payload for create/update: { id, ...columns, doc }.
       ctx.me     the signed-in user's id. Fills notifs.recipient, saved_views.owner and user_prefs.user, which app objects don't carry.
                  Throws when it is missing for those collections.
       ctx.order  index of the project in D().projOrder (the app keeps order there, not on the project). Fills projects.order.
     The payload is a fresh, JSON-safe copy (nothing aliases the app object), so it can be stored as a snapshot. Top-level key order
     is fixed. Empties are normalised: null/undefined/'' relations -> '', booleans via !!, missing lists -> []. `doc` keeps the app's
     own key order, but PocketBase hands JSON back with the keys of every object sorted, so key order never survives a round trip
     (e.g. the emoji order of a comment's `re`). Compare payloads with samePayload()/stableStringify(), never with JSON.stringify.
     Never in the payload: `fav` on projects and tasks (per user, see user_prefs), `order` on projects (a column), the stored file
     name of files (`file`; uploads travel as multipart form data), and email/password/verified of users.
   fromRecord(coll, rec)        -> app object: { id, ...columns, ...rec.doc } (columns win over doc). Also a fresh copy.
     System fields (collectionId, collectionName, created, updated, expand, ...) are ignored; the app's own created/updated/at
     numbers live inside doc and are untouched. Empty relations come back as null for assignee, lead and activity.project/task/by,
     comments.by and files.by, and as '' for team and workspace. Extras: members keep `email` ('' when the account hides it);
     files get `file`, the stored file name for download URLs (see fileUrl in pb.js). Not restored: `fav` (call applyFavs / applyUserPrefs).
     Members get defaults for what a dashboard-created account leaves blank (MEMBER_DEFAULTS, one table shared with normalize.js):
     c '#6B7280', status 'active', role 'Member', title '', team '', tz '\u2014' (an em dash), last null, and name = the email's local
     part ('Unnamed user' when the email is hidden too).
     toRecord leaves those defaults out again, so a bare account loads, round-trips and saves without anyone writing a value they
     didn't choose (a stored role is always sent: roles are never blank, see server/pb_hooks/users_defaults.pb.js).
     Normalized: the object ends up in normalizeRecord() (normalize.js), because any signed-in user can store any JSON in `doc`: a
     value of the wrong type (labels: null, subtasks: 'x', due: {x: 1}) is coerced and a missing one is added, so no record can
     break a page for everyone. Every other path to S.data (load, live update, reload, adopt, undo) goes through fromRecord, so
     that is the one place. user_prefs has no app key and goes through cleanPrefs() instead (below). The object that comes out is the app's own form
     again under toRecord(): toRecord(fromRecord(toRecord(x))) is toRecord(x) for everything the app writes, and the sync baseline
     (toRecord(fromRecord(rec))) is what the app's copy of an unchanged record produces, so a malformed record is never written back.
   toRecords(coll, data)        -> payloads for every object of data[key], with ctx (me, order) filled from `data`.
   toFormData(payload, blob, filename)
                                -> the payload as multipart FormData plus the upload in the `file` field. Use it to create a files
                                   record (objects such as `doc` travel as JSON strings). Updates without a new upload can send the
                                   plain JSON payload.
   stableStringify(v)           JSON with object keys sorted at every level (same content -> same string).
   samePayload(a, b)            stableStringify(a) === stableStringify(b); the check to use when diffing against a snapshot.
     Snapshot what was loaded as toRecord(fromRecord(rec)), never as the raw record: defaults, normalization, `doc: null` -> {} and the
     boolean flags are then part of the baseline and can't look like a change.
   projOrderFrom(records)       ids of project records (anything with { id, order }) sorted by order: rebuilds D().projOrder.

   Field names that differ: comments.by <-> author, files.by <-> uploaded_by, members.c <-> color, workspaces.c <-> color.
   Roles: app 'Owner'/'Admin' <-> 'admin', 'Manager' <-> 'manager', 'Member'/'Guest' <-> 'member'; unknown or empty -> member / 'Member'.
     serverRole(appRole), appRole(serverRole)

   user_prefs: one record per user holding what is personal. The app-side object is { id, prefs, views, collapsed, notifPrefs,
   recentSearches, ws, favs } where favs = { projects: [ids], tasks: [ids] }; toRecord/fromRecord treat everything but `id` as doc.
   DEFAULT_PREFS                what each setting is until the user changes it (the page's S.prefs starts as a copy, store.js)
   buildUserPrefs(S, id)        -> that object from the live store: S.prefs, S.views, S.ui.collapsed, S.data.notifPrefs,
                                   S.data.recentSearches, S.data.ws.id and the favourites (fav flags, ids sorted). `id` is the record
                                   id (omit it before the record exists).
   applyUserPrefs(S, obj)       sets those back on the store (prefs merged into S.prefs, a value only when prefOk() accepts
                                   it; a workspace id that is not loaded is ignored) and stamps `fav` on every loaded project and
                                   task. Parts missing from `obj` are left alone.
   Settings are as untrusted as any doc: fromRecord() runs the user_prefs record through cleanPrefs(), which drops a part of the wrong
   type (and the wrong-typed entries of a list or map), so the store never holds, say, recentSearches that is not a list. The one
   exception is `prefs`: a key the record lacks, or holds with a value prefOk() refuses, reads as its default (DEFAULT_PREFS), so a
   record from before a setting existed, or a thin one like the dev seed's, reads as the page's own settings.
   applyFavs(data, favs)        only the fav flags: sets fav = true/false on every project and task of `data` (call after a remote
                                   change to a project/task, since fromRecord does not restore it).
   wsFromWorkspace(w)           -> the D().ws object { id, name, url, c, brand } for a workspaces entry. */

import { MEMBER_DEFAULTS, normalizeRecord } from './normalize.js';

/* ---------- helpers ---------- */
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const str = v => (v == null ? '' : String(v));
const flag = v => !!v;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const id = v => (v ? String(v) : '');
const ids = v => [...new Set((Array.isArray(v) ? v : []).filter(Boolean).map(String))];

const ROLE_TO_SERVER = { owner: 'admin', admin: 'admin', manager: 'manager', member: 'member', guest: 'member' };
const ROLE_TO_APP = { admin: 'Admin', manager: 'Manager', member: 'Member' };
export const serverRole = r => ROLE_TO_SERVER[String(r ?? '').toLowerCase()] || 'member';
export const appRole = r => ROLE_TO_APP[String(r ?? '').toLowerCase()] || 'Member';

/* Column codecs: to() normalises an app value for the payload, from() turns a record value back into the app's. */
const TEXT = { to: str, from: str };
const FLAG = { to: flag, from: flag };
const NUM = { to: num, from: num };
const IDS = { to: ids, from: ids };
const ONE = empty => ({ to: id, from: v => id(v) || empty }); // one relation; `empty` is how the app writes "none"
const ROLE = { to: serverRole, from: appRole };

/* Accounts that admins create by hand in the dashboard have a blank colour, status and doc. Members read back with the values the
   app expects, and those values are left out of the payload again: a loaded account never differs from itself because of its
   defaults, and the app never writes a value nobody chose. */
const MEMBER_COLOR = MEMBER_DEFAULTS.c;
const UNNAMED = MEMBER_DEFAULTS.name;
const localPart = email => String(email || '').split('@')[0];
const BLANKABLE = fallback => ({ to: v => (v == null || v === '' || v === fallback ? '' : String(v)), from: v => str(v) || fallback });
const isDefault = (value, fallback) => value === fallback || (typeof fallback === 'string' && value === '');

/* One entry per collection.
   cols     [appKey, column, codec] in payload order
   ctxCols  [ctxKey, column, codec, required] columns the app object doesn't carry
   readOnly [appKey, column] read back by fromRecord but never sent
   skip     app keys that are kept out of doc (and out of the payload)
   docDefaults { docKey: value } what a missing doc key reads as; a doc key holding that value is not written
   afterRead(out) / beforeWrite(payload, obj)  last touches for fromRecord / toRecord */
const SPECS = {
  members: {
    key: 'members',
    coll: 'users',
    updateOnly: true,
    cols: [
      ['name', 'name', TEXT],
      ['title', 'title', TEXT],
      ['c', 'color', BLANKABLE(MEMBER_COLOR)],
      ['status', 'status', BLANKABLE(MEMBER_DEFAULTS.status)],
      ['role', 'role', ROLE],
    ],
    readOnly: [['email', 'email']],
    skip: ['email', 'password', 'passwordConfirm', 'verified'],
    docDefaults: { team: MEMBER_DEFAULTS.team, tz: MEMBER_DEFAULTS.tz, last: MEMBER_DEFAULTS.last },
    // no name: the email's local part, or a placeholder when the account hides its email too
    afterRead: out => {
      out.name = out.name || localPart(out.email) || UNNAMED;
    },
    beforeWrite: (out, obj) => {
      if (out.name === UNNAMED || (obj.email && out.name === localPart(obj.email))) out.name = '';
    },
  },
  workspaces: {
    key: 'workspaces',
    coll: 'workspaces',
    cols: [
      ['name', 'name', TEXT],
      ['c', 'color', TEXT],
    ],
  },
  teams: {
    key: 'teams',
    coll: 'teams',
    cols: [
      ['workspace', 'workspace', ONE('')],
      ['name', 'name', TEXT],
    ],
  },
  projects: {
    key: 'projects',
    coll: 'projects',
    cols: [
      ['workspace', 'workspace', ONE('')],
      ['team', 'team', ONE('')],
      ['lead', 'lead', ONE(null)],
      ['private', 'private', FLAG],
      ['members', 'members', IDS],
      ['archived', 'archived', FLAG],
    ],
    ctxCols: [['order', 'order', NUM, false]],
    skip: ['fav', 'order'],
  },
  tasks: {
    key: 'tasks',
    coll: 'tasks',
    cols: [
      ['project', 'project', ONE('')],
      ['status', 'status', TEXT],
      ['assignee', 'assignee', ONE(null)],
      ['archived', 'archived', FLAG],
    ],
    skip: ['fav'],
  },
  comments: {
    key: 'comments',
    coll: 'comments',
    cols: [
      ['task', 'task', ONE('')],
      ['by', 'author', ONE(null)],
    ],
  },
  activity: {
    key: 'activity',
    coll: 'activity',
    cols: [
      ['project', 'project', ONE(null)],
      ['task', 'task', ONE(null)],
      ['by', 'by', ONE(null)],
    ],
  },
  notifs: {
    key: 'notifs',
    coll: 'notifs',
    cols: [],
    ctxCols: [['me', 'recipient', ONE(''), true]],
  },
  files: {
    key: 'files',
    coll: 'files',
    cols: [
      ['project', 'project', ONE('')],
      ['by', 'uploaded_by', ONE(null)],
    ],
    readOnly: [['file', 'file']],
    skip: ['file'],
  },
  events: {
    key: 'events',
    coll: 'events',
    cols: [['project', 'project', ONE('')]],
  },
  savedViews: {
    key: 'savedViews',
    coll: 'saved_views',
    cols: [['project', 'project', ONE('')]],
    ctxCols: [['me', 'owner', ONE(''), true]],
  },
  user_prefs: {
    key: null,
    coll: 'user_prefs',
    cols: [],
    ctxCols: [['me', 'user', ONE(''), true]],
  },
};

/* Create order: parents first. Everything may point at a user, so users come first. */
const ORDER = ['members', 'workspaces', 'teams', 'projects', 'tasks', 'comments', 'activity', 'notifs', 'files', 'events', 'savedViews'];
export const COLLECTIONS = Object.freeze(
  ORDER.map(k => {
    const s = SPECS[k];
    return Object.freeze(s.updateOnly ? { key: s.key, coll: s.coll, updateOnly: true } : { key: s.key, coll: s.coll });
  }),
);
export const USER_PREFS = 'user_prefs';

const LOOKUP = new Map(Object.values(SPECS).flatMap(s => [[s.coll, s], ...(s.key ? [[s.key, s]] : [])]));
function specOf(coll) {
  const s = LOOKUP.get(coll);
  if (!s) throw new Error(`sync-map: unknown collection "${coll}"`);
  return s;
}
export const keyOf = coll => LOOKUP.get(coll)?.key ?? null;
export const collOf = key => specOf(key).coll;

/* ---------- records <-> objects ---------- */
function docOf(rec) {
  let d = rec?.doc;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      d = null;
    }
  }
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

export function toRecord(coll, obj, ctx = {}) {
  const s = specOf(coll);
  const out = { id: obj.id };
  const claimed = new Set(['id', ...(s.skip || [])]);
  for (const [appKey, column, codec] of s.cols) {
    out[column] = codec.to(obj[appKey]);
    claimed.add(appKey);
  }
  for (const [ctxKey, column, codec, required] of s.ctxCols || []) {
    if (required && !ctx[ctxKey]) throw new Error(`sync-map: toRecord(${s.coll}) needs ctx.${ctxKey}`);
    out[column] = codec.to(ctx[ctxKey]);
  }
  s.beforeWrite?.(out, obj);
  const rest = {};
  for (const k of Object.keys(obj)) if (!claimed.has(k) && obj[k] !== undefined) rest[k] = obj[k];
  for (const [k, fallback] of Object.entries(s.docDefaults || {})) if (k in rest && isDefault(rest[k], fallback)) delete rest[k];
  out.doc = clone(rest);
  return out;
}

export function fromRecord(coll, rec) {
  const s = specOf(coll);
  const out = Object.assign({ id: rec.id }, clone(docOf(rec)));
  for (const k of s.skip || []) delete out[k];
  for (const [k, fallback] of Object.entries(s.docDefaults || {})) if (out[k] === undefined || isDefault(out[k], fallback)) out[k] = fallback;
  for (const [appKey, column, codec] of s.cols) out[appKey] = codec.from(rec[column]);
  for (const [appKey, column] of s.readOnly || []) out[appKey] = str(rec[column]);
  s.afterRead?.(out);
  out.id = rec.id;
  return s.key ? normalizeRecord(s.key, out) : cleanPrefs(out); // user_prefs is not an app record
}

export function toRecords(coll, data) {
  const s = specOf(coll);
  if (!s.key) throw new Error(`sync-map: ${s.coll} is not a list on S.data; use buildUserPrefs()`);
  const list = data[s.key] || [];
  const ctx = { me: data.me };
  if (s.key !== 'projects') return list.map(obj => toRecord(s.key, obj, ctx));
  const at = new Map((data.projOrder || []).map((pid, i) => [pid, i]));
  return list.map((obj, i) => toRecord(s.key, obj, { me: data.me, order: at.has(obj.id) ? at.get(obj.id) : at.size + i }));
}

export function projOrderFrom(records) {
  return [...records].sort((a, b) => num(a.order) - num(b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => r.id);
}

export function toFormData(payload, blob, filename) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) value.forEach(item => form.append(key, String(item)));
    else form.append(key, value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''));
  }
  if (blob) form.append('file', blob, filename);
  return form;
}

/* ---------- comparing ---------- */
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
export const stableStringify = v =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(byKey)) : x));
export const samePayload = (a, b) => stableStringify(a) === stableStringify(b);

/* ---------- per-user data ---------- */
export function applyFavs(data, favs) {
  const projects = new Set(favs?.projects || []);
  const tasks = new Set(favs?.tasks || []);
  for (const p of data.projects || []) p.fav = projects.has(p.id);
  for (const t of data.tasks || []) t.fav = tasks.has(t.id);
}

export function wsFromWorkspace(w) {
  return {
    id: w.id,
    name: w.name,
    url:
      w.url ||
      String(w.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ''),
    c: w.c,
    brand: !!w.brand,
  };
}

/* What each setting is until the user changes it, and what a record reads as for a setting it lacks or holds with a value prefOk()
   refuses. The page starts from these too (store.js), so a record without a key reads as the page's own copy and the key is not an
   unsent change. Every setting the page writes needs one, equal to what its readers take an unset value for (`|| 'board'`,
   `!== false`, `!!`): without it, a value of any simple type gets in (a number tab breaks the project page), and a refused change to
   the setting cannot be put back, since the record's copy lacks it. */
export const DEFAULT_PREFS = {
  theme: 'system',
  accent: 'indigo',
  side: 'comfortable',
  density: 'comfortable',
  weekStart: 1,
  dateFmt: 'MMM d',
  timeFmt: '12',
  lang: 'English (US)',
  tz: '(GMT-07:00) Pacific Time',
  motion: 'system',
  spell: true,
  home: 'home',
  openTasks: 'drawer',
  defaultTab: 'board',
  showDoneBoard: true,
  permCreate: true,
  permPublic: false,
  confirmDel: true,
};
/* Is `v` a value the setting `k` may hold? A setting keeps the type of its default (a week start that is not a number would break the
   calendar); a key without a default may be anything simple, except "__proto__": S.prefs cannot hold it as a key, so a record that
   kept it would never match the page's copy. */
function prefOk(k, v) {
  if (k === '__proto__') return false;
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, k)) return ['string', 'number', 'boolean'].includes(typeof v);
  // the week start also indexes the weekday names, so only a whole day from 0 to 6 will do
  return typeof v === typeof DEFAULT_PREFS[k] && (k !== 'weekStart' || (Number.isInteger(v) && v >= 0 && v <= 6));
}

/* A user_prefs object as read from the server, with every part of the wrong type dropped, so applyUserPrefs() leaves what the store
   already holds for it (the defaults, at sign-in). Lists and maps keep their well-formed entries. The settings are the exception: they
   come out whole, DEFAULT_PREFS with the record's well-formed entries over it, so a key the record lacks (an older record, the dev seed's
   `prefs: {}`) reads as its default. The baseline of a loaded record is then the settings the page builds for itself, and a thin record
   does not look like an unsent change. What the app writes comes out unchanged (buildUserPrefs()'s shapes, the views viewOf() makes),
   so cleaning never makes a record differ from its baseline. */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const texts = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
// The filter fields and groupings the view engine knows: the keys of FIELDS and the cases of groupTasks() in shell/view-engine.js.
// Any other name makes the filter chips or the grouping throw. Keep these in step with that file.
const VIEW_FIELDS = ['status', 'assignee', 'priority', 'due', 'project', 'labels', 'created', 'updated'];
const VIEW_GROUPS = ['status', 'priority', 'assignee', 'project', 'due', 'none'];
// A view's state as the table, board and filter menus read it: they call .every, .includes, .map, .join and .toLowerCase on these, turn
// column widths into numbers, and read .sort.f (an unknown sort falls back to manual order).
const wellFormedView = v =>
  isObj(v) &&
  Array.isArray(v.filters) &&
  v.filters.every(f => isObj(f) && VIEW_FIELDS.includes(f.f) && Array.isArray(f.v) && f.v.every(x => typeof x === 'string')) &&
  isObj(v.sort) &&
  typeof v.sort.f === 'string' &&
  VIEW_GROUPS.includes(v.group) &&
  typeof v.q === 'string' &&
  Array.isArray(v.hidden) &&
  isObj(v.colW) &&
  Object.values(v.colW).every(x => Number.isFinite(x) && x >= 0);
function cleanPrefs(obj) {
  const out = { ...obj };
  const fix = (k, ok, make = x => x) => {
    if (out[k] === undefined) return;
    if (ok(out[k])) out[k] = make(out[k]);
    else delete out[k];
  };
  // fromEntries: an own "__proto__" key stays a plain key
  const only = (map, ok) => Object.fromEntries(Object.entries(map).filter(([, x]) => ok(x)));
  // (not fix(): the settings are there even when the record has none, and spread, like fromEntries, keeps "__proto__" a plain key)
  out.prefs = { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(isObj(out.prefs) ? out.prefs : {}).filter(([k, x]) => prefOk(k, x))) };
  fix('views', isObj, m => only(m, wellFormedView));
  fix('collapsed', x => typeof x === 'boolean');
  fix('notifPrefs', isObj, m => only(m, x => typeof x === 'boolean'));
  fix('recentSearches', Array.isArray, texts);
  fix('ws', x => typeof x === 'string');
  fix('favs', isObj, f => ({ projects: texts(f.projects), tasks: texts(f.tasks) }));
  return out;
}

export function buildUserPrefs(S, recordId) {
  const d = S.data;
  const favIds = list =>
    list
      .filter(x => x.fav)
      .map(x => x.id)
      .sort();
  const out = recordId ? { id: recordId } : {};
  return Object.assign(out, {
    prefs: clone(S.prefs || {}),
    views: clone(S.views || {}),
    collapsed: !!S.ui?.collapsed,
    notifPrefs: clone(d.notifPrefs || {}),
    recentSearches: clone(d.recentSearches || []),
    ws: d.ws?.id || '',
    favs: { projects: favIds(d.projects || []), tasks: favIds(d.tasks || []) },
  });
}

export function applyUserPrefs(S, obj) {
  const d = S.data;
  if (isObj(obj.prefs)) {
    // only what prefOk() accepts, which never includes "__proto__", so nothing is assigned through S.prefs.__proto__
    for (const [k, v] of Object.entries(obj.prefs)) if (prefOk(k, v)) S.prefs[k] = v;
  }
  if (obj.views) S.views = clone(obj.views);
  if (obj.collapsed !== undefined) S.ui.collapsed = !!obj.collapsed;
  if (obj.notifPrefs) d.notifPrefs = clone(obj.notifPrefs);
  if (obj.recentSearches) d.recentSearches = clone(obj.recentSearches);
  const w = obj.ws && (d.workspaces || []).find(x => x.id === obj.ws);
  if (w) d.ws = wsFromWorkspace(w);
  if (obj.favs) applyFavs(d, obj.favs);
}
