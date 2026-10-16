/* ---------- filter engine ---------- */
import { DAY, TODAY, diffD, esc, parse } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { PR, PRIOS, STAGE_COLORS, STATUSES } from '../core/constants.js';
import { D, S, canSee, isOver, labelsOf, mem, pColor, proj, visibleProjects } from '../core/store.js';
import { av, prIcon, stIcon } from '../ui/helpers.js';
import { defaultView } from '../core/sync-map.js';

// Its keys, and the groupings groupTasks() handles, are listed again in core/sync-map.js (VIEW_FIELDS, VIEW_GROUPS), which drops a synced
// view that names any other. Add a field or grouping in both places.
export const FIELDS = {
  status: { name: 'Status', icon: 'circle-dot', opts: () => STATUSES.map(s => ({ id: s.id, name: s.name, html: stIcon(s.id) })) },
  assignee: {
    name: 'Assignee',
    icon: 'user',
    opts: () => [
      { id: 'none', name: 'Unassigned', html: av(null, 'sm', false) },
      ...D().members.map(m => ({ id: m.id, name: m.name + (m.id === D().me ? ' (you)' : ''), html: av(m.id, 'sm', false) })),
    ],
  },
  priority: { name: 'Priority', icon: 'signal-high', opts: () => PRIOS.map(p => ({ id: p.id, name: p.name, html: prIcon(p.id) })) },
  due: {
    name: 'Due date',
    icon: 'calendar',
    opts: () => [
      { id: 'overdue', name: 'Overdue' },
      { id: 'today', name: 'Today' },
      { id: 'week', name: 'Next 7 days' },
      { id: 'later', name: 'Later' },
      { id: 'nodate', name: 'No due date' },
    ],
  },
  project: {
    name: 'Project',
    icon: 'folder',
    opts: () =>
      visibleProjects()
        .filter(canSee)
        .map(p => ({ id: p.id, name: p.name, html: `<span class="pdot" style="--c:${pColor(p)}"></span>` })),
  },
  // the current workspace's list, read when the options are drawn: a view filters the tasks of the workspace shown, and a label that was
  // removed from the list is still in the filter (`gone` names it in the chip)
  labels: {
    name: 'Labels',
    icon: 'tag',
    gone: 'Deleted label',
    opts: () => labelsOf(D().ws.id).map(l => ({ id: l.id, name: l.name, html: `<span class="pdot" style="--c:${STAGE_COLORS[l.color]}"></span>` })),
  },
  created: {
    name: 'Created date',
    icon: 'calendar-plus',
    opts: () => [
      { id: '1', name: 'Last 24 hours' },
      { id: '7', name: 'Last 7 days' },
      { id: '30', name: 'Last 30 days' },
    ],
  },
  updated: {
    name: 'Updated date',
    icon: 'history',
    opts: () => [
      { id: '1', name: 'Last 24 hours' },
      { id: '7', name: 'Last 7 days' },
      { id: '30', name: 'Last 30 days' },
    ],
  },
};
/* A saved view's filters are shared data. Keep only well-formed ones: a real field, a valid operator, a list of ids. */
export function cleanFilters(list) {
  return (Array.isArray(list) ? list : [])
    .filter(f => f && typeof f.f === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, f.f))
    .map(f => ({ f: f.f, op: f.op === 'not' ? 'not' : 'is', v: Array.isArray(f.v) ? f.v.map(String) : [] }));
}
/* The state of one view (a page, or a project's tab). Renders READ it (peekView(): nothing is stored, so opening a page is no change);
   actions that change it take it with viewOf(), change it in place and save(). A view still equal to defaultView() is not stored in the
   record either (see cleanPrefs() in core/sync-map.js).
   A project's views ('p:<project>', 'sv:<saved view>') start with the Project column hidden (it is the same in every row there; the user
   can show it again, which `_projHidden` remembers), and a saved view's tab starts from the filters it was saved with. */
const isProjView = key => key.startsWith('p:') || key.startsWith('sv:');
function seedView(key) {
  const v = defaultView();
  if (isProjView(key)) {
    v.hidden.push('project');
    v._projHidden = true;
  }
  if (key.startsWith('sv:')) v.filters = cleanFilters(D().savedViews.find(s => s.id === key.slice(3))?.filters);
  return v;
}
// For renders: the stored state of the view, or a fresh seed that is NOT stored (a render must not change what is pending).
export const peekView = key => S.views[key] || seedView(key);
// For actions that change the view (and then save()), and for nothing else: stores the seed on the first call.
export function viewOf(key) {
  if (!S.views[key]) S.views[key] = seedView(key);
  return S.views[key];
}
/* The columns hidden in a table. A project's view that an older version stored without `_projHidden` (it hid the Project column the
   first time the table was drawn, and wrote that down then) reads as having it hidden, as it did then; hideProjCol() makes that the
   stored state before an action changes the columns, so what the user saw is what is kept. */
export const hiddenCols = (key, v) => (isProjView(key) && !v._projHidden && !v.hidden.includes('project') ? [...v.hidden, 'project'] : v.hidden);
export function hideProjCol(key, v) {
  if (!isProjView(key) || v._projHidden) return;
  v._projHidden = true;
  if (!v.hidden.includes('project')) v.hidden.push('project');
}
export function matchF(t, f) {
  if (!f.v || !f.v.length) return true;
  let hit;
  if (f.f === 'labels') hit = f.v.some(v => t.labels.includes(v));
  else if (f.f === 'assignee') hit = f.v.includes(t.assignee || 'none');
  else if (f.f === 'due') {
    hit = f.v.some(v => {
      if (v === 'nodate') return !t.due;
      if (!t.due) return false;
      const n = diffD(parse(t.due), TODAY);
      return v === 'overdue' ? isOver(t) : v === 'today' ? n === 0 : v === 'week' ? n >= 0 && n <= 7 : n > 7;
    });
  } else if (f.f === 'created' || f.f === 'updated') {
    const ts = f.f === 'created' ? t.created : t.updated;
    hit = f.v.some(v => Date.now() - ts <= +v * DAY);
  } else hit = f.v.includes(t[f.f]);
  return f.op === 'not' ? !hit : hit;
}
export function applyView(ts, v) {
  let out = ts.filter(t => v.filters.every(f => matchF(t, f)));
  if (v.q) {
    const q = v.q.toLowerCase();
    out = out.filter(t => String(t.title).toLowerCase().includes(q) || String(t.key).toLowerCase().includes(q));
  }
  return sortTasks(out, v.sort);
}
export function sortTasks(ts, s) {
  const d = s.dir || 1;
  const a = [...ts];
  // own keys only: a synced sort named after an Object.prototype method (valueOf) must fall back to manual order, not call it
  const keys = {
    manual: t => t.order,
    title: t => String(t.title).toLowerCase(),
    due: t => t.due || '9999',
    start: t => t.start || '9999',
    priority: t => -PR[t.priority || 'none'].w,
    status: t => STATUSES.findIndex(x => x.id === t.status),
    assignee: t => mem(t.assignee)?.name || 'zzz',
    created: t => -t.created,
    updated: t => -t.updated,
    estimate: t => t.estimate || 'zzz',
    project: t => proj(t.project)?.name,
  };
  const key = Object.prototype.hasOwnProperty.call(keys, s.f) ? keys[s.f] : t => t.order;
  return a.sort((x, y) => {
    const p = key(x),
      q = key(y);
    return (p > q ? 1 : p < q ? -1 : 0) * d;
  });
}
export function groupTasks(ts, g) {
  if (g === 'none') return [{ key: 'all', name: 'All tasks', html: '', tasks: ts }];
  let groups;
  if (g === 'status') groups = STATUSES.map(s => ({ key: s.id, name: s.name, html: stIcon(s.id), set: { status: s.id } }));
  else if (g === 'priority') groups = PRIOS.map(p => ({ key: p.id, name: p.name, html: prIcon(p.id), set: { priority: p.id } }));
  else if (g === 'assignee')
    groups = [
      ...D().members.map(m => ({ key: m.id, name: m.name, html: av(m.id, 'sm', false), set: { assignee: m.id } })),
      { key: 'none', name: 'Unassigned', html: av(null, 'sm', false), set: { assignee: null } },
    ];
  else if (g === 'project')
    groups = visibleProjects()
      .filter(canSee)
      .map(p => ({ key: p.id, name: p.name, html: `<span class="pdot" style="--c:${pColor(p)}"></span>`, set: { project: p.id } }));
  else if (g === 'due')
    groups = [
      { key: 'overdue', name: 'Overdue' },
      { key: 'today', name: 'Today' },
      { key: 'week', name: 'Next 7 days' },
      { key: 'later', name: 'Later' },
      { key: 'nodate', name: 'No due date' },
    ].map(x => ({ ...x, html: ic('calendar', 14) }));
  groups.forEach(G => {
    G.tasks = ts.filter(t => {
      if (g === 'assignee') return (t.assignee || 'none') === G.key;
      if (g === 'due') return matchF(t, { f: 'due', op: 'is', v: [G.key] });
      return t[g] === G.key;
    });
  });
  return g === 'status' || g === 'priority' ? groups : groups.filter(G => G.tasks.length);
}
export function filterChips(key) {
  const v = peekView(key);
  if (!v.filters.length) return '';
  const chips = v.filters
    .map((f, i) => {
      const F = FIELDS[f.f];
      const opts = F.opts();
      const names = f.v.map(id => opts.find(o => o.id === id)?.name || F.gone || id);
      const val = names.length ? (names.length > 2 ? `${names.length} selected` : names.join(', ')) : 'any';
      return `${i ? '<span>and</span>' : ''}<span class="chip"><button data-a="pop" data-pop="fvals" data-key="${esc(key)}" data-i="${i}" style="display:inline-flex;gap:5px;align-items:center">${ic(F.icon, 12)}<b>${F.name}</b> ${f.op === 'not' ? 'is not' : 'is'} <span>${esc(val)}</span></button><button class="ibtn" data-a="rmFilter" data-key="${esc(key)}" data-i="${i}" aria-label="Remove filter">${ic('x', 12)}</button></span>`;
    })
    .join('');
  return `<div class="chipsbar">${ic('list-filter', 13)}${chips}<button class="btn btn-sm btn-ghost" data-a="pop" data-pop="filter" data-key="${esc(key)}">${ic('plus', 12)}Add</button><span class="sp"></span><button class="btn btn-sm btn-ghost" data-a="clearFilters" data-key="${esc(key)}">Clear all</button></div>`;
}
export function viewToolbar(key, opt = {}) {
  const v = peekView(key);
  const sortName = {
    manual: 'Manual',
    title: 'Title',
    due: 'Due date',
    priority: 'Priority',
    status: 'Status',
    created: 'Created',
    updated: 'Updated',
    assignee: 'Assignee',
    start: 'Start date',
    estimate: 'Estimate',
    project: 'Project',
  }[v.sort.f];
  return `<div class="toolbar" role="toolbar">
    <div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="vq-${esc(key)}" data-in="viewQ" data-key="${esc(key)}" placeholder="Search tasks" value="${esc(v.q)}" aria-label="Search tasks"></div>
    <button class="btn btn-ghost ${v.filters.length ? 'on' : ''}" data-a="pop" data-pop="filter" data-key="${esc(key)}">${ic('list-filter', 14)}Filter${v.filters.length ? ` <span class="badge accent" style="height:16px;padding:0 5px">${v.filters.length}</span>` : ''}</button>
    <button class="btn btn-ghost" data-a="pop" data-pop="sort" data-key="${esc(key)}">${ic('arrow-up-down', 14)}<span class="hide-m">Sort:</span> ${sortName}</button>
    ${opt.group !== false ? `<button class="btn btn-ghost" data-a="pop" data-pop="group" data-key="${esc(key)}">${ic('rows-3', 14)}<span class="hide-m">Group:</span> ${{ status: 'Status', priority: 'Priority', assignee: 'Assignee', project: 'Project', due: 'Due date', none: 'None' }[v.group]}</button>` : ''}
    ${opt.cols ? `<button class="btn btn-ghost" data-a="pop" data-pop="cols" data-key="${esc(key)}">${ic('columns-3', 14)}Columns</button>` : ''}
    ${opt.extra || ''}
    <span class="sp"></span>
    ${opt.right || ''}
  </div>${filterChips(key)}`;
}
