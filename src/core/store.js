/* ---------- store ---------- */
import { TODAY, diffD, iso, parse, uid } from './utils.js';
import { DEFAULT_STAGE_SET, PCOLORS } from './constants.js';
import { flush } from './sync.js';
import { DEFAULT_PREFS } from './sync-map.js';

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
