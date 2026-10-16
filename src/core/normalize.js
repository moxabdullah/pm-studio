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
       null    a task's due and start dates (cleared), estimate, recur, completedAt, archivedAt; a subtask's assignee and due date;
               a template task's estimate and its startOff and dueOff (whole days, 0 included); a project's stageSet (the
               workspace's default set)
       ''      a project's due date, when its date field is emptied in the project settings (days: see day()); a project's stage
               (the first stage of its set)
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
const intOrNull = v => (Number.isInteger(v) ? v : null); // 0 is a value here (a template task that starts on the project's first day)
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
/* The most a template holds: tasks, and subtasks in each task. Copies of TEMPLATE_TASKS_MAX and TEMPLATE_SUBTASKS_MAX in constants.js,
   on purpose: this module imports nothing from the app (sync-map.js and the dev seed script load it in Node). The list is cut before its
   entries are shaped, so a huge one written through the API costs no more than its first n. */
const TEMPLATE_TASKS_MAX = 300;
const TEMPLATE_SUBTASKS_MAX = 50;
const first = (n, fn) => v => fn(arr(v).filter(isObj).slice(0, n));

/* Project stages. The caps are copies of STAGES_MAX, STAGE_NAME_MAX, STAGE_SET_NAME_MAX and STAGE_HISTORY_MAX in constants.js (the
   workspace's limit on stage sets is not here: it is on how many records there are, not on a record), and the colour keys of
   STAGE_COLORS and the keys of HEALTH: change both together, or a record is cut on reading and stays pending for ever. A Set, not
   an object, so that "__proto__" and "constructor" are not colours. */
const STAGES_MAX = 30;
const STAGE_NAME_MAX = 40;
const STAGE_SET_NAME_MAX = 80;
const STAGE_HISTORY_MAX = 200;
const STAGE_ID_MAX = 32;
const STAGE_COLOR_KEYS = new Set(['gray', 'blue', 'violet', 'teal', 'amber', 'rose', 'red', 'green', 'orange']);
const HEALTH_KEYS = new Set(['ok', 'risk', 'hold']);
/* Cut first, then trimmed: the other way round could leave a space at the cut, and normalizing the result again would trim it. */
const capped = n => v => str(v).slice(0, n).trim();
const stageId = v => typeof v === 'string' && v.length > 0 && v.length <= STAGE_ID_MAX;
/* A set's stages in order. A stage without an id (or with an id of one before it) is dropped, since projects point at stages by id;
   one without a name stays, as "Untitled", so the projects in it do not lose their stage. */
const stagesOf = v => {
  const seen = new Set();
  const out = [];
  for (const s of arr(v)) {
    if (out.length >= STAGES_MAX) break;
    if (!isObj(s) || !stageId(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      name: capped(STAGE_NAME_MAX)(s.name) || 'Untitled',
      color: STAGE_COLOR_KEYS.has(s.color) ? s.color : 'gray',
      finished: s.finished === true,
    });
  }
  return out;
};
/* Workspace lists. LABELS_MAX, LABEL_NAME_MAX and LABEL_ID_MAX are copies of the numbers in constants.js (and the colours are
   STAGE_COLOR_KEYS above): change both together, or a list is cut on reading and stays pending for ever. The doc may hold other lists
   (the project fields), and they pass through untouched. `labels` is optional: a record without the key means the built-in labels, and
   `[]` means none, so the key is coerced only when it is there. Task labels are not checked against the list (this module cannot see
   it); a task keeps the id of a label that has gone, and it shows as nothing. */
const LABELS_MAX = 50;
const LABEL_NAME_MAX = 30;
const LABEL_ID_MAX = 32;
const labelId = v => typeof v === 'string' && v.length > 0 && v.length <= LABEL_ID_MAX;
/* A list's labels in order. One without an id (or with an id of one before it, or a longer one than the app makes) is dropped, since
   tasks point at labels by id; one without a name stays, as "Untitled", so the tasks that carry it do not lose it. */
const labelsOf = v => {
  const seen = new Set();
  const out = [];
  for (const l of arr(v)) {
    if (out.length >= LABELS_MAX) break;
    if (!isObj(l) || !labelId(l.id) || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ id: l.id, name: capped(LABEL_NAME_MAX)(l.name) || 'Untitled', color: STAGE_COLOR_KEYS.has(l.color) ? l.color : 'gray' });
  }
  return out;
};
/* The dates are kept as written (new Date().toISOString()): turning them into dates and back would not be a fixed point. */
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/* The newest STAGE_HISTORY_MAX entries that are well formed, oldest first. It reads from the end and stops once it has them, so a
   longer history (the app writes at most the cap) is not read whole. */
const historyOf = v => {
  const a = arr(v);
  const out = [];
  for (let i = a.length - 1; i >= 0 && out.length < STAGE_HISTORY_MAX; i--) {
    const e = a[i];
    if (isObj(e) && stageId(e.stage) && typeof e.at === 'string' && ISO_AT.test(e.at) && !Number.isNaN(Date.parse(e.at)))
      out.push({ stage: e.stage, at: e.at });
  }
  return out.reverse();
};
/* What a project's old `status` becomes: [stage id, health]. A record from before stages has no `stage` and keeps its status. */
const OLD_STATUS = { planning: ['tender', 'ok'], active: ['design', 'ok'], complete: ['closed', 'ok'], risk: ['design', 'risk'], hold: ['design', 'hold'] };

const projectShape = shape(
  {
    id: str, key: str, name: str, icon: str, color: str, team: str, desc: str, members: strs,
    milestones: list(shape({ name: str, date: day }), m => m.date),
    stageSet: ref, stage: str, health: v => (HEALTH_KEYS.has(v) ? v : 'ok'), stageHistory: historyOf,
  },
  {
    workspace: str, lead: ref, due: day, start: day, last: num, seq: num, fav: bool, private: bool, archived: bool, archivedAt: numOrNull,
    perms: strMap(str), access: withDefault(str, 'workspace'),
  },
); // prettier-ignore
/* A project from before stages has `status` and no `stage`: the stage is mapped (OLD_STATUS; an unknown status gives the first stage) only
   then, since shape() adds the stage and a record with a stage (even '') has chosen it. The health the status names is taken whenever
   the record has no health of its own, stage or not: the app writes only the keys that changed, so the first move of an old "On hold"
   project leaves `status` on the server beside the new `stage`, and the project must stay on hold. `status` is not kept. */
function projectOf(r) {
  const old = typeof r.status === 'string' ? (own(OLD_STATUS, r.status) ? OLD_STATUS[r.status] : ['', 'ok']) : null;
  const out = projectShape(old ? { ...r, stage: r.stage === undefined ? old[0] : r.stage, health: HEALTH_KEYS.has(r.health) ? r.health : old[1] } : r);
  delete out.status;
  return out;
}

const KINDS = {
  member: shape({
    id: str, name: withDefault(str, MD.name), email: str, role: withDefault(str, MD.role), team: withDefault(str, MD.team), title: withDefault(str, MD.title),
    c: withDefault(str, MD.c), status: withDefault(str, MD.status), tz: withDefault(str, MD.tz), last: numOrNull,
  }),
  project: projectOf,
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
  activity: shape({ id: str, verb: str, at: num, extra: str }, { by: ref, task: ref, project: ref, workspace: ref }),
  notif: shape({ id: str, type: withDefault(str, 'update'), text: str, snippet: str, at: num, read: bool }, { by: ref, task: ref, project: ref }),
  file: shape({ id: str, project: str, name: str, type: withDefault(str, 'other'), size: str, at: num }, { by: ref, task: ref }),
  event: shape({ id: str, title: str, date: v => day(v) || '', time: str, project: str }),
  savedView: shape({
    id: str, project: str, name: str, type: withDefault(str, 'list'),
    filters: list(shape({ f: str, op: v => (v === 'not' ? 'not' : 'is'), v: strs }), f => f.f),
  }),
  team: shape({ id: str, name: str, desc: str, icon: str, c: str }, { workspace: str }),
  template: shape(
    {
      id: str, name: str, desc: str, icon: str, color: str,
      tasks: first(
        TEMPLATE_TASKS_MAX,
        list(
          shape({
            title: str, status: withDefault(str, 'todo'), priority: withDefault(str, 'none'), estimate: text, desc: str, labels: strs,
            subtasks: first(TEMPLATE_SUBTASKS_MAX, list(shape({ title: str }))), startOff: intOrNull, dueOff: intOrNull,
          }),
        ),
      ),
    },
    { workspace: str, updated: num },
  ),
  stageSet: shape({ id: str, name: capped(STAGE_SET_NAME_MAX), stages: stagesOf }, { workspace: str, created: str }),
  workspaceList: shape({ id: str }, { workspace: str, created: str, labels: labelsOf }),
  workspace: shape({ id: str, name: str, c: str }, { url: str, brand: bool }),
}; // prettier-ignore

/* The keys of S.data (and so of sync-map's COLLECTIONS) name the same kinds in the plural. */
const KIND_OF = {
  members: 'member', projects: 'project', tasks: 'task', comments: 'comment', activity: 'activity', notifs: 'notif', files: 'file',
  events: 'event', savedViews: 'savedView', teams: 'team', templates: 'template', stageSets: 'stageSet', workspaceLists: 'workspaceList', workspaces: 'workspace',
}; // prettier-ignore

/* One record. `kind` is member, project, task, comment, activity, notif, file, event, savedView, team, template, stageSet, workspaceList or
   workspace, or the S.data key of that list (members, projects, tasks, ..., savedViews, teams, templates, stageSets, workspaceLists,
   workspaces), so a caller that knows the collection can pass keyOf(coll). Returns a new object; the argument is not touched. Throws on any other kind. */
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
  if (d.templates !== undefined) each('templates', 'template');
  if (d.stageSets !== undefined) each('stageSets', 'stageSet');
  if (d.workspaceLists !== undefined) each('workspaceLists', 'workspaceList');
  d.projOrder = strs(d.projOrder);
  d.recentSearches = strs(d.recentSearches);
  d.me = str(d.me);
  d.notifPrefs = strMap(bool)(d.notifPrefs);
  d.ws = shape({ name: str, url: str, c: str }, { id: str, brand: bool })(isObj(d.ws) ? d.ws : {});
  return d;
}
