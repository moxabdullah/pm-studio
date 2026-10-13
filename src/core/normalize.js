/* =====================================================================
   NORMALIZE: give records from the server the shape the UI expects.
   Any signed-in user can store arbitrary JSON in a record's `doc`, so a task can arrive with `labels: null`
   or `title: {}`. Templates and the store call .map, .includes and .toLowerCase on these fields; one wrong
   type throws, and the page (or the sidebar) is blank for everyone who loads it.
   Run each record through normalizeRecord() when it is loaded or patched, before it reaches S.data, or the
   whole workspace through normalizeData(). Fields the UI always reads are coerced to their type and added when
   missing; optional fields are coerced only when present; unknown fields are kept. Well-formed data, such as
   seed(), comes out unchanged.
   ===================================================================== */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const ref = v => (typeof v === 'string' && v ? v : null); // an id, or nothing
const text = v => (typeof v === 'string' && v ? v : null); // free text that may be absent
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = v => v === true;
const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
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

const KINDS = {
  member: shape(
    { id: str, name: str, email: str, role: withDefault(str, 'Member'), team: str, title: str, c: str, status: withDefault(str, 'active'), tz: str },
    { last: numOrNull },
  ),
  project: shape(
    {
      id: str, key: str, name: str, icon: str, color: str, status: withDefault(str, 'planning'), team: str, desc: str, fav: bool, members: strs,
      milestones: list(shape({ name: str, date }), m => m.date),
    },
    { lead: ref, due: date, start: date, last: num, private: bool, archived: bool, archivedAt: numOrNull, perms: strMap(str), access: withDefault(str, 'workspace') },
  ),
  task: shape(
    {
      id: str, key: str, project: str, title: str, status: withDefault(str, 'todo'), priority: withDefault(str, 'none'), labels: strs, deps: strs, desc: str,
      created: num, updated: num, order: num,
      subtasks: list(shape({ id: str, title: str, done: bool }, { assignee: ref, due: date, note: str })),
      attachments: list(shape({ id: str, name: str, type: withDefault(str, 'other'), size: str, at: num }, { by: ref })),
    },
    { assignee: ref, due: date, start: date, estimate: text, recur: text, fav: bool, archived: bool, archivedAt: numOrNull, completedAt: numOrNull },
  ),
  comment: shape({ id: str, task: str, text: str, at: num, re: strMap(strs) }, { by: ref }),
  activity: shape({ id: str, verb: str, at: num, extra: str }, { by: ref, task: ref, project: ref }),
  notif: shape({ id: str, type: withDefault(str, 'update'), text: str, snippet: str, at: num, read: bool }, { by: ref, task: ref, project: ref }),
  file: shape({ id: str, project: str, name: str, type: withDefault(str, 'other'), size: str, at: num }, { by: ref, task: ref }),
  event: shape({ id: str, title: str, date: v => date(v) || '', time: str, project: str }),
  savedView: shape({
    id: str, project: str, name: str, type: withDefault(str, 'list'),
    filters: list(shape({ f: str, op: v => (v === 'not' ? 'not' : 'is'), v: strs }), f => f.f),
  }),
  team: shape({ id: str, name: str, desc: str, icon: str, c: str }),
  workspace: shape({ id: str, name: str, c: str }, { plan: str, brand: bool }),
  session: shape({ id: str, dev: str, loc: str, at: str }, { cur: bool }),
  invoice: shape({ id: str, date: v => date(v) || '', amt: str, st: str }),
}; // prettier-ignore

/* One record: kind is member, project, task, comment, activity, notif, file, event, savedView, team, workspace, session or invoice. */
export function normalizeRecord(kind, rec) {
  return KINDS[kind](isObj(rec) ? rec : {});
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
  if (d.sessions !== undefined) each('sessions', 'session');
  if (d.invoices !== undefined) each('invoices', 'invoice');
  d.projOrder = strs(d.projOrder);
  d.recentSearches = strs(d.recentSearches);
  d.me = str(d.me);
  d.tfa = bool(d.tfa);
  d.notifPrefs = strMap(bool)(d.notifPrefs);
  d.ws = shape({ name: str, url: str, c: str }, { brand: bool })(isObj(d.ws) ? d.ws : {});
  if (d.plan !== undefined) d.plan = str(d.plan);
  return d;
}
