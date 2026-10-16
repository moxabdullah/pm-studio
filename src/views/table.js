/* ---------- TABLE ---------- */
import { esc, fmtDate, iso } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { S, isOver, mem, pColor, proj, shownLabels, task } from '../core/store.js';
import { av, dueHtml, empty, lblPills, prPill, stIcon, stPill } from '../ui/helpers.js';
import { groupTasks, hiddenCols, peekView } from '../shell/view-engine.js';

export const TCOLS = [
  ['title', 'Task', 314],
  ['status', 'Status', 132],
  ['priority', 'Priority', 112],
  ['assignee', 'Assignee', 156],
  ['due', 'Due date', 112],
  ['start', 'Start date', 112],
  ['labels', 'Labels', 180],
  ['deps', 'Dependencies', 150],
  ['estimate', 'Estimate', 92],
  ['created', 'Created', 112],
  ['project', 'Project', 156],
];
export function tcell(t, c) {
  const ed = S.ui.editCell && S.ui.editCell.id === t.id && S.ui.editCell.f === c;
  switch (c) {
    case 'title':
      return ed
        ? `<td class="sticky editing"><input id="edit-cell" data-blur="commitCell" data-key-enter="commitCell" data-id="${esc(t.id)}" data-f="title" value="${esc(t.title)}" aria-label="Title"></td>`
        : `<td class="sticky cellbtn" data-a="openTask" data-id="${esc(t.id)}" data-dbl="editCell" data-f="title" title="Double-click to rename"><span class="row" style="gap:8px">${stIcon(t.status, 13)}<span class="trunc" style="font-weight:450">${esc(t.title)}</span><span class="mono faint" style="font-size:11px;margin-left:auto">${esc(t.key)}</span></span></td>`;
    case 'status':
      return `<td class="cellbtn" data-a="pop" data-pop="status" data-id="${esc(t.id)}"><span class="row" style="gap:6px">${stPill(t.status)}</span></td>`;
    case 'priority':
      return `<td class="cellbtn" data-a="pop" data-pop="priority" data-id="${esc(t.id)}"><span class="row" style="gap:6px">${prPill(t.priority)}</span></td>`;
    case 'assignee':
      return `<td class="cellbtn" data-a="pop" data-pop="assignee" data-id="${esc(t.id)}"><span class="row" style="gap:6px">${av(t.assignee, 'sm', false)}<span class="trunc ${t.assignee ? '' : 'faint'}">${esc(mem(t.assignee)?.name || 'Unassigned')}</span></span></td>`;
    case 'due':
      return `<td class="cellbtn num ${isOver(t) ? '' : ''}" data-a="pop" data-pop="date" data-field="due" data-id="${esc(t.id)}" style="${isOver(t) ? 'color:var(--red)' : ''}">${t.due ? fmtDate(t.due) : '<span class="faint">—</span>'}</td>`;
    case 'start':
      return `<td class="cellbtn num" data-a="pop" data-pop="date" data-field="start" data-id="${esc(t.id)}">${t.start ? fmtDate(t.start) : '<span class="faint">—</span>'}</td>`;
    case 'labels': {
      const ls = shownLabels(t);
      return `<td class="cellbtn" data-a="pop" data-pop="labels" data-id="${esc(t.id)}"><span class="row lblcell" style="gap:4px">${ls.length ? lblPills(ls) : '<span class="faint">—</span>'}</span></td>`;
    }
    case 'deps':
      return `<td class="cellbtn" data-a="pop" data-pop="deps" data-id="${esc(t.id)}">${t.deps.map(d => (task(d) ? `<span class="depchip" title="${esc(task(d).title)}">${esc(task(d).key)}</span>` : '')).join('') || '<span class="faint">—</span>'}</td>`;
    case 'estimate':
      return ed
        ? `<td class="editing"><input id="edit-cell" data-blur="commitCell" data-key-enter="commitCell" data-id="${esc(t.id)}" data-f="estimate" value="${esc(t.estimate || '')}" placeholder="e.g. 2d" aria-label="Estimate"></td>`
        : `<td class="cellbtn num" data-dbl="editCell" data-id="${esc(t.id)}" data-f="estimate" data-a="editCell" title="Click to edit">${t.estimate ? esc(t.estimate) : '<span class="faint">—</span>'}</td>`;
    case 'created':
      return `<td class="num muted">${fmtDate(iso(new Date(t.created)))}</td>`;
    case 'project':
      return `<td class="cellbtn" data-a="pop" data-pop="project" data-id="${esc(t.id)}"><span class="row" style="gap:6px"><span class="pdot" style="--c:${pColor(proj(t.project))}"></span><span class="trunc">${esc(proj(t.project)?.name)}</span></span></td>`;
  }
}
export function tableHtml(ts, key, p) {
  const v = peekView(key);
  const hidden = hiddenCols(key, v); // inside a project the Project column starts hidden (a render reads that, it does not write it down)
  const cols = TCOLS.filter(c => c[0] === 'title' || !hidden.includes(c[0]));
  const w = c => +v.colW[c[0]] || c[2]; // pixels: a stored width must never become CSS text
  const groups = groupTasks(ts, v.group);
  const totalW = cols.reduce((a, c) => a + w(c), 0);
  if (!ts.length)
    return empty(
      'search-x',
      'No results found',
      'No tasks match these filters.',
      `<button class="btn btn-secondary btn-sm" data-a="clearFilters" data-key="${esc(key)}">Clear filters</button>`,
    );
  return `<div class="tbl-wrap hide-m" data-keep="tbl:${esc(key)}"><table class="tbl" style="width:${totalW}px" aria-label="Tasks table">
    <colgroup>${cols.map(c => `<col data-col="${c[0]}" style="width:${w(c)}px">`).join('')}</colgroup>
    <thead><tr>${cols.map(c => `<th class="${c[0] === 'title' ? 'sticky' : ''}" style="position:sticky" scope="col"><div class="thi" data-a="sortBy" data-key="${esc(key)}" data-f="${['labels', 'deps'].includes(c[0]) ? 'manual' : c[0]}">${c[1]}${v.sort.f === c[0] ? ic(v.sort.dir > 0 ? 'arrow-up' : 'arrow-down', 11) : ''}</div><span class="rsz" data-rsz="${c[0]}" data-key="${esc(key)}" aria-hidden="true"></span></th>`).join('')}</tr></thead>
    <tbody>${groups
      .map(
        g => `${v.group !== 'none' ? `<tr class="grow-row"><td class="sticky" colspan="${cols.length}"><span class="row" style="gap:6px">${g.html || ''}${esc(g.name)}<span class="faint" style="font-weight:500">${g.tasks.length}</span></span></td></tr>` : ''}
      ${g.tasks.map(t => `<tr data-ctx="task" data-id="${esc(t.id)}">${cols.map(c => tcell(t, c[0])).join('')}</tr>`).join('')}`,
      )
      .join('')}
      <tr><td class="sticky cellbtn" data-a="newTask" ${p ? `data-project="${esc(p.id)}"` : ''} colspan="${cols.length}" style="color:var(--text-3)"><span class="row" style="gap:6px">${ic('plus', 14)}New task</span></td></tr>
    </tbody></table></div>
    <div class="only-m" style="padding:8px 16px 90px">${ts.map(t => `<div class="panel" style="padding:12px;margin-bottom:8px" data-a="openTask" data-id="${esc(t.id)}"><div class="row" style="margin-bottom:8px">${stIcon(t.status)}<b style="font-weight:500" class="grow">${esc(t.title)}</b><span class="mono faint" style="font-size:11px">${esc(t.key)}</span></div><div class="row" style="flex-wrap:wrap;gap:10px;font-size:12px" class="muted">${prPill(t.priority)}${av(t.assignee, 'sm', false)}<span class="muted">${esc(mem(t.assignee)?.name || 'Unassigned')}</span>${dueHtml(t)}${t.estimate ? `<span class="faint">${ic('timer', 12)} ${esc(t.estimate)}</span>` : ''}</div></div>`).join('')}</div>`;
}
