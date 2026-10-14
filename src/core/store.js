/* ---------- store ---------- */
import { TODAY, diffD, iso, parse, uid } from './utils.js';
import { PCOLORS } from './constants.js';
import { flush } from './sync.js';

export const DEFAULT_PREFS = {
  theme: 'system',
  accent: 'indigo',
  side: 'comfortable',
  density: 'comfortable',
  weekStart: 1,
  dateFmt: 'MMM d',
  lang: 'English (US)',
  tz: '(GMT-07:00) Pacific Time',
  motion: 'system',
  home: 'home',
  openTasks: 'drawer',
};
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
    ws: { id: '', name: 'Gr8r Studio', url: 'gr8rstudio', c: '#1D1C1A', brand: true },
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
export const allTasks = () =>
  D().tasks.filter(t => {
    const p = proj(t.project);
    return !t.archived && inWs(p) && canSee(p);
  });
/* Events, files and activity hang off projects, so they follow the project's workspace. An activity record has no workspace of its own,
   so one that names no project (the server allows that, the app never writes it) cannot be placed and is left out everywhere. */
export const wsEvents = () => D().events.filter(e => inWs(proj(e.project)));
export const wsFiles = () => D().files.filter(f => inWs(proj(f.project)));
export const wsActivity = () => D().activity.filter(a => inWs(proj(a.project)));
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
export function logAct(verb, t, extra = '') {
  D().activity.unshift({ id: uid('a'), by: D().me, verb, task: t?.id || null, project: t?.project || null, at: Date.now(), extra });
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
