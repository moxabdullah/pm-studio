/* =====================================================================
   ACTIONS · INPUT HANDLERS · DRAG & DROP · KEYBOARD · INIT
   ===================================================================== */
import { $, $$, TODAY, addD, dOff, esc, fmtDate, iso, parse, uid } from '../core/utils.js';
import { PR, PSTAT, ST } from '../core/constants.js';
import { lookup, sanitizeHtml } from '../core/safe.js';
import {
  D,
  S,
  allTasks,
  canSee,
  commentsOf,
  isAdmin,
  logAct,
  me,
  mem,
  proj,
  resetStore,
  save,
  task,
  tasksOf,
  teamsList,
  visibleProjects,
} from '../core/store.js';
import { fileUrl, pb, setRemember } from '../core/pb.js';
import { flush, hasUnsaved, pendingChanges, quietResync, restoreState, resubscribe, retryNow, snapshotState, startSync, stopSync } from '../core/sync.js';
import { MAX_FILE_BYTES, downloadFile, fileOf, isRaster, uploadFile, uploadMessage } from '../core/files.js';
import { FORMER, fileType, fsize } from '../ui/helpers.js';
import { applyPrefs, effectiveDark } from '../core/theme.js';
import { clearStickyToasts, latest, latestFields, mutate, toast } from '../ui/toast.js';
import { autosize, focusKey, fxSet, go, render } from '../shell/render.js';
import { remoteRender } from '../shell/remote-render.js';
import { viewOf } from '../shell/view-engine.js';
import { TEMPLATES, closeModal, openModal } from '../overlays/modals.js';
import { closePop, openPop, tgt } from '../overlays/popovers.js';
import { strengthMeter } from '../pages/settings.js';

export const A = {},
  IN = {},
  KEY = {},
  DBL = {},
  BLUR = {};

/* ---------- task mutations ---------- */
export function nextKey(p) {
  p.seq = (p.seq || 200) + 1;
  return p.key + '-' + p.seq;
}
export function createTask(f) {
  const p = proj(f.project) || visibleProjects().find(canSee);
  const maxO = Math.max(0, ...D().tasks.map(t => t.order));
  const t = Object.assign(
    {
      project: p.id,
      title: 'Untitled',
      status: 'todo',
      assignee: null,
      priority: 'none',
      due: null,
      start: null,
      labels: [],
      subtasks: [],
      attachments: [],
      deps: [],
      desc: '',
      estimate: null,
      created: Date.now(),
      updated: Date.now(),
      order: maxO + 1,
      fav: false,
      recur: null,
    },
    f,
    { project: p.id },
  );
  t.id = f.id || uid('t');
  t.key = f.key || nextKey(p);
  D().tasks.push(t);
  fxSet({ added: t.id });
  logAct('created', t);
  return t;
}
export const RECUR_DAYS = lookup({ Daily: 1, Weekly: 7, 'Every 2 weeks': 14, Monthly: 30 }); // t.recur is stored text
export function applyPatch(t, patch) {
  const msgs = [];
  for (const k of Object.keys(patch)) {
    const old = t[k],
      nv = patch[k];
    if (JSON.stringify(old) === JSON.stringify(nv)) continue;
    if ((k === 'project' && !proj(nv)) || (k === 'assignee' && nv && !mem(nv))) continue; // a replayed edit can name a project or member that has gone since: leave that field
    t[k] = nv;
    if (k === 'status') {
      if (nv === 'done') {
        t.completedAt = Date.now();
        t.prevStatus = old;
        logAct('completed', t);
        fxSet({ done: t.id });
      } else logAct('moved', t, `from ${ST[old].name} to ${ST[nv].name}`);
      if (nv === 'done' && t.recur && t.due) {
        const nd = iso(addD(parse(t.due), RECUR_DAYS[t.recur] || 7));
        const n = createTask({
          ...JSON.parse(JSON.stringify(t)),
          id: undefined,
          key: undefined,
          status: 'todo',
          due: nd,
          start: nd,
          subtasks: t.subtasks.map(s => ({ ...s, done: false })),
          completedAt: null,
          attachments: [],
        });
        delete n.prevStatus;
        msgs.push(`Next “${t.title}” scheduled for ${fmtDate(nd)}`);
      }
    } else if (k === 'assignee') logAct('assigned', t, nv ? `to ${mem(nv)?.name}` : '(unassigned)');
    else if (k === 'priority') logAct('changed priority of', t, `to ${PR[nv].name}`);
    else if (k === 'due') logAct('changed due date of', t, nv ? `to ${fmtDate(nv)}` : '(cleared)');
    else if (k === 'start') logAct('changed start date of', t, nv ? `to ${fmtDate(nv)}` : '(cleared)');
    else if (k === 'project') {
      const p = proj(nv);
      t.key = nextKey(p);
      logAct('moved', t, `to ${p.name}`);
    } else if (k === 'labels') logAct('updated labels on', t);
    else if (k === 'title') logAct('renamed', t, `to “${nv}”`);
    else if (k === 'recur') logAct('set repeat on', t, nv ? nv.toLowerCase() : 'off');
    else if (k === 'estimate') logAct('estimated', t, nv || 'none');
    else if (k === 'deps') logAct('updated dependencies of', t);
    t.updated = Date.now();
  }
  return msgs;
}
/* `done`, when given, runs once the edit is in (after the toasts of the edit itself), also when "Try again" applies it later. */
export function updateTask(id, patch, done) {
  if (id === '__form') {
    Object.assign(S.ui.form, patch);
    render();
    return;
  }
  if (!task(id)) return;
  let msgs = [];
  // Every absolute or toggle edit below does the same: a latestFields() taken before mutate() and tested in `still`, so a refused edit's
  // "Try again" never overwrites a newer edit (refused or not) of the same field.
  const fresh = latestFields('task', id, Object.keys(patch));
  mutate(
    () => {
      msgs = applyPatch(task(id), patch); // by id: sync or Undo can replace the task while a refused edit waits for "Try again"
    },
    () => {
      msgs.forEach(m => toast(m, { kind: 'info' }));
      done?.();
    },
    () => fresh() && !!task(id),
  );
}
/* latestFields() for the tasks of a bulk edit: call it before mutate(); the returned function lists the ids that still exist and whose
   edit of `fields` is the newest. */
function liveTasks(ids, fields) {
  const fresh = new Map(ids.map(id => [id, latestFields('task', id, fields)]));
  return () => ids.filter(id => task(id) && fresh.get(id)());
}
export function confirmDlg(o) {
  S.ui.confirmText = '';
  openModal({ type: 'confirm', ...o });
}
/* Whether `m` is the modal on top. The `still` of a form saved by mutate(): once the form has been closed (or saved again), a lingering
   "Try again" must not save it a second time. */
export const isTop = m => S.ui.modals[S.ui.modals.length - 1] === m;
/* Undo. A snapshot is an opaque token: restoring puts the data back as it was and keeps whatever other people changed since, so Undo
   never reverts their work (see snapshotState/restoreState in core/sync.js). */
export function snapshot() {
  return snapshotState();
}
export function restore(snap) {
  if (!restoreState(snap)) {
    toast("Couldn't undo: the data was refreshed since.", { kind: 'err' });
    return;
  }
  save();
  render();
}
export async function copy(text, msg = 'Link copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast("Copy isn't available here — " + text, { kind: 'info', ms: 6000 });
  }
}
export function loadingBtn(id, ms, fn) {
  const b = document.getElementById(id);
  if (b) {
    b.classList.add('is-loading');
    b.setAttribute('aria-busy', 'true');
  }
  setTimeout(fn, ms);
}
export function curProjectId() {
  if (S.ui.route === 'project') return S.ui.params.id;
  return null;
}
export function projectFromKey(key) {
  if (!key) return null;
  if (key.startsWith('p:')) return key.slice(2);
  if (key.startsWith('sv:')) return D().savedViews.find(v => v.id === key.slice(3))?.project;
  return null;
}

/* ---------- navigation ---------- */
A.go = el => {
  const r = el.dataset.r;
  const p = {};
  if (el.dataset.id) p.id = el.dataset.id;
  if (el.dataset.tab) p.tab = el.dataset.tab;
  else if (r === 'project') p.tab = S.prefs.defaultTab || 'board';
  if (el.dataset.sec) p.sec = el.dataset.sec;
  S.ui.palette = null;
  const tabOnly = r === 'project' && S.ui.route === 'project' && S.ui.params.id === p.id;
  go(r, p, { tab: tabOnly });
};
A.back = () => {
  const h = S.ui.history.pop();
  if (h) go(h.route, h.params, { back: true });
  else go('home');
};
A.reload = () => render();
A.openProject = el => go('project', { id: el.dataset.id, tab: S.prefs.defaultTab || 'board' });
A.set = el => {
  const k = el.dataset.k;
  let v = el.dataset.v;
  if (/Tab$|Cat$|Mode$|View$/.test(k)) fxSet({ tabs: true });
  if (k === 'inboxSel' && !v) v = null;
  S.ui[k] = v;
  if (k === 'membersTab' || k === 'searchCat') S.ui.pop = null;
  render();
};
A.toggleSide = () => {
  S.ui.collapsed = !S.ui.collapsed;
  save();
  render();
};
A.openMnav = () => {
  S.ui.mnav = true;
  render();
};
A.closeMnav = () => {
  S.ui.mnav = false;
  render();
};
A.toggleExpand = el => {
  S.ui.expanded[el.dataset.id] = !S.ui.expanded[el.dataset.id];
  render();
};
A.goTasks = el => {
  const f = el.dataset.f;
  const v = viewOf('tasks');
  v.mode = 'list';
  v.filters =
    f === 'open'
      ? [{ f: 'status', op: 'not', v: ['done'] }]
      : f === 'done'
        ? [
            { f: 'status', op: 'is', v: ['done'] },
            { f: 'updated', op: 'is', v: ['7'] },
          ]
        : f === 'overdue'
          ? [{ f: 'due', op: 'is', v: ['overdue'] }]
          : [];
  go('tasks');
};
A.goFilteredList = el => {
  const v = viewOf('p:' + el.dataset.id);
  v.filters = [{ f: 'status', op: 'is', v: [el.dataset.st] }];
  v.group = 'status';
  go('project', { id: el.dataset.id, tab: 'list' }, { tab: true });
};

/* ---------- theme ---------- */
A.setTheme = el => {
  S.prefs.theme = el.dataset.v;
  save();
  render();
};
A.toggleDark = () => {
  S.prefs.theme = effectiveDark() ? 'light' : 'dark';
  save();
  S.ui.palette = null;
  render();
  toast(effectiveDark() ? 'Dark mode on' : 'Light mode on', { kind: 'info', ms: 1800 });
};
A.setPref = el => {
  S.prefs[el.dataset.k] = el.dataset.v;
  save();
  render();
};

/* ---------- popovers ---------- */
A.pop = el => {
  const d = el.dataset;
  const p = S.ui.pop;
  if (p && p.type === d.pop && p.id === d.id && p.key === d.key && p.i == (d.i != null ? +d.i : undefined) && p.field === d.field) {
    closePop();
    return;
  }
  openPop(el);
};
A.ctxBtn = el => {
  const r = el.getBoundingClientRect();
  const d = el.dataset;
  const p = S.ui.pop;
  if (p && p.type === 'ctx' && p.id === d.id && p.ctx === d.ctx) {
    closePop();
    return;
  }
  S.ui.pop = { type: 'ctx', ctx: d.ctx, id: d.id, key: d.key, vid: d.vid, x: r.left, y: r.bottom + 4, top: r.top, w: r.width };
  render();
};
A.popPick = el => {
  const p = S.ui.pop;
  let v = el.dataset.v;
  if (p.type === 'subassignee' || (p.type === 'date' && p.field === 'subdue')) {
    const id = p.id;
    const sb = task(id)?.subtasks[p.i];
    if (!sb) return;
    const sid = sb.id;
    const k = p.type === 'subassignee' ? 'assignee' : 'due';
    v = v || null;
    S.ui.pop = null;
    const fresh = latestFields('sub', sid, [k]);
    mutate(
      () => {
        const t = task(id); // by id: sync or Undo can replace the task and its subtasks while a refused edit waits for "Try again"
        t.subtasks.find(x => x.id === sid)[k] = v;
        logAct(
          k === 'assignee' ? 'assigned a subtask on' : 'set a subtask due date on',
          t,
          k === 'assignee' ? (v ? `to ${mem(v)?.name}` : '(unassigned)') : v ? fmtDate(v) : '(cleared)',
        );
      },
      undefined,
      () => fresh() && !!task(id)?.subtasks.some(x => x.id === sid) && (k !== 'assignee' || !v || !!mem(v)), // the member can be gone by the time "Try again" runs
    );
    return;
  }
  if (p.type === 'pstatus') {
    const id = p.id;
    let pr;
    const fresh = latestFields('proj', id, ['status']);
    mutate(
      () => {
        pr = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
        pr.status = v;
        D().activity.unshift({
          id: uid('a'),
          by: D().me,
          verb: 'changed status of project',
          task: null,
          project: pr.id,
          at: Date.now(),
          extra: 'to ' + PSTAT[v].name,
        });
      },
      () => toast(`${pr.name} marked ${PSTAT[v].name}`),
      () => fresh() && !!proj(id),
    );
    S.ui.pop = null;
    render();
    return;
  }
  if (p.type === 'role') {
    if (!isAdmin()) return;
    const id = p.id;
    let m;
    const fresh = latestFields('mem', id, ['role']);
    mutate(
      () => {
        m = mem(id); // by id: sync can replace the member while a refused edit waits for "Try again"
        m.role = v;
      },
      () => toast(`${m.name} is now ${v === 'Admin' ? 'an' : 'a'} ${v}`),
      () => fresh() && isAdmin() && !!mem(id), // the reconnect can change who is an admin
    );
    S.ui.pop = null;
    render();
    return;
  }
  const field = { status: 'status', priority: 'priority', assignee: 'assignee', project: 'project', recur: 'recur', estimate: 'estimate', date: p.field }[
    p.type
  ];
  if (!field) return;
  if (field === 'assignee' && !v) v = null;
  if (field === 'recur' && v === 'Does not repeat') v = null;
  if ((field === 'estimate' || field === 'due' || field === 'start') && !v) v = null;
  S.ui.pop = null;
  const patch = { [field]: v };
  if (field === 'due' && v && p.id !== '__form') {
    const t = task(p.id);
    if (t.start && t.start > v) patch.start = v;
  }
  updateTask(p.id, patch);
};
A.popToggleLabel = el => {
  const p = S.ui.pop;
  const t = tgt(p);
  const v = el.dataset.v;
  const labels = t.labels.includes(v) ? t.labels.filter(x => x !== v) : [...t.labels, v];
  updateTask(p.id, { labels });
};
A.popToggleDep = el => {
  const p = S.ui.pop;
  const t = task(p.id);
  const v = el.dataset.v;
  updateTask(p.id, { deps: t.deps.includes(v) ? t.deps.filter(x => x !== v) : [...t.deps, v] });
};
A.popMonth = el => {
  const p = S.ui.pop;
  const m = parse(p.m);
  p.m = iso(new Date(m.getFullYear(), m.getMonth() + +el.dataset.d, 1));
  render();
};
IN.popQ = el => {
  if (S.ui.pop) {
    S.ui.pop.q = el.value;
    render();
  }
};
export const ctxTo = type => () => {
  S.ui.pop = { ...S.ui.pop, type, q: '' };
  if (type === 'date') S.ui.pop.m = iso(TODAY);
  render();
};
A.ctxStatus = ctxTo('status');
A.ctxAssign = ctxTo('assignee');
A.ctxPrio = ctxTo('priority');
A.ctxMove = ctxTo('project');
A.ctxRole = ctxTo('role');

/* ---------- tasks ---------- */
A.openTask = el => {
  const id = el.dataset.id;
  if (!task(id)) return;
  if (!canSee(proj(task(id).project))) {
    toast("You don't have access to that task", { kind: 'err' });
    return;
  }
  if (!S.ui.drawer || !document.activeElement?.closest?.('.drawer')) S.ui.drawerOpener = el.isConnected ? focusKey(el) : S.ui.drawerOpener;
  S.ui.drawer = id;
  S.ui.drawerFull = S.prefs.openTasks === 'full' || (S.ui.drawerFull && S.ui.drawer === id);
  S.ui.pop = null;
  S.ui.palette = null;
  S.ui.modals = [];
  S.ui.mention = null;
  S.ui.subOpen = null;
  S.ui.drawerTab = S.ui.drawerTab || 'comments';
  render();
  const dr = $('.drawer');
  if (dr && !dr.contains(document.activeElement)) dr.focus({ preventScroll: true });
};
A.closeDrawer = () => {
  S.ui.drawer = null;
  S.ui.drawerFull = false;
  S.ui.subOpen = null;
  render();
};
A.skipToContent = () => {
  const c = $('#main-content');
  c?.focus();
};
A.projUp = el => A._projMove(el, -1);
A.projDown = el => A._projMove(el, 1);
A._projMove = (el, d) => {
  const vis = visibleProjects().map(p => p.id);
  const i = vis.indexOf(el.dataset.id);
  const j = i + d;
  if (j < 0 || j >= vis.length) return;
  const o = D().projOrder;
  const a = o.indexOf(vis[i]),
    b = o.indexOf(vis[j]);
  [o[a], o[b]] = [o[b], o[a]];
  S.ui.pop = null;
  save();
  render();
  toast(`Moved ${proj(el.dataset.id).name} ${d < 0 ? 'up' : 'down'}`, { ms: 1600 });
};
A.toggleDrawerFull = () => {
  S.ui.drawerFull = !S.ui.drawerFull;
  render();
};
A.toggleDone = el => {
  const t = task(el.dataset.id);
  if (!t) return;
  const wasDone = t.status === 'done';
  S.ui.pop = null;
  updateTask(
    t.id,
    { status: wasDone ? (t.prevStatus && t.prevStatus !== 'done' ? t.prevStatus : 'todo') : 'done' },
    wasDone
      ? undefined
      : () => toast(`Completed “${task(t.id).title}”`, { action: 'Undo', onAction: () => updateTask(t.id, { status: task(t.id)?.prevStatus || 'todo' }) }),
  );
};
A.toggleFavTask = el => {
  const id = el.dataset.id;
  if (!task(id)) return;
  let t;
  const fresh = latestFields('task', id, ['fav']);
  mutate(
    () => {
      t = task(id); // by id: sync or Undo can replace the task while a refused edit waits for "Try again"
      t.fav = !t.fav;
    },
    () => toast(t.fav ? 'Added to favorites' : 'Removed from favorites', { ms: 1800 }),
    () => fresh() && !!task(id),
  );
  S.ui.pop = null;
  render();
};
A.toggleFavProj = el => {
  const id = el.dataset.id;
  if (!proj(id)) return;
  let p;
  const fresh = latestFields('proj', id, ['fav']);
  mutate(
    () => {
      p = proj(id); // by id, as above
      p.fav = !p.fav;
    },
    () => toast(p.fav ? `Added ${p.name} to favorites` : 'Removed from favorites', { ms: 1800 }),
    () => fresh() && !!proj(id),
  );
  S.ui.pop = null;
  render();
};
A.copyText = el => copy(el.dataset.text, 'Copied to clipboard');
A.copyEmail = el => {
  S.ui.pop = null;
  render();
  copy(mem(el.dataset.id).email, 'Email copied');
};
A.dupTask = el => {
  const id = el.dataset.id;
  S.ui.pop = null;
  let n;
  mutate(
    () => {
      const t = task(id); // by id: a merge while a refused edit waits for "Try again" must not leave the copy with the values from the click
      n = createTask({ ...JSON.parse(JSON.stringify(t)), id: uid('t'), key: undefined, title: t.title + ' (copy)', created: Date.now(), fav: false });
      n.key = nextKey(proj(n.project));
    },
    () => toast('Task duplicated', { action: 'Open', onAction: () => A.openTask({ dataset: { id: n.id } }) }),
    () => !!task(id), // not for a task that has gone since
  );
};
A.archiveTask = el => {
  const id = el.dataset.id;
  let t, snap;
  S.ui.pop = null;
  const fresh = latestFields('task', id, ['archived']);
  mutate(
    () => {
      t = task(id); // by id: sync or Undo can replace the task while a refused edit waits for "Try again"
      snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
      if (S.ui.drawer === id) S.ui.drawer = null;
      t.archived = true;
      t.archivedAt = Date.now();
      logAct('archived', t);
    },
    () => toast(`Archived “${t.title}”`, { action: 'Undo', onAction: () => restore(snap) }),
    () => fresh() && !!task(id), // not for a task that has gone since
  );
};
export function deleteTasks(ids) {
  const set = new Set(ids);
  D().tasks = D().tasks.filter(t => !set.has(t.id));
  D().tasks.forEach(t => (t.deps = t.deps.filter(d => !set.has(d))));
  D().comments = D().comments.filter(c => !set.has(c.task));
  if (set.has(S.ui.drawer)) S.ui.drawer = null;
  ids.forEach(i => S.ui.sel.delete(i));
}
A.delTask = el => {
  const t = task(el.dataset.id);
  S.ui.pop = null;
  if (!t) return;
  const run = () => {
    let snap;
    mutate(
      () => {
        snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
        deleteTasks([t.id]);
      },
      () => toast(`Deleted “${t.title}”`, { action: 'Undo', onAction: () => restore(snap) }),
      () => !!task(t.id), // not for a task that has gone since: there would be nothing to delete, and Undo would restore nothing
    );
  };
  if (S.prefs.confirmDel === false) return run();
  confirmDlg({
    title: 'Delete task?',
    body: `<b>${esc(t.title)}</b>${t.subtasks.length ? `, its ${t.subtasks.length} subtasks,` : ''} and ${commentsOf(t.id).length} comment${commentsOf(t.id).length === 1 ? '' : 's'} will be permanently deleted.`,
    ok: 'Delete task',
    danger: true,
    run,
  });
};
A.editTask = el => {
  const t = task(el.dataset.id);
  if (!t) return;
  S.ui.form = {
    title: t.title,
    desc: String(t.desc ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    project: t.project,
    status: t.status,
    assignee: t.assignee,
    priority: t.priority,
    due: t.due,
    start: t.start,
    labels: [...t.labels],
    subtasks: t.subtasks.map(s => ({ ...s })),
    files: [],
    recur: t.recur,
    more: false,
  };
  S.ui.errors = {};
  openModal({ type: 'task', edit: t.id });
};
/* A workspace with no projects (a fresh or empty one) has nowhere to put a task. */
function needProject() {
  toast('Create a project before adding tasks.', { kind: 'info', action: 'New project', onAction: () => A.newProject() });
}
A.newTask = el => {
  const d = el?.dataset || {};
  const pid =
    d.project ||
    curProjectId() ||
    projectFromKey(S.ui.composer?.ctx) ||
    (S.ui.drawer && task(S.ui.drawer)?.project) ||
    visibleProjects().find(p => canSee(p) && p.status !== 'complete')?.id;
  const project = proj(pid) && canSee(proj(pid)) ? pid : visibleProjects().find(canSee)?.id;
  if (!project) return needProject();
  S.ui.form = {
    title: '',
    desc: '',
    project,
    status: 'todo',
    assignee: d.assignee || D().me,
    priority: 'medium',
    due: d.due || null,
    start: null,
    labels: [],
    subtasks: [],
    files: [],
    recur: null,
    more: S.ui.form?.more || false,
  };
  S.ui.errors = {};
  openModal({ type: 'task' });
};
IN.form = el => {
  S.ui.form[el.dataset.f] = el.value;
  if (el.dataset.f === 'title' && S.ui.errors.title && el.value.trim()) {
    S.ui.errors.title = null;
    render();
  }
};
IN.formMore = el => {
  S.ui.form.more = el.checked;
};
/* Files picked in the task form wait here, as real File objects, until the task is saved; submitTask then uploads them. */
function addFormFiles(picked) {
  if (!S.ui.modals.some(m => m.type === 'task')) return;
  const big = picked.filter(f => f.size > MAX_FILE_BYTES);
  if (big.length) toast(tooBig(big), { kind: 'err', ms: 6000 });
  picked.filter(f => f.size <= MAX_FILE_BYTES).forEach(f => S.ui.form.files.push({ name: f.name, size: fsize(f.size), type: fileType(f.name), blob: f }));
  render();
}
A.pickFormFiles = () => pick(addFormFiles);
KEY.formAddSub = el => {
  const v = el.value.trim();
  if (!v) return;
  S.ui.form.subtasks.push({ id: uid('s'), title: v, done: false });
  render();
  setTimeout(() => $('#f-sub')?.focus(), 0);
};
A.formRmSub = el => {
  S.ui.form.subtasks.splice(+el.dataset.i, 1);
  render();
};
A.formRmFile = el => {
  S.ui.form.files.splice(+el.dataset.i, 1);
  render();
};
A.submitTask = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.form;
  const title = ($('#f-title')?.value ?? f.title).trim();
  f.title = title;
  f.desc = $('#f-desc')?.value ?? f.desc;
  if (!title) {
    S.ui.errors.title = 'Give the task a name';
    render();
    $('#f-title')?.focus();
    return;
  }
  S.ui.errors = {};
  const fresh = latest(m);
  const picked = f.files.map(x => x.blob).filter(Boolean);
  // What the edit applies is copied here, once validated: the form stays editable after an offline refusal, and "Try again" must not pick up what was typed since.
  const desc = f.desc;
  const base = {
    title,
    project: f.project,
    status: f.status,
    assignee: f.assignee,
    priority: f.priority,
    due: f.due,
    start: f.start && f.due && f.start > f.due ? f.due : f.start,
    labels: [...f.labels],
    recur: f.recur,
    subtasks: f.subtasks.map(s => ({ ...s })),
  };
  // What follows the save goes in mutate's `done`, so "Try again" after an offline refusal closes the form too, instead of leaving it to be submitted twice.
  // `still`: that retry is skipped once the form is gone, or when a later submit of it has happened since (even one that went through).
  const still = () => isTop(m) && fresh();
  if (m.edit) {
    const id = m.edit;
    let t;
    mutate(
      () => {
        t = task(id); // by id: sync or Undo can replace the task while a refused edit waits for "Try again"
        applyPatch(t, base);
        if (
          desc !==
          String(t.desc ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
          t.desc = desc ? `<p>${esc(desc)}</p>` : '';
      },
      () => {
        S.ui.modals.pop();
        render();
        toast('Changes saved');
        handleFiles(picked, { project: t.project, task: t.id });
      },
      () => still() && !!task(id),
    );
    return;
  }
  let t;
  mutate(
    () => {
      t = createTask({ ...base, desc: desc ? `<p>${esc(desc)}</p>` : '' });
    },
    () => {
      if (f.more) {
        Object.assign(f, { title: '', desc: '', subtasks: [], files: [] });
        render();
        setTimeout(() => $('#f-title')?.focus(), 0);
        toast(`Created ${t.key}`, { ms: 2000 });
        handleFiles(picked, { project: t.project, task: t.id });
        return;
      }
      S.ui.modals.pop();
      fxSet({ added: t.id });
      render();
      toast(`Created ${t.key} in ${proj(t.project).name}`, { action: 'Open', onAction: () => A.openTask({ dataset: { id: t.id } }) });
      handleFiles(picked, { project: t.project, task: t.id });
    },
    () => still() && !!proj(base.project), // else createTask would quietly file it under another project
  );
};

/* inline composer */
A.startComposer = el => {
  S.ui.composer = { ctx: el.dataset.ctx, group: el.dataset.group, gb: JSON.parse(el.dataset.gb || '{}') };
  S.ui.pop = null;
  render();
  setTimeout(() => $('#composer-in')?.focus(), 0);
};
A.cancelComposer = () => {
  S.ui.composer = null;
  render();
};
KEY.commitComposer = () => A.commitComposer();
A.commitComposer = () => {
  const c = S.ui.composer;
  const el = $('#composer-in');
  const v = el?.value.trim();
  if (!c) return;
  if (!v) {
    A.cancelComposer();
    return;
  }
  const f = { title: v, ...c.gb };
  f.project = f.project || projectFromKey(c.ctx) || curProjectId() || visibleProjects().find(canSee)?.id;
  if (!f.project) {
    A.cancelComposer();
    return needProject();
  }
  if (c.ctx === 'mytasks') f.assignee = D().me;
  const fresh = latest(`composer:${c.ctx}:${c.group}`);
  mutate(
    () => createTask(f),
    undefined,
    () => fresh() && !!proj(f.project),
  );
  setTimeout(() => $('#composer-in')?.focus(), 0);
};
KEY.commitTitle = el => DBL._commitTitle(el);
DBL.editTitle = el => {
  const row = el.closest('[data-task-row]');
  if (!row) return;
  S.ui.drawer = null;
  S.ui.editCell = { id: row.dataset.taskRow, f: 'title' };
  render();
  const i = $('#edit-title');
  if (i) {
    i.focus();
    i.select();
  }
};
DBL._commitTitle = el => {
  const c = S.ui.editCell;
  if (!c) return;
  S.ui.editCell = null;
  const v = el.value.trim();
  if (v && v !== task(c.id).title) updateTask(c.id, { title: v });
  else render();
};
DBL.editCell = el => {
  S.ui.drawer = null;
  S.ui.editCell = { id: el.dataset.id || el.closest('[data-id]').dataset.id, f: el.dataset.f };
  render();
  const i = $('#edit-cell');
  if (i) {
    i.focus();
    i.select();
  }
};
A.editCell = el => DBL.editCell(el);
KEY.commitCell = el => {
  const c = S.ui.editCell;
  if (!c) return;
  S.ui.editCell = null;
  const v = el.value.trim();
  if (c.f === 'title' && !v) {
    render();
    return;
  }
  updateTask(c.id, { [c.f]: v || null });
};
BLUR.commitCell = el => KEY.commitCell(el);
BLUR.commitTitle = el => DBL._commitTitle(el);
BLUR.commitDrawerTitle = el => {
  const t = task(el.dataset.id);
  const v = el.value.trim();
  if (t && v && v !== t.title) updateTask(t.id, { title: v });
};
KEY.blur = el => el.blur();

/* subtasks */
A.toggleSub = el => {
  const { id, sid } = el.dataset;
  const fresh = latestFields('sub', sid, ['done']);
  mutate(
    () => {
      const t = task(id); // by id: sync or Undo can replace the task and its subtasks while a refused edit waits for "Try again"
      const s = t.subtasks.find(x => x.id === sid);
      if (!s.done) fxSet({ done: s.id });
      s.done = !s.done;
      logAct(s.done ? 'completed subtask on' : 'reopened subtask on', t, `“${s.title}”`);
    },
    undefined,
    () => fresh() && !!task(id)?.subtasks.some(x => x.id === sid),
  );
};
A.rmSub = el => {
  const { id, sid } = el.dataset;
  mutate(
    () => {
      const t = task(id); // by id, as above
      t.subtasks = t.subtasks.filter(x => x.id !== sid);
    },
    undefined,
    () => !!task(id),
  );
};
KEY.addSub = el => {
  const id = el.dataset.id;
  const v = el.value.trim();
  if (!v) return;
  const nid = uid('s');
  const fresh = latest(`sub:${id}`);
  mutate(
    () => {
      const t = task(id);
      fxSet({ added: nid });
      t.subtasks.push({ id: nid, title: v, done: false });
      logAct('added subtask to', t, `“${v}”`);
    },
    undefined,
    () => fresh() && !!task(id),
  );
  setTimeout(() => $('#d-sub')?.focus(), 0);
};
A.expandRow = el => {
  S.ui.openTasks[el.dataset.id] = !S.ui.openTasks[el.dataset.id];
  render();
};

/* ---------- files and attachments ----------
   A files record is the file itself (src/core/files.js uploads and downloads it); a task's `attachments` entry is a pointer to one
   ({ id, name, type, size, by, at }, the id being the record's). Both sync like any other change to S.data. */
A.rmAttach = el => {
  const { id, aid } = el.dataset;
  const f = task(id)?.attachments.find(a => a.id === aid);
  if (!f) return;
  // only the pointer goes: the file stays in the project's Files
  mutate(
    () => {
      const t = task(id); // by id: sync or Undo can replace the task while a refused edit waits for "Try again"
      t.attachments = t.attachments.filter(a => a.id !== aid);
      logAct('removed a file from', t);
    },
    () => toast(`Removed ${f.name}`),
    () => !!task(id)?.attachments.some(a => a.id === aid), // the attachment itself can be gone too
  );
};
A.filePreview = el => {
  const t = task(el.dataset.tid);
  const att = t?.attachments.find(a => a.id === el.dataset.aid);
  if (att) openFilePreview(fileOf(t, att) || att, t.id);
};
A.previewFile = el => {
  const f = D().files.find(x => x.id === el.dataset.id);
  S.ui.pop = null;
  if (f) openFilePreview(f, f.task);
  else render();
};
/* The preview modal. An image gets a real <img> with a file URL (its token lasts a few minutes; the error handler below renews a stale
   one), anything else keeps the icon preview and offers a download. Nothing a person uploaded is ever put in an iframe, object or embed,
   and the window never navigates to one: only raster images are drawn, and everything else is downloaded. */
let opening = '';
export async function openFilePreview(f, tid) {
  if (opening === f.id) return;
  opening = f.id;
  try {
    let src = '';
    if (isRaster(f)) {
      try {
        src = await fileUrl(f);
      } catch (err) {
        if (err?.status === 401) return sessionEnded(); // the server no longer accepts this session
        /* offline, say: the icon preview shows */
      }
    }
    openModal({ type: 'filePreview', file: f, tid, src });
  } finally {
    opening = '';
  }
}
/* An image that fails to load (a token that ran out while the modal stayed open) gets one new URL. If that fails too, the icon preview
   that sits underneath it shows instead. `error` does not bubble, hence the capture. */
document.addEventListener(
  'error',
  async e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fid) return;
    const f = D().files.find(x => x.id === img.dataset.fid);
    if (!f || img.dataset.retried) {
      img.hidden = true;
      return;
    }
    img.dataset.retried = '1';
    try {
      const src = await fileUrl(f);
      const m = S.ui.modals.find(x => x.type === 'filePreview' && x.file.id === f.id);
      if (m) m.src = src; // later renders start from the fresh URL
      img.src = src;
    } catch (err) {
      img.hidden = true;
      if (err?.status === 401) sessionEnded();
    }
  },
  true,
);
A.downloadFile = async el => {
  const f = D().files.find(x => x.id === el.dataset.id);
  if (S.ui.pop) {
    S.ui.pop = null;
    render();
  }
  if (!f) return;
  try {
    await downloadFile(f);
  } catch (err) {
    if (err.status === 401) return sessionEnded(); // the same as for an upload: the session is over, so back to the sign-in page
    toast(`Couldn't download ${f.name}: ${err.status === 0 ? "can't reach the server" : err.response?.message || err.message}`, { kind: 'err' });
  }
};

const MB_LIMIT = MAX_FILE_BYTES / 1048576;
function tooBig(files) {
  const names = files
    .slice(0, 2)
    .map(f => f.name)
    .join(', ');
  return files.length === 1
    ? `${files[0].name} is ${fsize(files[0].size)}. Files can be up to ${MB_LIMIT} MB.`
    : `${files.length} files are over the ${MB_LIMIT} MB limit and were skipped: ${names}${files.length > 2 ? ', …' : ''}`;
}
/* Uploads the files, one after the other, each as a files record with its bytes. `ctx` is { project, task? }: with a task, the file is
   also attached to it. Progress is the real number of bytes sent. A failure says why and drops that file's row; the others carry on.
   (The caller may empty the file input right after this returns: the list is copied first.) */
export function handleFiles(files, ctx = {}) {
  const list = [...(files || [])];
  if (!list.length) return;
  if (S.ui.offline) {
    toast("Upload failed — you're offline.", {
      kind: 'err',
      action: 'Try again',
      onAction: async () => {
        if (await retryNow()) handleFiles(list, ctx);
      },
    });
    return;
  }
  if (!proj(ctx.project)) {
    toast("Couldn't upload: that project isn't available.", { kind: 'err' });
    return;
  }
  const big = list.filter(f => f.size > MAX_FILE_BYTES);
  if (big.length) toast(tooBig(big), { kind: 'err', ms: 6000 });
  const jobs = list
    .filter(f => f.size <= MAX_FILE_BYTES)
    .map(file => ({ file, up: { id: uid(), name: file.name, size: fsize(file.size), project: ctx.project, task: ctx.task || null, pct: 0 } }));
  if (!jobs.length) return;
  S.ui.uploads = S.ui.uploads || [];
  S.ui.uploads.push(...jobs.map(j => j.up));
  render();
  (async () => {
    const who = D().me;
    for (const job of jobs) {
      if (D().me !== who || !pb.authStore.isValid) break; // the session ended: the rest never starts
      await uploadOne(job, ctx);
    }
  })();
}
async function uploadOne({ file, up }, ctx) {
  const gone = () => {
    if (S.ui.uploads) S.ui.uploads = S.ui.uploads.filter(x => x !== up);
  };
  try {
    // A folder dropped into the page arrives as a "file" that cannot be read. Find out before the request, not from its error.
    await file.slice(0, 1).arrayBuffer();
  } catch {
    gone();
    toast(`Couldn't read ${file.name}. Folders can't be uploaded.`, { kind: 'err' });
    remoteRender();
    return;
  }
  const app = { id: uid(), project: up.project, task: up.task, name: file.name, type: fileType(file.name), size: fsize(file.size), by: D().me, at: Date.now() };
  try {
    const rec = await uploadFile(app, file, {
      onProgress: frac => {
        up.pct = Math.max(up.pct, Math.min(100, Math.round(frac * 100)));
        document.getElementById('upbar-' + up.id)?.style.setProperty('--p', up.pct / 100);
        const label = document.getElementById('upct-' + up.id);
        if (label) label.textContent = up.pct + '%';
      },
    });
    gone();
    if (!rec) return; // the session ended while this was uploading
    const t = up.task && task(up.task);
    if (t) {
      // Not through mutate(): the file is on the server already, so the pointer to it must be recorded even if the connection just dropped.
      t.attachments.push({ id: rec.id, name: rec.name, type: rec.type, size: rec.size, by: rec.by, at: rec.at });
      logAct('added a file to', t, rec.name);
      save();
    }
    remoteRender();
    toast(`Uploaded ${rec.name}`);
  } catch (err) {
    gone();
    remoteRender();
    if (err.isAbort) return; // signed out meanwhile
    if (err.status === 401) return sessionEnded();
    const why = err.status === 0 ? "can't reach the server" : uploadMessage(err);
    toast(`Couldn't upload ${file.name}: ${why}`, {
      kind: 'err',
      ms: 7000,
      ...(err.status === 0 && { action: 'Try again', onAction: () => handleFiles([file], ctx) }),
    });
  }
}
/* One hidden file input serves every Upload button, attach icon and dropzone, and the task form. It is created once and is never part
   of a render. A native file dialog belongs to its input element: if the page were rebuilt while the dialog is open (a colleague's
   change arriving, an upload finishing), an input inside it would be thrown away and the file the person then picks would go nowhere,
   without a word. The controls are plain buttons that open this one. `pickFor` says what to do with the chosen files. */
let picker = null;
let pickFor = null;
function pick(onFiles) {
  if (!picker) {
    picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
    picker.setAttribute('aria-hidden', 'true');
    picker.tabIndex = -1;
    picker.addEventListener('click', e => e.stopPropagation()); // the app's own click handling has nothing to do with this one
    picker.addEventListener('change', () => {
      const chosen = [...picker.files]; // a copy: the input is emptied right away, so the next pick fires `change` even for the same file
      picker.value = '';
      if (chosen.length) pickFor?.(chosen);
    });
    document.body.append(picker);
  }
  pickFor = onFiles;
  picker.click();
}
A.pickFiles = el => {
  const ctx = { project: el.dataset.project, task: el.dataset.task }; // read now: el is gone by the time a file is chosen, if the page was rebuilt
  pick(chosen => handleFiles(chosen, ctx));
};

/* comments */
IN.draft = el => {
  const id = el.dataset.id;
  S.ui.drafts[id] = el.value;
  const before = el.value.slice(0, el.selectionStart);
  const m = before.match(/(?:^|\s)@([A-Za-z]*)$/);
  const prev = JSON.stringify(S.ui.mention);
  S.ui.mention = m ? { tid: id, q: m[1] } : null;
  if (prev !== JSON.stringify(S.ui.mention)) render();
  if (el.dataset.autosize != null) autosize(el);
};
A.pickMention = el => {
  const id = el.dataset.id;
  const d = S.ui.drafts[id] || '';
  S.ui.drafts[id] = d.replace(/@([A-Za-z]*)$/, '@' + el.dataset.name + ' ');
  S.ui.mention = null;
  render();
  const ta = $('#d-cmt');
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
};
A.insertAt = el => {
  const id = el.dataset.id;
  const d = S.ui.drafts[id] || '';
  S.ui.drafts[id] = d + (d && !d.endsWith(' ') ? ' @' : '@');
  S.ui.mention = { tid: id, q: '' };
  render();
  const ta = $('#d-cmt');
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
};
KEY.postComment = el => A.postComment(el);
A.postComment = el => {
  const id = el.dataset.id;
  const txt = (S.ui.drafts[id] || '').trim();
  if (!txt) {
    $('#d-cmt, #inbox-reply')?.focus();
    return;
  }
  const fresh = latest(`comment:${id}`);
  mutate(
    () => {
      D().comments.push({ id: uid('c'), task: id, by: D().me, at: Date.now(), text: txt, re: {} });
      logAct('commented on', task(id));
      if ((S.ui.drafts[id] || '').trim() === txt) S.ui.drafts[id] = ''; // not text typed since, if this is a retry
      S.ui.mention = null;
      S.ui.drawerTab = 'comments';
    },
    () => {
      if (S.ui.route === 'inbox') toast('Reply posted');
    },
    () => fresh() && !!task(id),
  );
};
A.delComment = el => {
  const id = el.dataset.id;
  let snap;
  mutate(
    () => {
      snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
      D().comments = D().comments.filter(x => x.id !== id); // by id: sync can replace the comment while a refused delete waits for "Try again"
    },
    () => toast('Comment deleted', { action: 'Undo', onAction: () => restore(snap) }),
    () => D().comments.some(x => x.id === id), // not for a comment that has gone since
  );
};
A.react = el => {
  const id = el.dataset.id;
  const e = el.dataset.e;
  S.ui.pop = null;
  const fresh = latestFields('comment', id, [`react:${e}`]);
  mutate(
    () => {
      const c = D().comments.find(x => x.id === id); // by id: sync can replace the comment while a refused edit waits for "Try again"
      c.re = c.re || {};
      const l = c.re[e] || [];
      c.re[e] = l.includes(D().me) ? l.filter(x => x !== D().me) : [...l, D().me];
    },
    undefined,
    () => fresh() && D().comments.some(x => x.id === id),
  );
};

/* rich text description */
document.addEventListener('mousedown', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  e.preventDefault();
  const [cmd, arg] = b.dataset.cmd.split(':');
  if (cmd === 'createLink') {
    const s = String(getSelection());
    if (/^https?:\/\//.test(s)) document.execCommand('createLink', false, s);
    else toast('Select a URL starting with https:// to turn it into a link', { kind: 'info' });
  } else document.execCommand(cmd, false, arg ? `<${arg}>` : null);
  const ed = $('#d-desc');
  if (ed) {
    const t = task(ed.dataset.rte);
    t.desc = sanitizeHtml(ed.innerHTML);
    save();
  }
});
document.addEventListener('input', e => {
  const ed = e.target.closest?.('[data-rte]');
  if (!ed) return;
  const t = task(ed.dataset.rte);
  if (t) {
    t.desc = sanitizeHtml(ed.innerHTML);
    t.updated = Date.now();
    save();
  }
});
/* Pasted HTML is cleaned before it enters the editor, so markup from another page (handlers, scripts, styles) never lands in a description. */
document.addEventListener('paste', e => {
  const ed = e.target.closest?.('[data-rte]');
  const html = e.clipboardData?.getData('text/html');
  if (!ed || !html) return;
  e.preventDefault();
  document.execCommand('insertHTML', false, sanitizeHtml(html));
});

/* selection & bulk */
A.selRow = el => {
  const id = el.dataset.id;
  S.ui.sel.has(id) ? S.ui.sel.delete(id) : S.ui.sel.add(id);
  render();
};
A.selAll = el => {
  const ids = $$('[data-task-row]', el.closest('.tlist')).map(r => r.dataset.taskRow);
  const all = ids.every(i => S.ui.sel.has(i));
  ids.forEach(i => (all ? S.ui.sel.delete(i) : S.ui.sel.add(i)));
  render();
};
A.clearSel = () => {
  S.ui.sel.clear();
  render();
};
A.bulkSet = el => {
  const f = el.dataset.f;
  let v = el.dataset.v || null;
  const ids = [...S.ui.sel];
  S.ui.pop = null;
  const live = liveTasks(ids, [f]); // per task: one that was edited again since is left alone
  let n = 0;
  mutate(
    () => {
      const ts = live().map(task); // by id: sync or Undo can replace or remove a task while a refused edit waits for "Try again"
      ts.forEach(t => applyPatch(t, { [f]: v }));
      n = ts.length;
    },
    () => toast(`Updated ${n} task${n > 1 ? 's' : ''}`),
    // the project or member can be gone by the time "Try again" runs: applyPatch would skip the field, and "Updated N" would be wrong
    () => live().length > 0 && (f !== 'project' || !!proj(v)) && (f !== 'assignee' || !v || !!mem(v)),
  );
};
A.bulkDelete = () => {
  const ids = [...S.ui.sel];
  confirmDlg({
    title: `Delete ${ids.length} task${ids.length > 1 ? 's' : ''}?`,
    body: 'The selected tasks, their subtasks, and comments will be permanently deleted.',
    ok: `Delete ${ids.length} task${ids.length > 1 ? 's' : ''}`,
    danger: true,
    run: () => {
      let snap;
      mutate(
        () => {
          snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
          deleteTasks(ids);
        },
        () => toast(`Deleted ${ids.length} tasks`, { action: 'Undo', onAction: () => restore(snap) }),
        () => ids.some(id => !!task(id)), // not once they have all gone: there would be nothing to delete, and Undo would restore nothing
      );
    },
  });
};

/* views: sort, group, filters, columns */
A.sortBy = el => {
  const v = viewOf(el.dataset.key);
  const f = el.dataset.f;
  if (S.ui.justResized) return;
  v.sort = v.sort.f === f ? { f, dir: -v.sort.dir } : { f, dir: 1 };
  save();
  render();
};
A.setSort = el => {
  const v = viewOf(el.dataset.key);
  v.sort = { f: el.dataset.v, dir: v.sort.dir || 1 };
  S.ui.pop = null;
  save();
  render();
};
A.setSortDir = el => {
  viewOf(el.dataset.key).sort.dir = +el.dataset.v;
  save();
  render();
};
A.setGroup = el => {
  viewOf(el.dataset.key).group = el.dataset.v;
  S.ui.pop = null;
  save();
  render();
};
A.toggleGroup = el => {
  const gk = el.dataset.gk;
  S.ui.collapsedGroups[gk] = el.getAttribute('aria-expanded') === 'true';
  render();
};
A.setViewMode = el => {
  viewOf(el.dataset.key).mode = el.dataset.v;
  save();
  render();
};
A.toggleCol2 = el => {
  const v = viewOf(el.dataset.key);
  const c = el.dataset.v;
  v.hidden = v.hidden.includes(c) ? v.hidden.filter(x => x !== c) : [...v.hidden, c];
  save();
  render();
};
A.resetCols = el => {
  viewOf(el.dataset.key).colW = {};
  S.ui.pop = null;
  save();
  render();
};
IN.viewQ = el => {
  viewOf(el.dataset.key).q = el.value;
  render();
};
A.addFilter = el => {
  const v = viewOf(el.dataset.key);
  v.filters.push({ f: el.dataset.f, op: 'is', v: [] });
  if (S.ui.pop?.type === 'filter') S.ui.pop.edit = v.filters.length - 1;
  else {
    const r = el.getBoundingClientRect();
    S.ui.pop = { type: 'filter', key: el.dataset.key, x: r.left, y: r.bottom + 4, edit: v.filters.length - 1 };
  }
  save();
  render();
};
A.fEdit = el => {
  const p = S.ui.pop;
  p.edit = p.edit === +el.dataset.i ? null : +el.dataset.i;
  render();
};
A.fToggleVal = el => {
  const f = viewOf(el.dataset.key).filters[+el.dataset.i];
  const x = el.dataset.v;
  f.v = f.v.includes(x) ? f.v.filter(y => y !== x) : [...f.v, x];
  save();
  render();
};
A.rmFilter = el => {
  const v = viewOf(el.dataset.key);
  v.filters.splice(+el.dataset.i, 1);
  if (S.ui.pop && S.ui.pop.type === 'fvals') S.ui.pop = null;
  if (S.ui.pop?.type === 'filter') S.ui.pop.edit = null;
  save();
  render();
};
A.clearFilters = el => {
  const v = viewOf(el.dataset.key);
  v.filters = [];
  v.q = '';
  S.ui.pop = null;
  save();
  render();
};
IN.fField = el => {
  const f = viewOf(el.dataset.key).filters[+el.dataset.i];
  f.f = el.value;
  f.v = [];
  S.ui.pop.edit = +el.dataset.i;
  save();
  render();
};
IN.fOp = el => {
  viewOf(el.dataset.key).filters[+el.dataset.i].op = el.value;
  save();
  render();
};
A.saveView = el => {
  const k = 'p:' + el.dataset.id;
  openModal({ type: 'saveView', pid: el.dataset.id, nf: viewOf(k).filters.length });
};
/* A change that calls save() itself, not mutate(), is kept while offline and sent once the connection is back (merged with the
   server's copy first). Its toast then says that, not "saved". `offline` says what was done, without a full stop. The offline toast
   stays on screen for the default time even when `opt.ms` asks for less: `ms` was chosen for the short "saved", not for this sentence. */
const savedToast = (online, offline, opt) =>
  S.ui.offline ? toast(`${offline}. The change will be saved when your connection is back.`, { ...opt, ms: undefined }) : toast(online, opt);
A.saveViewSubmit = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const name = $('#sv-name').value.trim() || 'Untitled view';
  const type = $('#sv-type').value;
  const sv = { id: uid('v'), project: m.pid, name, type, filters: JSON.parse(JSON.stringify(viewOf('p:' + m.pid).filters)) };
  D().savedViews.push(sv);
  save();
  S.ui.modals.pop();
  go('project', { id: m.pid, tab: 'v:' + sv.id }, { tab: true });
  savedToast(`Saved view “${name}”`, `Added view “${name}”`);
};
A.renameView = el => {
  const v = D().savedViews.find(x => x.id === el.dataset.id);
  S.ui.pop = null;
  openModal({
    type: 'prompt',
    title: 'Rename view',
    label: 'View name',
    value: v.name,
    run: val => {
      if (val) {
        v.name = val;
        save();
      }
    },
  });
};
A.delView = el => {
  const v = D().savedViews.find(x => x.id === el.dataset.id);
  S.ui.pop = null;
  D().savedViews = D().savedViews.filter(x => x !== v);
  save();
  if (S.ui.params.tab === 'v:' + v.id) go('project', { id: v.project, tab: 'list' }, { tab: true });
  else render();
  savedToast(`Deleted view “${v.name}”`, `Deleted view “${v.name}”`);
};

/* board column menu */
A.toggleCol = el => {
  delete S.ui.collapsedCols[el.dataset.ck];
  render();
};
A.colCollapse = el => {
  S.ui.collapsedCols[S.ui.pop.key + ':' + el.dataset.id] = true;
  S.ui.pop = null;
  render();
};
A.colAdd = el => {
  const key = S.ui.pop.key;
  const pid = projectFromKey(key);
  S.ui.pop = null;
  A.startComposer({ dataset: { ctx: key, group: el.dataset.id, gb: JSON.stringify({ status: el.dataset.id, ...(pid ? { project: pid } : {}) }) } });
};
export function colTasks(key, st) {
  const pid = projectFromKey(key);
  return (pid ? tasksOf(pid) : allTasks()).filter(t => t.status === st);
}
A.colDoneAll = el => {
  const col = el.dataset.id;
  const ids = colTasks(S.ui.pop.key, col).map(t => t.id);
  S.ui.pop = null;
  if (!ids.length) {
    render();
    return;
  }
  let ts, snap;
  const fresh = liveTasks(ids, ['status']);
  const live = () => fresh().filter(id => task(id).status === col); // still in the column: one moved out since is left where it is
  mutate(
    () => {
      snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
      ts = live().map(task); // by id: sync or Undo can replace or remove tasks while a refused edit waits for "Try again"
      ts.forEach(t => applyPatch(t, { status: 'done' }));
    },
    () => toast(`Marked ${ts.length} tasks as done`, { action: 'Undo', onAction: () => restore(snap) }),
    () => live().length > 0,
  );
};
A.colArchive = () => {
  const ids = colTasks(S.ui.pop.key, 'done').map(t => t.id);
  S.ui.pop = null;
  let ts, snap;
  const live = liveTasks(ids, ['archived']);
  const completed = () =>
    live()
      .map(task)
      .filter(t => t.status === 'done' && !t.archived); // colTasks' criterion again: not a task reopened or archived since
  mutate(
    () => {
      snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
      ts = completed(); // by id, as above
      ts.forEach(t => {
        t.archived = true;
        t.archivedAt = Date.now();
      });
    },
    () => toast(`Archived ${ts.length} completed tasks`, { action: 'Undo', onAction: () => restore(snap) }),
    () => completed().length > 0,
  );
};
A.colSortPrio = el => {
  const ts = colTasks(S.ui.pop.key, el.dataset.id).sort((a, b) => PR[b.priority].w - PR[a.priority].w);
  const base = Math.min(...ts.map(t => t.order));
  const ids = ts.map(t => t.id);
  S.ui.pop = null;
  const live = liveTasks(ids, ['order']);
  mutate(
    () => {
      const alive = new Set(live());
      ids.forEach((id, i) => {
        if (alive.has(id)) task(id).order = base + i * 0.001; // by id: sync or Undo can replace or remove a task while a refused edit waits for "Try again"
      });
    },
    undefined,
    () => live().length > 0,
  );
};

/* calendar & timeline */
A.calNav = el => {
  const d = +el.dataset.d;
  const cur = parse(S.ui.calDate);
  S.ui.calDate = d === 0 ? iso(TODAY) : S.ui.calMode === 'month' ? iso(new Date(cur.getFullYear(), cur.getMonth() + d, 1)) : iso(addD(cur, d * 7));
  render();
};
A.tlToday = () => {
  const r = $('#tl-right');
  if (r) r.scrollTo({ left: Math.max(0, +$('.tl').dataset.tlToday - 160), behavior: 'smooth' });
};
IN.tlGroup = el => {
  S.ui.tlGroup = el.value;
  render();
};

/* projects */
IN.projQ = el => {
  S.ui.projQ = el.value;
  render();
};
IN.projStatus = el => {
  S.ui.projStatus = el.value;
  render();
};
IN.projSort = el => {
  S.ui.projSort = el.value;
  render();
};
A.clearProjFilters = () => {
  S.ui.projQ = '';
  S.ui.projStatus = 'all';
  render();
};
A.newProject = () => {
  if (needWorkspace(A.newProject)) return;
  const teams = teamsList();
  const team = (teams.find(t => t.id === me().team) || teams[0])?.id || '';
  S.ui.pform = { name: '', desc: '', icon: 'folder', color: 'indigo', team, lead: D().me, due: dOff(30), tmpl: 'blank' };
  S.ui.errors = {};
  S.ui.pop = null;
  openModal({ type: 'project' });
};
A.editProject = el => {
  const p = proj(el.dataset.id);
  S.ui.pop = null;
  S.ui.pform = { name: p.name, desc: p.desc, icon: p.icon, color: p.color, team: p.team, lead: p.lead, due: p.due, tmpl: 'blank' };
  S.ui.errors = {};
  openModal({ type: 'project', edit: p.id });
};
IN.pform = el => {
  S.ui.pform[el.dataset.f] = el.value;
  if (el.dataset.f === 'name' && S.ui.errors.pname && el.value.trim()) {
    S.ui.errors.pname = null;
    render();
  }
};
A.pformSet = el => {
  S.ui.pform[el.dataset.f] = el.dataset.v;
  if (el.dataset.f === 'tmpl') {
    const t = TEMPLATES.find(x => x.id === el.dataset.v);
    if (t && S.ui.pform.icon === 'folder') S.ui.pform.icon = t.icon === 'file' ? 'folder' : t.icon;
  }
  render();
};
export function makeKey(name) {
  let k = name
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  if (k.length < 2)
    k =
      name
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 3)
        .toUpperCase() || 'PRJ';
  while (D().projects.some(p => p.key === k)) k += 'X';
  return k;
}
export function createProject(f, tmplId) {
  const p = {
    id: uid('p'),
    workspace: D().ws.id,
    key: makeKey(f.name),
    name: f.name,
    icon: f.icon,
    color: f.color,
    status: 'planning',
    team: f.team,
    lead: f.lead,
    due: f.due || dOff(30),
    start: dOff(0),
    fav: false,
    members: [...new Set([D().me, f.lead])],
    desc: f.desc || 'No description yet.',
    milestones: [],
    last: 0,
  };
  D().projects.push(p);
  D().projOrder.unshift(p.id);
  D().activity.unshift({ id: uid('a'), by: D().me, verb: 'created project', task: null, project: p.id, at: Date.now(), extra: '' });
  const tm = TEMPLATES.find(t => t.id === tmplId);
  (tm?.tasks || []).forEach((title, i) =>
    createTask({
      project: p.id,
      title,
      status: i === 0 ? 'todo' : 'backlog',
      assignee: i === 0 ? D().me : null,
      priority: i === 0 ? 'high' : 'medium',
      due: dOff(5 + i * 5),
      start: dOff(i * 5),
    }),
  );
  return p;
}
A.submitProject = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.pform;
  f.name = ($('#p-name')?.value || '').trim();
  f.desc = $('#p-desc')?.value || '';
  if (!f.name) {
    S.ui.errors.pname = 'Give the project a name';
    render();
    $('#p-name')?.focus();
    return;
  }
  const fresh = latest(m);
  const still = () => isTop(m) && fresh();
  // What the save applies is copied here, once validated: the form stays editable after an offline refusal, and "Try again" must not pick up what was typed since.
  const v = { ...f };
  if (m.edit) {
    const id = m.edit;
    mutate(
      () => {
        const p = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
        Object.assign(p, {
          name: v.name,
          desc: v.desc,
          icon: v.icon,
          color: v.color,
          team: v.team,
          lead: v.lead,
          due: v.due,
          members: [...new Set([...p.members, v.lead])],
        });
      },
      () => {
        S.ui.modals.pop();
        render();
        toast('Project updated');
      },
      () => still() && !!proj(id),
    );
    return;
  }
  if (needWorkspace()) return; // the workspace went away while the form was open
  let p;
  mutate(
    () => {
      p = createProject(v, v.tmpl);
    },
    () => {
      S.ui.modals.pop();
      go('project', { id: p.id, tab: v.tmpl === 'blank' ? 'overview' : S.prefs.defaultTab || 'board' });
      toast(`Created ${p.name}${tasksOf(p.id).length ? ` with ${tasksOf(p.id).length} starter tasks` : ''}`);
    },
    still,
  );
};
A.dupProject = el => {
  const id = el.dataset.id;
  S.ui.pop = null;
  if (needWorkspace()) return;
  let p, n;
  mutate(
    () => {
      p = proj(id); // by id: a merge while a refused edit waits for "Try again" must not leave the copy with the values from the click
      n = createProject({ ...p, name: p.name + ' copy' }, 'blank');
      tasksOf(p.id).forEach(t => createTask({ ...JSON.parse(JSON.stringify(t)), id: uid('t'), key: undefined, project: n.id, status: 'todo' }));
    },
    () => toast(`Duplicated ${p.name}`, { action: 'Open', onAction: () => go('project', { id: n.id }) }),
    () => !!proj(id), // not for a project that has gone since
  );
};
A.archiveProject = el => {
  const p = proj(el.dataset.id);
  S.ui.pop = null;
  confirmDlg({
    title: `Archive ${p.name}?`,
    body: 'The project will be hidden from the sidebar and project lists. Tasks, files, and comments are kept, and you can restore it from Settings → Projects.',
    ok: 'Archive project',
    icon: 'archive',
    run: () => {
      const id = p.id;
      if (!proj(id)) return; // gone while the dialog was open
      let pr, snap;
      const fresh = latestFields('proj', id, ['archived']);
      mutate(
        () => {
          pr = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
          snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
          pr.archived = true;
          pr.archivedAt = Date.now();
        },
        () => {
          if (S.ui.route === 'project' && S.ui.params.id === id) go('projects');
          toast(`Archived ${pr.name}`, { action: 'Undo', onAction: () => restore(snap) });
        },
        () => fresh() && !!proj(id), // not for a project that has gone since
      );
    },
  });
};
A.restoreProject = el => {
  const id = el.dataset.id;
  let p;
  const fresh = latestFields('proj', id, ['archived']);
  mutate(
    () => {
      p = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
      p.archived = false;
      p.archivedAt = null;
    },
    () => toast(`Restored ${p.name}`),
    () => fresh() && !!proj(id),
  );
};
A.delProject = el => {
  const p = proj(el.dataset.id);
  S.ui.pop = null;
  const n = tasksOf(p.id).length;
  confirmDlg({
    title: `Delete ${p.name}?`,
    body: `This permanently deletes the project and its <b>${n} task${n === 1 ? '' : 's'}</b>, files, and comments for everyone. This can't be undone.`,
    ok: 'Delete project',
    danger: true,
    typeName: p.name,
    run: () => {
      mutate(
        () => {
          const ids = tasksOf(p.id).map(t => t.id);
          D()
            .tasks.filter(t => t.project === p.id)
            .forEach(t => ids.push(t.id));
          deleteTasks(ids);
          D().projects = D().projects.filter(x => x.id !== p.id); // by id: sync can replace the project while a refused delete waits for "Try again"
          D().projOrder = D().projOrder.filter(x => x !== p.id);
          D().files = D().files.filter(f => f.project !== p.id);
        },
        () => {
          if (S.ui.route === 'project' && S.ui.params.id === p.id) go('projects');
          toast(`Deleted ${p.name}`);
        },
        () => !!proj(p.id), // not for a project that has gone since
      );
    },
  });
};
A.requestAccess = el => {
  const p = proj(el.dataset.id);
  toast(`Access requested. We'll notify you when ${mem(p?.lead)?.name || 'the owner'} responds.`);
};

/* sharing */
A.share = el => {
  const id = el.dataset.id || curProjectId();
  S.ui.shareQ = '';
  S.ui.pop = null;
  openModal({ type: 'share', id });
};
IN.shareQ = el => {
  S.ui.shareQ = el.value;
  render();
};
A.shareAdd = el => {
  const id = el.dataset.id;
  const m = mem(el.dataset.mid);
  let p;
  const fresh = latestFields('proj', id, [`perm:${m.id}`]); // the same key as sharePerm: adding and removing a person are edits of the same thing
  mutate(
    () => {
      p = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
      p.members.push(m.id);
    },
    () => toast(`${m.name} can now edit ${p.name}`),
    () => fresh() && !!mem(m.id) && !!proj(id) && !proj(id).members.includes(m.id), // not for a person or project that has gone since; a replay would list them twice
  );
  S.ui.shareQ = '';
  render();
};
A.shareInvite = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const p = proj(m.id);
  const v = ($('#share-in')?.value || '').trim();
  if (!v) {
    $('#share-in')?.focus();
    return;
  }
  const ex = D().members.find(x => x.email.toLowerCase() === v.toLowerCase() || x.name.toLowerCase() === v.toLowerCase());
  if (ex) {
    const shared = () => toast(`Shared with ${ex.name}`);
    if (p.members.includes(ex.id)) shared();
    else {
      const fresh = latestFields('proj', p.id, [`perm:${ex.id}`]);
      mutate(
        () => {
          proj(p.id).members.push(ex.id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
        },
        shared,
        () => fresh() && !!mem(ex.id) && !!proj(p.id) && !proj(p.id).members.includes(ex.id), // not for a person or project that has gone since; a replay would list them twice
      );
    }
    S.ui.shareQ = '';
    render();
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(v)) {
    toast('Enter a valid email address, like name@company.com', { kind: 'err' });
    return;
  }
  toast(`No account for ${v}. Ask an admin to create one.`, { kind: 'err' });
};
/* The only per-person choice that does anything is taking the person off the project. (There is no access level to pick: see shareModal.) */
IN.sharePerm = el => {
  const id = el.dataset.id;
  const mid = el.dataset.mid;
  if (!proj(id) || el.value !== '__remove') return;
  let snap;
  const fresh = latestFields('proj', id, [`perm:${mid}`]);
  mutate(
    () => {
      snap = snapshot(); // taken here, not at the click: after "Try again" the one from the click is too old to undo to
      const p = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
      p.members = p.members.filter(x => x !== mid);
    },
    () => toast(`Removed ${mem(mid)?.name || FORMER}`, { action: 'Undo', onAction: () => restore(snap) }),
    () => fresh() && !!proj(id)?.members.includes(mid), // not for a project that has gone since, or a person who is no longer on it
  );
};
/* "Only people invited" sets `private`, the column the server's access rules read, so the server stops handing the project (and its
   tasks, comments, files and events) to anybody who is not on `members` (admins excepted). The person who flips it and the project's
   lead are put on `members` first: the rule is checked against the project as it is after this save, and without that the person
   would lose the project the moment it saves. `access` is the old, display-only copy of the same choice; it follows `private`. */
IN.shareAccess = el => {
  const id = el.dataset.id;
  const p = proj(id);
  if (!p) return;
  const priv = el.value === 'private';
  if (priv === !!p.private) return;
  const mine = D().me;
  let pr;
  const fresh = latestFields('proj', id, ['access']);
  mutate(
    () => {
      pr = proj(id); // by id: sync or Undo can replace the project while a refused edit waits for "Try again"
      pr.private = priv;
      pr.access = priv ? 'private' : 'workspace';
      if (priv) pr.members = [...new Set([...pr.members, mine, pr.lead].filter(Boolean))];
    },
    () =>
      toast(priv ? `${pr.name} is private now. Only the people invited, and admins, can open it.` : `Everyone at ${D().ws.name} can open ${pr.name} now.`, {
        ms: 4800,
      }),
    () => fresh() && !!proj(id), // not for a project that has gone since
  );
};
A.viewProfile = el => go('member', { id: el.dataset.id });
A.assignToMember = el => {
  S.ui.pop = null;
  A.newTask({ dataset: { assignee: el.dataset.id } });
};
IN.memQ = el => {
  S.ui.memQ = el.value;
  render();
};
IN.actWho = el => {
  S.ui.actWho = el.value;
  render();
};

/* files */
IN.fileQ = el => {
  S.ui.fileQ = el.value;
  render();
};
IN.fileType = el => {
  S.ui.fileType = el.value;
  render();
};
IN.fileSort = el => {
  S.ui.fileSort = el.value;
  render();
};
/* Renaming changes the display name only. The stored file stays as it is; downloads are named after the display name
   (server/pb_hooks/file_names.pb.js), and task attachments show the name of the file they point to. */
A.renameFile = el => {
  const f = D().files.find(x => x.id === el.dataset.id);
  S.ui.pop = null;
  if (!f) return render();
  openModal({
    type: 'prompt',
    title: 'Rename file',
    label: 'File name',
    value: f.name,
    run: v => {
      const id = f.id;
      if (!D().files.some(x => x.id === id)) return; // gone while the dialog was open
      if (v && v !== f.name) {
        const fresh = latestFields('file', id, ['name']);
        mutate(
          () => {
            const cur = D().files.find(x => x.id === id); // by id: sync can replace the file while a refused rename waits for "Try again"
            cur.name = v;
            cur.type = fileType(v);
          },
          undefined,
          () => fresh() && D().files.some(x => x.id === id),
        );
      }
    },
  });
};
A.delFile = el => {
  const f = D().files.find(x => x.id === el.dataset.id);
  S.ui.pop = null;
  if (!f) return render();
  confirmDlg({
    title: 'Delete file?',
    body: `<b>${esc(f.name)}</b> will be removed from the project${f.task ? ' and its task' : ''}.`,
    ok: 'Delete file',
    danger: true,
    run: () => {
      mutate(
        () => {
          D().files = D().files.filter(x => x.id !== f.id); // by id: sync can replace the file while a refused delete waits for "Try again"
          // The sync deletes the record and its stored file. Every attachment that points to it goes too, found by the record's id; an
          // attachment from before they carried it (its id matches no file) is found by name on the file's own task.
          const known = new Set(D().files.map(x => x.id));
          const points = (t, a) => a.id === f.id || (t.id === f.task && !known.has(a.id) && a.name === f.name);
          for (const t of D().tasks)
            if (Array.isArray(t.attachments) && t.attachments.some(a => points(t, a))) t.attachments = t.attachments.filter(a => !points(t, a));
        },
        () => toast(`Deleted ${f.name}`),
        () => D().files.some(x => x.id === f.id), // not for a file that has gone since
      );
    },
  });
};

/* inbox & notifications */
A.selNotif = el => {
  const n = D().notifs.find(x => x.id === el.dataset.id);
  n.read = true;
  S.ui.inboxSel = n.id;
  save();
  render();
};
A.toggleRead = el => {
  const n = D().notifs.find(x => x.id === el.dataset.id);
  n.read = !n.read;
  save();
  render();
};
A.markAllRead = () => {
  const n = D().notifs.filter(x => !x.read).length;
  D().notifs.forEach(x => (x.read = true));
  save();
  render();
  if (n) toast("You're all caught up.");
};
A.toggleUnreadOnly = () => {
  S.ui.inboxUnread = !S.ui.inboxUnread;
  render();
};
A.openNotif = el => {
  const n = D().notifs.find(x => x.id === el.dataset.id);
  n.read = true;
  save();
  if (n.task) A.openTask({ dataset: { id: n.task } });
  else if (n.project) go('project', { id: n.project, tab: 'overview' });
};

/* search & palette */
A.openPalette = () => {
  S.ui.palOpener = focusKey(document.activeElement);
  S.ui.palette = { q: '', mode: 'cmd', scope: 'all', hl: 0 };
  S.ui.pop = null;
  render();
};
A.openSearch = () => {
  S.ui.palOpener = focusKey(document.activeElement);
  S.ui.palette = { q: '', mode: 'search', scope: 'all', hl: 0 };
  S.ui.pop = null;
  S.ui.mnav = false;
  render();
};
A.closePalette = () => {
  S.ui.palette = null;
  render();
};
A.palScope = el => {
  S.ui.palette.scope = el.dataset.v;
  S.ui.palette.hl = 0;
  render();
  $('#pal-in')?.focus();
};
IN.palQ = el => {
  S.ui.palette.q = el.value;
  S.ui.palette.hl = 0;
  render();
};
A.palRun = el => {
  const it = S.ui.palette?._flat?.[+el.dataset.i];
  if (!it) return;
  S.ui.palette = null;
  render();
  it.run();
};
IN.searchQ = el => {
  S.ui.searchQ = el.value;
  render();
};
A.setSearch = el => {
  S.ui.searchQ = el.dataset.q;
  render();
  $('#search-page-q')?.focus();
};

/* workspace, account, and the design-system demo triggers */
/* Makes `w` (an entry of D().workspaces) the current workspace and remembers the choice in the person's settings. */
export function setWorkspace(w) {
  D().ws = { id: w.id, name: w.name, url: w.url || w.name.toLowerCase().replace(/[^a-z0-9]+/g, ''), c: w.c, brand: !!w.brand };
  save();
}
A.switchWs = el => {
  const w = D().workspaces.find(x => x.id === el.dataset.v);
  S.ui.pop = null;
  setWorkspace(w);
  go('home');
  toast(`Switched to ${w.name}`);
};
/* The admin's "Create workspace" dialog. `then`, when given, runs once the workspace exists and is the current one (the flow that
   needed a workspace carries on from there); `why` is the line under the title. */
export function createWorkspace(then, why = '') {
  S.ui.pop = null;
  if (!isAdmin()) return;
  openModal({
    type: 'prompt',
    title: 'Create workspace',
    sub: why,
    label: 'Workspace name',
    ok: 'Create workspace',
    run: v => {
      if (!v) {
        toast('Name your workspace to create it', { kind: 'err' });
        return;
      }
      const w = { id: uid('w'), name: v, c: ['#2F2E2A', '#5A67D8', '#23918A', '#C54B78'][D().workspaces.length % 4] };
      const fresh = latest('workspace');
      mutate(
        () => D().workspaces.push(w),
        () => {
          A.switchWs({ dataset: { v: w.id } });
          then?.();
        },
        // The prompt closes before this runs, so there is no modal to test: skip the retry if a later attempt has been made, this one went in,
        // or a workspace of that name has appeared since (names aren't unique on the server).
        () => fresh() && !D().workspaces.some(x => x.id === w.id || x.name.toLowerCase() === v.toLowerCase()),
      );
    },
  });
}
A.newWorkspace = () => createWorkspace();
/* Projects and teams belong to a workspace (their `workspace` column). On a server that has none yet, D().ws.id is '' and whatever got
   created would be stamped with '' and never show once a workspace exists. So creating one waits for a workspace: an admin is taken to
   "Create workspace" first and carries on from there with `then`; anybody else is told whom to ask. Returns true when it stopped the
   caller. */
export function needWorkspace(then) {
  if (D().ws.id) return false;
  S.ui.pop = null;
  if (isAdmin()) createWorkspace(then, 'Projects and teams live in a workspace, so create one first.');
  else {
    render();
    toast('Ask an admin to create a workspace first.', { kind: 'info' });
  }
  return true;
}
/* The sign-in page with nothing of the last session left in memory: data, settings, views, route, history and open panels are reset.
   `message` shows above the form (why the session ended). A toast that stays until dismissed goes with the session. */
export function showLogin(message = '') {
  clearStickyToasts();
  resetStore();
  S.ui.auth = 'login';
  if (message) S.ui.errors.login = message;
  render();
}
/* The server answered 401 to something the sync engine did not send (an upload, the password change): the session is over. End it the way
   the engine does. stopSync() comes first so that the engine does not also report it, with its own words, when the store is cleared. */
async function sessionEnded() {
  await stopSync();
  pb.authStore.clear();
  showLogin('Your session expired. Sign in again.');
}
A.signOut = async () => {
  S.ui.pop = null;
  const leave = async () => {
    await stopSync({ flush: true }); // sends anything unsaved first, when online
    pb.authStore.clear();
    showLogin();
  };
  // Nothing is kept in the browser, so changes the server has not confirmed are gone with the session. Send them first; if they cannot go, ask.
  const n = hasUnsaved() && !(await flush()) ? pendingChanges() : 0;
  if (n) {
    confirmDlg({
      title: 'Sign out with unsent changes?',
      body: `${n} change${n > 1 ? 's have' : ' has'} not reached the server, which can't be reached right now. Signing out will discard ${n > 1 ? 'them' : 'it'}.`,
      ok: 'Sign out and discard',
      icon: 'log-out',
      danger: true,
      run: leave,
    });
    return;
  }
  await leave();
};
A.shortcuts = () => {
  S.ui.pop = null;
  S.ui.palette = null;
  openModal({ type: 'shortcuts' });
};
A.retryOnline = async el => {
  el.classList.add('is-loading');
  await retryNow(); // on success the offline bar goes away with the next render
  el.classList.remove('is-loading');
};
A.demoToast = el => {
  const v = el.dataset.v;
  if (v === 'err') toast("Your changes couldn't be saved.", { kind: 'err', action: 'Try again', onAction: () => toast('Saved') });
  else if (v === 'retry') {
    toast('Retrying…', { kind: 'info', ms: 1200 });
    setTimeout(() => toast('Loaded successfully'), 1300);
  } else toast('Moved “Create homepage wireframes” to Review', { action: 'Undo', onAction: () => toast('Undone', { kind: 'info' }) });
};
A.demoConfirm = () =>
  confirmDlg({
    title: 'Archive Marketing Website?',
    body: 'The project will be hidden from the sidebar. You can restore it any time.',
    ok: 'Archive project',
    icon: 'archive',
    run: () => toast('This was a preview — nothing was archived', { kind: 'info' }),
  });
A.demoLoad = el => {
  el.classList.add('is-loading');
  setTimeout(() => {
    el.classList.remove('is-loading');
    toast('Loaded');
  }, 1400);
};
A.reloadPage = () => {
  S.ui.loading = true;
  render();
  setTimeout(() => {
    S.ui.loading = false;
    render();
  }, 1400);
};

/* modals */
A.closeModal = () => closeModal();
A.closeModalBg = (el, e) => {
  if (e.target === el) closeModal();
};
A.confirmOk = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  if (m.typeName && S.ui.confirmText !== m.typeName) return;
  S.ui.modals.pop();
  S.ui.confirmText = '';
  render();
  m.run && m.run();
};
IN.confirmText = el => {
  S.ui.confirmText = el.value;
  const m = S.ui.modals[S.ui.modals.length - 1];
  const b = $('.modal:last-of-type [data-a="confirmOk"]') || $$('[data-a="confirmOk"]').pop();
  if (b) b.disabled = el.value !== m.typeName;
};
A.promptSubmit = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const v = $('#prompt-in').value.trim();
  S.ui.modals.pop();
  render();
  m.run(v);
};
IN.noop = () => {};

/* settings */
IN.prefToggle = el => {
  S.prefs[el.dataset.k] = el.checked;
  applyPrefs(); // a toggle does not re-render the page, and spellcheck is applied to the document
  save();
};
IN.npToggle = el => {
  D().notifPrefs[el.dataset.k] = el.checked;
  save();
  savedToast('Notification preferences saved', 'Notification preferences updated', { ms: 1500 });
};
IN.prefSel = el => {
  const k = el.dataset.k;
  S.prefs[k] = k === 'weekStart' ? +el.value : el.value;
  save();
  render();
  savedToast('Preference saved', 'Preference updated', { ms: 1500 });
};
A.wsColor = el => {
  if (!isAdmin()) return;
  D().ws.c = el.dataset.v;
  const w = D().workspaces.find(x => x.id === D().ws.id);
  if (w) w.c = D().ws.c;
  save();
  render();
};
A.saveWorkspace = () => {
  if (!isAdmin()) return;
  const n = $('#ws-name').value.trim();
  const u = $('#ws-url')
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  if (!n) {
    toast("Workspace name can't be empty", { kind: 'err' });
    return;
  }
  loadingBtn('ws-save', 600, () => {
    const fresh = latest('ws-settings'); // not 'workspace': that key is the create dialog's
    mutate(
      () => {
        D().ws.name = n;
        D().ws.url = u || D().ws.url;
        const w = D().workspaces.find(x => x.id === D().ws.id);
        if (w) Object.assign(w, { name: n, url: D().ws.url });
      },
      () => toast('Workspace settings saved'),
      () => isAdmin() && fresh(), // the reconnect can change who is an admin
    );
  });
};
A.avColor = el => {
  me().c = el.dataset.v;
  save();
  render();
};
A.saveProfile = () => {
  const n = $('#pf-name').value.trim();
  if (!n) {
    S.ui.errors.pname2 = 'Enter your name';
    render();
    return;
  }
  S.ui.errors.pname2 = null;
  const tt = $('#pf-title').value.trim();
  loadingBtn('pf-save', 600, () => {
    const fresh = latest('profile');
    mutate(
      () => {
        me().name = n;
        me().title = tt;
      },
      () => toast('Profile updated'),
      fresh,
    );
  });
};
IN.pwStrength = el => {
  S.ui.pwNew = el.value;
  const m = el.parentElement.querySelector('.row .strength')?.parentElement;
  const tmp = document.createElement('div');
  tmp.innerHTML = strengthMeter(el.value);
  if (m) m.replaceWith(tmp.firstElementChild || document.createTextNode(''));
  else if (tmp.firstElementChild) el.after(tmp.firstElementChild);
};
/* Changing the password on the server ends every session of the account, this one included (PocketBase renews the account's token
   key), and it signs the live-update stream out too: the stream stays open but receives nothing. So, in this order:
     1. send what is unsaved, while the old token still works (a request with it after step 2 would get a 401, which ends the session),
     2. change the password (the server checks the old one),
     3. sign in again with the new password right away. The store keeps the "remember me" choice of the session it replaces,
     4. open a new live-update stream with the new token, and catch up on what was missed meanwhile.
   Another tab of the same browser shares the stored session. It learns of the new token from there and needs step 4 as well, which the
   listener below does; here `renewing` keeps it from doing the same a second time. (A device with its own session is simply signed
   out: its token is dead, and the next request it makes shows the sign-in page.) */
let renewing = false;
let tokenSeen = pb.authStore.token;
pb.authStore.onChange(token => {
  const was = tokenSeen;
  tokenSeen = token;
  // Only a different token for the same person, while the app is signed in. At boot and at sign-in D().me is still empty.
  if (renewing || !token || !was || token === was || !D().me || pb.authStore.record?.id !== D().me) return;
  resubscribe();
  quietResync();
});
A.savePassword = async () => {
  if (S.ui.pwBusy) return;
  const e = (S.ui.errors = {});
  const cur = $('#pw-cur').value,
    nw = $('#pw-new').value,
    cf = $('#pw-conf').value;
  S.ui.pwDone = false;
  if (!cur) e.pwCur = 'Enter your current password';
  if (nw.length < 10 || !/[0-9\W]/.test(nw)) e.pwNew = 'Use at least 10 characters, including a number or symbol';
  if (nw !== cf) e.pwConf = "Passwords don't match";
  /* render() builds the form again; the fields the page doesn't carry in S.ui get their text back (the current password only
     if it wasn't the thing the server refused: a wrong one is better retyped from empty). */
  const redraw = (focusId, keepCurrent = true) => {
    render();
    for (const [id, v] of [
      ['pw-cur', keepCurrent ? cur : ''],
      ['pw-conf', cf],
    ]) {
      const i = $('#' + id);
      if (i) i.value = v;
    }
    $('#' + focusId)?.focus();
  };
  S.ui.pwNew = nw;
  if (Object.keys(e).length) return redraw(e.pwCur ? 'pw-cur' : e.pwNew ? 'pw-new' : 'pw-conf');
  if (S.ui.offline) {
    // Reconnecting alone would leave the password as it was: submit the form again once the server answers (if the form is still on screen).
    toast("Your password couldn't be changed. You're offline.", {
      kind: 'err',
      action: 'Try again',
      onAction: async () => {
        if ((await retryNow()) && $('#pw-cur')) A.savePassword();
      },
    });
    return;
  }
  const busy = on => {
    S.ui.pwBusy = on;
    const b = document.getElementById('pw-save');
    b?.classList.toggle('is-loading', on);
    b?.setAttribute('aria-busy', String(on));
  };
  const signedIn = pb.authStore.record;
  if (!signedIn) return;
  busy(true);
  renewing = true;
  try {
    try {
      if (!(await flush())) throw Object.assign(new Error('unsaved changes'), { status: 0 });
      await pb.collection('users').update(signedIn.id, { oldPassword: cur, password: nw, passwordConfirm: cf });
    } catch (err) {
      const fields = err.response?.data || {};
      if (fields.oldPassword) e.pwCur = 'Current password is incorrect';
      if (fields.password) e.pwNew = fields.password.message || 'That password was refused';
      if (fields.passwordConfirm) e.pwConf = "Passwords don't match";
      if (err.status === 401) await sessionEnded();
      else if (Object.keys(e).length) redraw(e.pwCur ? 'pw-cur' : e.pwNew ? 'pw-new' : 'pw-conf', !e.pwCur);
      else toast(`Couldn't change the password: ${err.status === 0 ? "can't reach the server" : err.response?.message || err.message}`, { kind: 'err' });
      return;
    }
    // The password is changed. From here the old token is dead; get a new one before anything else asks the server for something.
    let failure = null;
    for (let tries = 0; tries < 3; tries++) {
      try {
        await pb.collection('users').authWithPassword(signedIn.email, nw);
        failure = null;
        break;
      } catch (err) {
        failure = err;
        if (err.status && err.status < 500) break; // the server answered and said no: trying again won't help
        await new Promise(r => setTimeout(r, 700));
      }
    }
    if (failure) {
      await stopSync();
      pb.authStore.clear();
      showLogin('Your password was changed, but signing you back in failed. Sign in with the new password.');
      return;
    }
    await resubscribe();
    quietResync();
    S.ui.pwDone = true;
    S.ui.pwNew = '';
    render();
    toast('Password updated');
  } finally {
    renewing = false;
    busy(false);
  }
};

/* auth */
A.toggleShowPw = () => {
  const v = $('#l-pw')?.value;
  S.ui.showPw = !S.ui.showPw;
  render();
  const i = $('#l-pw');
  if (i) {
    i.value = v;
    i.focus();
  }
};
export const EMAIL_RE = /^\S+@\S+\.\S+$/;
IN.loginField = el => {
  S.ui.af = S.ui.af || {};
  S.ui.af[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
};
export function enterApp(msg) {
  S.ui.auth = null;
  S.ui.errors = {};
  S.ui.af = null;
  S.ui.showPw = false;
  go(S.prefs.home || 'home');
  A.openLink?.(); // a link that was followed while signed out (src/actions/links.js)
  toast(msg);
}
/* Why a sign-in failed, in words for the person at the keyboard. */
function signInError(err, stage) {
  const s = err?.status;
  if (s === 0 || s === 502 || s === 503 || s === 504) return "Can't reach the server. Check your connection and try again.";
  if (stage === 'password' && (s === 400 || s === 401 || s === 403 || s === 404)) return "That email and password don't match.";
  const why = err?.response?.message || err?.message || 'unknown error';
  return stage === 'password' ? `Couldn't sign in: ${why}` : `Couldn't load your data: ${why}`;
}
A.doLogin = async () => {
  if (S.ui.signingIn) return;
  const e = (S.ui.errors = {});
  const em = $('#l-email').value.trim(),
    pw = $('#l-pw').value,
    remember = $('#l-rem').checked;
  S.ui.af = { ...S.ui.af, email: em, remember };
  if (!em) e.email = 'Enter your email address';
  else if (!EMAIL_RE.test(em)) e.email = 'Enter a valid email, like name@company.com';
  if (!pw) e.pw = 'Enter your password';
  if (Object.keys(e).length) {
    render();
    (e.email ? $('#l-email') : $('#l-pw'))?.focus();
    if (!e.email) $('#l-pw').value = pw;
    return;
  }
  S.ui.signingIn = true;
  const btn = document.getElementById('login-btn');
  btn?.classList.add('is-loading');
  btn?.setAttribute('aria-busy', 'true');
  let stage = 'password';
  try {
    setRemember(remember);
    await pb.collection('users').authWithPassword(em, pw);
    stage = 'data';
    await startSync();
  } catch (err) {
    pb.authStore.clear();
    S.ui.signingIn = false;
    S.ui.errors = { login: signInError(err, stage) };
    render(); // rebuilds the form: put the password back so a typo is easy to fix
    const field = $('#l-pw');
    if (field) {
      field.value = pw;
      field.focus();
    }
    return;
  }
  S.ui.signingIn = false;
  enterApp(`Signed in as ${em}`);
};
