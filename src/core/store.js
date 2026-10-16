/* ---------- store ---------- */
import { TODAY, diffD, fmtDate, iso, parse, uid } from './utils.js';
import { DEFAULT_FIELDS, DEFAULT_LABELS, DEFAULT_STAGE_SET, PCOLORS } from './constants.js';
import { flush } from './sync.js';
import { DEFAULT_PREFS } from './sync-map.js';
import { real } from './normalize.js';

/* What a user's notification settings start as (the same defaults seed() uses). */
export const DEFAULT_NOTIF_PREFS = {
  email_mention: true,
  email_assign: true,
  email_digest: true,
  email_comment: false,
  push_mention: true,
  push_assign: true,
  push_comment: true,
  push_due: true,
  mention_all: true,
  assign_self: true,
};
/* S.data before anything has loaded, and again after sign-out: the shape seed() returns with nothing in it. The workspace has a
   name so the shell can draw itself; src/core/sync.js fills in everything else from the server. */
export function emptyData() {
  return {
    ws: { id: '', name: 'PM Space', url: 'pmspace', c: '#1D1C1A', brand: true },
    workspaces: [],
    me: '',
    members: [],
    projects: [],
    tasks: [],
    comments: [],
    activity: [],
    notifs: [],
    files: [],
    events: [],
    teams: [],
    templates: [],
    stageSets: [],
    workspaceLists: [],
    projOrder: [],
    savedViews: [],
    recentSearches: [],
    notifPrefs: { ...DEFAULT_NOTIF_PREFS },
  };
}
/* View state that is never saved: which page, what is open, drafts. */
export function freshUi() {
  return {
    fx: {},
    auth: null,
    route: 'home',
    params: {},
    history: [],
    collapsed: false,
    mnav: false,
    expanded: {},
    drawer: null,
    drawerFull: false,
    drawerTab: 'comments',
    modals: [],
    modalOpeners: [],
    pop: null,
    palette: null,
    loading: false,
    offline: false,
    sel: new Set(),
    composer: null,
    editCell: null,
    openTasks: {},
    collapsedGroups: {},
    calDate: iso(TODAY),
    calMode: 'month',
    tlZoom: 'week',
    tlGroup: 'status',
    fileView: 'grid',
    projView: 'grid',
    projStatus: 'active',
    projBoardSet: null,
    homeTab: 'upcoming',
    inboxCat: 'all',
    inboxUnread: false,
    inboxSel: null,
    notifFilter: 'all',
    settings: 'appearance',
    searchQ: '',
    searchCat: 'all',
    myView: 'list',
    membersTab: 'members',
    collapsedCols: {},
    errors: {},
    drafts: {},
  };
}
/* The app's data lives only in memory. Everything that persists goes through src/core/sync.js to the server: S.data, and the
   personal settings (S.prefs, S.views, S.ui.collapsed), which travel in the user's user_prefs record. */
export const S = {
  data: emptyData(),
  prefs: { ...DEFAULT_PREFS },
  views: {},
  ui: freshUi(),
};
/* Back to the signed-out state: nothing of the last session stays in memory. */
export function resetStore() {
  S.data = emptyData();
  S.prefs = { ...DEFAULT_PREFS };
  S.views = {};
  S.ui = freshUi();
}
/* Every write ends here. After 150 ms of quiet the sync layer compares S.data with what the server has and sends the difference. */
export let _saveT;
export function save() {
  clearTimeout(_saveT);
  _saveT = setTimeout(flush, 150);
}

/* ---------- lookups ---------- */
export const D = () => S.data;
/* The signed-in user's member record. Before it has loaded (and while signed out) a blank stand-in keeps the shell drawable. */
export const me = () =>
  D().members.find(m => m.id === D().me) || {
    id: '',
    name: '',
    email: '',
    role: 'Member',
    title: '',
    c: '#6B7280',
    status: 'active',
    team: '',
    tz: '',
    last: null,
  };
export const isAdmin = () => me()?.role === 'Admin';
/* Who may save, edit and delete the workspace's project templates (the server's rules on `templates` say the same: admin or manager). */
export const canManageTemplates = () => ['Admin', 'Manager'].includes(me()?.role);
/* Who may make, edit and delete the workspace's stage sets (the rules on `stage_sets` say the same as those on `templates`). */
export const canManageStages = () => canManageTemplates();
/* Who may edit the workspace's task labels (the rules on `workspace_lists` say the same). */
export const canManageLabels = () => canManageTemplates();
/* Who may edit the workspace's project fields (the same record, so the same rules). */
export const canManageFields = () => canManageTemplates();
export const mem = id => D().members.find(m => m.id === id);
export const proj = id => D().projects.find(p => p.id === id);
export const task = id => D().tasks.find(t => t.id === id);
export const pColor = p => PCOLORS[p?.color] || PCOLORS.slate;
/* A project (or team) belongs to the current workspace. Before a workspace is chosen (no D().ws.id) everything shows. */
export const inWs = x => !!x && (!D().ws.id || x.workspace === D().ws.id);
export const visibleProjects = () =>
  D()
    .projOrder.map(proj)
    .filter(Boolean)
    .filter(p => !p.archived && inWs(p));
/* The server decides who may see a project (members of a private one, and admins), so whatever was loaded is visible. */
export const canSee = p => !!p;
export const tasksOf = pid => D().tasks.filter(t => t.project === pid && !t.archived);
/* Project templates (see actions/templates.js). tmpl() finds one in any workspace; templatesOf() lists those of one workspace, by name. */
export const tmpl = id => (D().templates || []).find(t => t.id === id);
export const templatesOf = wsId =>
  (D().templates || []).filter(t => t.workspace === wsId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
/* ---------- project stages ----------
   A workspace's stage sets are records (Settings > Stages). Until it has one, every project is in DEFAULT_STAGE_SET. A project names its
   set in `stageSet` (null: the workspace's first) and its stage in `stage` ('': the first of the set). Everything that reads a
   project's stage goes through these, so a set that is gone or a stage that was removed shows as the default or "Unknown" instead of
   breaking a page. Only the writers (actions/stages.js, createProject) touch p.stage and p.stageSet. */
export const findStageSet = id => (D().stageSets || []).find(s => s.id === id);
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
/* The workspace's sets in the order they were made (the server's `created`, then id); one made here that is not loaded back yet has no
   `created` and goes last, in the order it was made. */
export const stageSetsOf = wsId =>
  (D().stageSets || [])
    .filter(s => s.workspace === wsId)
    .sort((a, b) => !a.created - !b.created || cmp(a.created, b.created) || (a.created ? cmp(a.id, b.id) : 0));
/* The set a project is in: the one it names, if the workspace has it, else the workspace's first, else the built-in one. */
export function setOf(p) {
  const sets = stageSetsOf(p?.workspace);
  return sets.find(s => s.id === p?.stageSet) || sets[0] || DEFAULT_STAGE_SET;
}
export function stageOf(p) {
  const set = setOf(p);
  if (!p?.stage) return set.stages[0] || { id: '', name: 'No stage', color: 'gray', finished: false };
  return set.stages.find(s => s.id === p.stage) || { id: p.stage, name: 'Unknown', color: 'gray', finished: false };
}
export const isFinished = p => stageOf(p).finished;
/* The projects of the workspace shown (archived ones too: removing a stage they are in would leave them in an Unknown one when they
   come back) that are in a set, and with `stageId` in that stage of it. The built-in set is every set-less workspace's own, hence the
   workspace. */
export const projectsUsing = (setId, stageId) =>
  D().projects.filter(p => inWs(p) && setOf(p).id === setId && (stageId === undefined || stageOf(p).id === stageId));
/* ---------- task labels ----------
   A workspace's labels are the `labels` of its workspace_lists record (Settings > Labels). Until it has saved a list, every task is
   labelled from DEFAULT_LABELS: no record, or a record whose doc has no `labels` key, reads as the built-in set, and a list that is
   empty means no labels. A task stores label ids only and keeps the id of a label that was removed; the id shows as nothing. Everything
   that shows or offers labels goes through these, with the workspace of the task (taskWs) rather than the current one, since a task
   can be open (the drawer) after the workspace was switched. Only the editor (actions/labels.js) writes the list. */
/* The workspace's record. Two can be loaded for a moment (the server refuses the second, and the app takes its own back): the one the
   server has stored (it has `created`) wins, then the lowest id. */
export const listsOf = wsId => (D().workspaceLists || []).filter(l => l.workspace === wsId).sort((a, b) => !a.created - !b.created || cmp(a.id, b.id))[0];
export const labelsOf = wsId => listsOf(wsId)?.labels ?? DEFAULT_LABELS;
export const labelOf = (id, wsId) => labelsOf(wsId).find(l => l.id === id);
/* ---------- project fields ----------
   The same record holds the workspace's project fields (Settings > Project fields), as the `fields` of its doc, and they fall back the
   same way: no record, or a record whose doc has no `fields` key, reads as DEFAULT_FIELDS (the writer copies them, with their ids, into
   the first list it saves), and a list that is empty means no fields. A project stores values only, under `f_<field id>`, and keeps the
   value of a field that was deleted; it shows nowhere. Everything that shows or asks for the values goes through these, with the
   workspace of the project (p.workspace) rather than the current one, since a project can be open after the workspace was switched.
   Only the editor (actions/fields.js) writes the list; actions.js writes a project's values. */
export const fieldsOf = wsId => listsOf(wsId)?.fields ?? DEFAULT_FIELDS;
export const fieldOf = (id, wsId) => fieldsOf(wsId).find(f => f.id === id);
/* A day as the app stores one, and a real one (2026-02-31 is not): the test normalize.js makes of a date, so every year a date input
   gives (0001 and up) is one. parse() is no help here: it rolls 2026-02-31 over into March, and turns the years 0-99 into 1900-1999. */
export const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && real(v);
/* What project `p` has for field `f`, as text to show; '' when it has no value. A dropdown shows its choice's name ('' for a choice the
   field has since lost). A value of another type than the field's (only a writer outside the app makes one) shows as it is, as text. */
export function fieldText(p, f) {
  const v = p?.['f_' + f.id];
  // (a number is shown whole: toLocaleString() alone would round 0.0004 to 0)
  if (typeof v === 'number') return Number.isFinite(v) ? (f.type === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 20 }) : String(v)) : '';
  if (typeof v !== 'string') return '';
  if (f.type === 'select') return (f.options || []).find(o => o.id === v)?.name ?? '';
  // fmtDate parses with Date(y, m, d), which makes the year 50 1950: a day before the year 1000 shows as stored
  return f.type === 'date' && isDay(v) && +v.slice(0, 4) >= 1000 ? fmtDate(v, true) : v;
}
/* The workspace a task (or the task form) is in: its project's. */
export const taskWs = t => proj(t?.project)?.workspace || D().ws.id;
/* The labels of a task (or the task form) that its workspace's list still has, as the list's own entries and in the task's order, each
   once. A task keeps the id of a removed label, so t.labels is not what is shown: the empty state, the "+N" and the pills all come from
   this, which looks the workspace and its list up once. The list goes into a Map and each id found comes out of it, so a repeated id
   finds nothing, the walk stops once every entry is found, and the cost is the task's ids plus the list, however long t.labels is. */
export const shownLabels = t => {
  const left = new Map(labelsOf(taskWs(t)).map(l => [l.id, l]));
  const out = [];
  if (!left.size) return out;
  for (const id of t?.labels || []) {
    const l = left.get(id);
    if (!l) continue;
    out.push(l);
    left.delete(id);
    if (!left.size) break;
  }
  return out;
};
export const allTasks = () =>
  D().tasks.filter(t => {
    const p = proj(t.project);
    return !t.archived && inWs(p) && canSee(p);
  });
/* Events and files hang off projects, so they follow the project's workspace. So does activity that names a project. Activity that
   names a task but no project (the server allows it, the app never writes it) shows in the workspace it names itself, which the server
   requires to be the one of the task's project. One that names neither, or that names no workspace (a row from before activity had
   one, which the migration could not fill in), cannot be placed and is left out everywhere. */
export const wsEvents = () => D().events.filter(e => inWs(proj(e.project)));
export const wsFiles = () => D().files.filter(f => inWs(proj(f.project)));
export const wsActivity = () => D().activity.filter(a => (a.project ? inWs(proj(a.project)) : !!a.workspace && inWs(a)));
/* What the Archive page lists: archived tasks, except those of an archived project, which come back with the project. */
export const wsArchivedTasks = () => D().tasks.filter(t => t.archived && inWs(proj(t.project)) && canSee(proj(t.project)) && !proj(t.project)?.archived);
export const isOver = t => t.due && t.status !== 'done' && diffD(parse(t.due), TODAY) < 0;
export const commentsOf = tid => D().comments.filter(c => c.task === tid);
export function progressOf(pid) {
  const ts = tasksOf(pid);
  if (!ts.length) return 0;
  return Math.round((ts.filter(t => t.status === 'done').length / ts.length) * 100);
}
export function taskProg(t) {
  if (t.status === 'done') return 100;
  if (t.subtasks.length) return Math.round((t.subtasks.filter(s => s.done).length / t.subtasks.length) * 100);
  return { backlog: 0, todo: 5, progress: 45, review: 80 }[t.status] || 0;
}

/* ---------- activity + notification helpers ---------- */
/* One new entry at the top of the feed. Every entry the app writes goes through here. Its workspace is the one of its project, else of
   its task's project, else none (null, the way a record with an empty relation loads): the server refuses an entry whose workspace is
   not the one it hangs off, and one that hangs off nothing may not name a workspace (pb_migrations/1791849604_activity_workspace.js). */
export function pushAct(verb, taskId, projectId, extra = '') {
  const workspace = (projectId ? proj(projectId) : proj(task(taskId)?.project))?.workspace || null;
  D().activity.unshift({ id: uid('a'), by: D().me, verb, task: taskId || null, project: projectId || null, workspace, at: Date.now(), extra });
}
export function logAct(verb, t, extra = '') {
  pushAct(verb, t?.id, t?.project, extra);
  if (t) t.updated = Date.now();
}

/* ---------- teams (workspace data, loaded from the server) ---------- */
export const NO_TEAM = { id: '', name: 'No team', icon: 'users', c: '#8A867E', desc: '' };
/* Every team in every workspace: the storage behind the lists below. */
export function allTeams() {
  const d = D();
  return d.teams || (d.teams = []);
}
/* The current workspace's teams, for lists and pickers. */
export const teamsList = () => allTeams().filter(inWs);
export function team(id) {
  return allTeams().find(t => t.id === id) || null;
}
export const TM = new Proxy({}, { get: (_, k) => team(k) || NO_TEAM });
