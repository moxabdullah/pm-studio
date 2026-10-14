/* =====================================================================
   NORMALIZE: give records from the server the shape the UI expects.
   Any signed-in user can store arbitrary JSON in a record's `doc`, and an admin can create a task in the PocketBase dashboard with
   only a project and a status, so a record can arrive with `labels: null`, `subtasks: 'x'`, `due: {x: 1}` or no doc at all.
   Templates and the store call .map, .includes and .toLowerCase on these fields; one wrong type throws, and the page (or the
   sidebar) is blank for everyone who loads it. Fields the UI always reads are coerced to their type and added when missing;
   optional fields are coerced only when present; unknown fields are kept. This is about not crashing, not about markup: text still
   goes through esc() and colours through safeColor() where they are rendered.

   Where it runs: fromRecord() in sync-map.js ends with normalizeRecord(), so every record that reaches S.data has passed through it:
   the first load, live updates, reloads after an outage, refetches after a rejected change, adopt() and the replay of remote changes
   in Undo. (user_prefs has no app key and is not normalized.) normalizeData() does the same for a whole S.data object; the sync
   engine does not use it.

   Rules that keep this from fighting the sync engine, whose baseline for a record is toRecord(fromRecord(rec)):
   - Idempotent: normalizing a normalized record changes nothing (patchObject() runs a payload that is already normal through
     fromRecord() again).
   - The app's own values come out unchanged. Whatever the app writes (src/actions, the overlays, drag and drop, seed()) must be a
     fixed point, or the record would differ from its baseline for ever and be sent again and again (sync.js has a guard for that,
     stuck(), which must never be needed for ordinary data). So each coercer keeps the forms the app uses for "nothing":
       null    a task's due and start dates (cleared), estimate, recur, completedAt, archivedAt; a subtask's assignee and due date
       ''      a project's due date, when its date field is emptied in the project settings (days: see day())
       []/{}   labels, deps, subtasks, attachments, milestones, perms, a comment's reactions (also one emoji's list once everybody
               took theirs back)
     and passes on, untouched, what no coercer names (task.prevStatus ...). Changing a coercer means checking it against what the app
     writes.
   - A field is "required" (added when missing) only if the app writes it itself whenever it creates that kind of record (createTask,
     createProject ... and seed()). Anything the app can leave out is optional, even when the UI reads it, because adding it here would
     make the record differ from what the app wrote. Example: project.perms and project.access are optional because createProject()
     does not write them; the share dialog adds them to the project when it is opened.
   - Per-user state is never added. `fav` on projects and tasks lives in user_prefs: fromRecord() leaves it out and applyFavs() puts
     it back, so it is coerced only when present. A fav: false added here would make the in-place patch of a remote update (sync.js
     patchObject) clear the user's favourite.
   - A member's defaults are sync-map's: MEMBER_DEFAULTS is the one table, used there for accounts created by hand and here for
     bad values, so the two give the same answer.
   ===================================================================== */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const ref = v => (typeof v === 'string' && v ? v : null); // an id, or nothing
const text = v => (typeof v === 'string' && v ? v : null); // free text that may be absent
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = v => v === true;
/* A calendar day as the app stores it, 'YYYY-MM-DD'. "No date" has two spellings that the app writes and that stay as they are: null
   (a task's due date once cleared) and '' (the project settings form with its date field emptied). Anything else is not a day, and
   neither is a date that does not exist (2025-02-31): parse() would roll it over into March. */
const real = s => {
  const [y, m, d] = s.split('-').map(Number);
  // in UTC, not local time as parse() builds it: in a zone that skipped a day (Samoa, 2011-12-30) a real date would be dropped
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const day = v => ((typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && real(v)) || v === null || v === '' ? v : null);
const arr = v => (Array.isArray(v) ? v : []);
const strs = v => arr(v).filter(x => typeof x === 'string');
const withDefault = (fn, d) => v => fn(v) || d;
const list = (shape, keep) => v =>
  arr(v)
    .filter(isObj)
    .map(shape)
    .filter(keep || Boolean);
const strMap = fn => v => {
  const out = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (k !== '__proto__') out[k] = fn(x);
  return out;
};

/* shape(req, opt): a coercer for one record. `req` fields always exist afterwards; `opt` fields are coerced only if present. */
const shape =
  (req, opt = {}) =>
  r => {
    const out = { ...r };
    delete out.__proto__; // an own "__proto__" key would rewrite the prototype on a later Object.assign
    for (const k in req) out[k] = req[k](r[k]);
    for (const k in opt) if (r[k] !== undefined) out[k] = opt[k](r[k]);
    return out;
  };

/* What a member reads as when the account leaves it blank (accounts are created by hand in the PocketBase dashboard with little
   more than an email and a password) or holds something that is not text. sync-map.js decodes users with the same table. */
export const MEMBER_DEFAULTS = Object.freeze({
  name: 'Unnamed user',
  role: 'Member',
  title: '',
  team: '',
  c: '#6B7280',
  status: 'active',
  tz: '\u2014',
  last: null,
});
const MD = MEMBER_DEFAULTS;

const KINDS = {
  member: shape({
    id: str, name: withDefault(str, MD.name), email: str, role: withDefault(str, MD.role), team: withDefault(str, MD.team), title: withDefault(str, MD.title),
    c: withDefault(str, MD.c), status: withDefault(str, MD.status), tz: withDefault(str, MD.tz), last: numOrNull,
  }),
  project: shape(
    {
      id: str, key: str, name: str, icon: str, color: str, status: withDefault(str, 'planning'), team: str, desc: str, members: strs,
      milestones: list(shape({ name: str, date: day }), m => m.date),
    },
    {
      workspace: str, lead: ref, due: day, start: day, last: num, seq: num, fav: bool, private: bool, archived: bool, archivedAt: numOrNull,
      perms: strMap(str), access: withDefault(str, 'workspace'),
    },
  ),
  task: shape(
    {
      id: str, key: str, project: str, title: str, status: withDefault(str, 'todo'), priority: withDefault(str, 'none'), labels: strs, deps: strs, desc: str,
      created: num, updated: num, order: num,
      subtasks: list(shape({ id: str, title: str, done: bool }, { assignee: ref, due: day, note: str })),
      attachments: list(shape({ id: str, name: str, type: withDefault(str, 'other'), size: str, at: num }, { by: ref })),
    },
    { assignee: ref, due: day, start: day, estimate: text, recur: text, fav: bool, archived: bool, archivedAt: numOrNull, completedAt: numOrNull },
  ),
  comment: shape({ id: str, task: str, text: str, at: num, re: strMap(strs) }, { by: ref }),
  activity: shape({ id: str, verb: str, at: num, extra: str }, { by: ref, task: ref, project: ref }),
  notif: shape({ id: str, type: withDefault(str, 'update'), text: str, snippet: str, at: num, read: bool }, { by: ref, task: ref, project: ref }),
  file: shape({ id: str, project: str, name: str, type: withDefault(str, 'other'), size: str, at: num }, { by: ref, task: ref }),
  event: shape({ id: str, title: str, date: v => day(v) || '', time: str, project: str }),
  savedView: shape({
    id: str, project: str, name: str, type: withDefault(str, 'list'),
    filters: list(shape({ f: str, op: v => (v === 'not' ? 'not' : 'is'), v: strs }), f => f.f),
  }),
  team: shape({ id: str, name: str, desc: str, icon: str, c: str }, { workspace: str }),
  workspace: shape({ id: str, name: str, c: str }, { url: str, brand: bool }),
}; // prettier-ignore

/* The keys of S.data (and so of sync-map's COLLECTIONS) name the same kinds in the plural. */
const KIND_OF = {
  members: 'member', projects: 'project', tasks: 'task', comments: 'comment', activity: 'activity', notifs: 'notif', files: 'file',
  events: 'event', savedViews: 'savedView', teams: 'team', workspaces: 'workspace',
}; // prettier-ignore

/* One record. `kind` is member, project, task, comment, activity, notif, file, event, savedView, team or workspace, or the
   S.data key of that list (members, projects, tasks, ..., savedViews, teams, workspaces), so a caller that knows the
   collection can pass keyOf(coll). Returns a new object; the argument is not touched. Throws on any other kind. */
export function normalizeRecord(kind, rec) {
  const name = own(KIND_OF, kind) ? KIND_OF[kind] : kind;
  if (!own(KINDS, name)) throw new Error(`normalize: unknown kind "${kind}"`);
  return KINDS[name](isObj(rec) ? rec : {});
}

/* The whole S.data object, in place. Records without an id are dropped. */
export function normalizeData(d) {
  const each = (key, kind) => {
    d[key] = arr(d[key])
      .filter(isObj)
      .map(KINDS[kind])
      .filter(r => r.id);
  };
  each('members', 'member');
  each('projects', 'project');
  each('tasks', 'task');
  each('comments', 'comment');
  each('activity', 'activity');
  each('notifs', 'notif');
  each('files', 'file');
  each('events', 'event');
  each('savedViews', 'savedView');
  each('workspaces', 'workspace');
  if (d.teams !== undefined) each('teams', 'team');
  d.projOrder = strs(d.projOrder);
  d.recentSearches = strs(d.recentSearches);
  d.me = str(d.me);
  d.notifPrefs = strMap(bool)(d.notifPrefs);
  d.ws = shape({ name: str, url: str, c: str }, { id: str, brand: bool })(isObj(d.ws) ? d.ws : {});
  return d;
}
