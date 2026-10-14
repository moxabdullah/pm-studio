/* ---------- WORKSPACE TASKS ---------- */
import { esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { allTasks, canSee, visibleProjects } from '../core/store.js';
import { applyView, groupTasks, peekView, viewToolbar } from '../shell/view-engine.js';
import { listHtml } from '../components/task-list.js';
import { boardHtml } from '../views/board.js';
import { tableHtml } from '../views/table.js';

export function pageTasks() {
  const key = 'tasks';
  const v = peekView(key);
  const mode = v.mode || 'list'; // read, not written back: opening the page is no change to the view
  const ts = applyView(allTasks(), v);
  const right = `<div class="seg">${[
    ['list', 'List', 'list'],
    ['board', 'Board', 'square-kanban'],
    ['table', 'Table', 'table-2'],
  ]
    .map(
      ([k, n, i]) =>
        `<button class="${mode === k ? 'on' : ''}" data-a="setViewMode" data-key="${esc(key)}" data-v="${k}">${ic(i, 13)}<span class="hide-m">${n}</span></button>`,
    )
    .join('')}</div>`;
  let body;
  if (mode === 'board') body = boardHtml(ts, key, {});
  else if (mode === 'table') body = tableHtml(ts, key);
  else body = `<div class="list-wrap">${listHtml(groupTasks(ts, v.group), key, { cols: ['status', 'assignee', 'priority', 'due', 'project'] })}</div>`;
  return `<div class="page flush">
    <div class="ph"><div><h1>Tasks</h1><p>Every task across ${visibleProjects().filter(canSee).length} projects.</p></div><div class="acts"><button class="btn btn-primary" data-a="newTask">${ic('plus', 14)}New task</button></div></div>
    ${viewToolbar(key, { right, cols: mode === 'table', group: mode !== 'board' })}
    ${body}
  </div>`;
}
