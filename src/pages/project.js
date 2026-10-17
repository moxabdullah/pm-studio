/* =====================================================================
   PROJECT PAGE + VIEWS: overview, board, list, table, calendar, timeline, files, activity
   ===================================================================== */
import { esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { D, S, canSee, proj, stageOf, tasksOf } from '../core/store.js';
import { HEALTH } from '../core/constants.js';
import { avStack, empty, nameOf, pHealth, pIcon, pStage } from '../ui/helpers.js';
import { applyView, groupTasks, peekView, viewToolbar } from '../shell/view-engine.js';
import { listHtml } from '../components/task-list.js';
import { page404, stateDenied } from './errors.js';
import { projActivity, projOverview } from '../views/project-overview.js';
import { boardHtml } from '../views/board.js';
import { tableHtml } from '../views/table.js';
import { calendarHtml } from '../views/calendar.js';
import { timelineHtml, tlControls } from '../views/timeline.js';
import { filesHtml } from '../views/files.js';

export const PTABS = [
  ['overview', 'Overview', 'layout-dashboard'],
  ['board', 'Board', 'square-kanban'],
  ['list', 'List', 'list'],
  ['table', 'Table', 'table-2'],
  ['calendar', 'Calendar', 'calendar'],
  ['timeline', 'Timeline', 'chart-gantt'],
  ['files', 'Files', 'paperclip'],
  ['activity', 'Activity', 'activity'],
];

export function pageProject() {
  const p = proj(S.ui.params.id);
  if (!p) return page404();
  if (!canSee(p)) return stateDenied(p);
  const tab = S.ui.params.tab || 'board';
  const views = D().savedViews.filter(v => v.project === p.id);
  let body = '';
  const key = 'p:' + p.id;
  const ts = tasksOf(p.id);
  if (tab.startsWith('v:')) {
    const sv = views.find(v => 'v:' + v.id === tab);
    if (!sv) body = page404();
    else {
      const k = 'sv:' + sv.id;
      body = taskViewBody(sv.type, applyView(ts, peekView(k)), k, p);
    }
  } else if (tab === 'overview') body = projOverview(p);
  else if (tab === 'files') body = filesHtml(p.id);
  else if (tab === 'activity') body = projActivity(p);
  else body = taskViewBody(tab, applyView(ts, peekView(key)), key, p);
  // The button names all its members, those behind the "+N" chip as well
  const names = p.members.map(nameOf);

  return `<div class="page flush">
    <div class="proj-h">
      <div class="t">
        ${pIcon(p, 'lg', 18)}
        <h1>${esc(p.name)}</h1>${p.private ? `<span class="faint row" data-tip="Private project" role="img" aria-label="Private project">${ic('lock', 14)}</span>` : ''}
        <button class="ibtn ibtn-sm" data-a="toggleFavProj" data-id="${esc(p.id)}" data-tip="${p.fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${!!p.fav}" aria-label="Favorite" style="${p.fav ? 'color:var(--amber)' : ''}">${ic('star', 15)}</button>
        <button class="pillbtn" data-a="pop" data-pop="pstage" data-id="${esc(p.id)}" aria-label="Project stage: ${esc(stageOf(p).name)}" style="height:24px">${pStage(p, ic('chevron-down', 12))}</button>${pHealth(p, ic('chevron-down', 12)) ? `<button class="pillbtn" data-a="pop" data-pop="phealth" data-id="${esc(p.id)}" aria-label="Project health: ${HEALTH[p.health].name}" style="height:24px">${pHealth(p, ic('chevron-down', 12))}</button>` : ''}
        <span class="sp"></span>
        <div class="row" style="gap:4px">
          <button class="row" data-a="share" data-id="${esc(p.id)}" aria-label="Members${names.length ? `: ${esc(names.join(', '))}` : ''}" style="gap:0">${avStack(p.members, 5, 'md', true)}</button>
          <button class="ibtn ibtn-sm" data-a="share" data-id="${esc(p.id)}" data-tip="Add member" aria-label="Add member">${ic('user-plus', 15)}</button>
          <button class="btn btn-secondary btn-sm hide-m" data-a="share" data-id="${esc(p.id)}">${ic('share-2', 13)}Share</button>
          <button class="ibtn ibtn-sm" data-a="editProject" data-id="${esc(p.id)}" data-tip="Project settings" aria-label="Project settings">${ic('settings', 15)}</button>
          <button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="More">${ic('ellipsis', 15)}</button>
        </div>
      </div>
      <nav class="tabs" aria-label="Project views">
        ${PTABS.map(([k, n, i]) => `<button ${tab === k ? 'aria-current="page"' : ''} class="tab ${tab === k ? 'on' : ''}" data-a="go" data-r="project" data-id="${esc(p.id)}" data-tab="${k}">${ic(i, 14)}${n}</button>`).join('')}
        ${views.map(v => `<button ${tab === 'v:' + v.id ? 'aria-current="page"' : ''} class="tab ${tab === 'v:' + v.id ? 'on' : ''}" data-a="go" data-r="project" data-id="${esc(p.id)}" data-tab="v:${esc(v.id)}" data-ctx="savedview" data-vid="${esc(v.id)}">${ic('list-filter', 14)}${esc(v.name)}</button>`).join('')}
        <button class="tab" data-a="saveView" data-id="${esc(p.id)}" data-tip="Save current filters as a view" aria-label="Save view">${ic('plus', 14)}</button>
      </nav>
    </div>
    <div class="pbody${S.ui.fx.tab ? ' fx-tab' : ''}">${body}</div>
  </div>`;
}
export function taskViewBody(type, ts, key, p) {
  const v = peekView(key);
  const addBtn = `<button class="btn btn-primary btn-sm" data-a="newTask" data-project="${esc(p.id)}">${ic('plus', 13)}New task</button>`;
  const noTasks = !tasksOf(p.id).length;
  const emptyAll = empty(
    'list-checks',
    'No tasks here',
    'Add a task to get things moving.',
    `<button class="btn btn-primary btn-sm" data-a="newTask" data-project="${esc(p.id)}">${ic('plus', 14)}Add task</button>`,
  );
  const emptyFilter = empty(
    'search-x',
    'No results found',
    'No tasks match these filters.',
    `<button class="btn btn-secondary btn-sm" data-a="clearFilters" data-key="${esc(key)}">Clear filters</button>`,
  );
  if (type === 'board') return viewToolbar(key, { group: false, right: addBtn }) + (noTasks ? emptyAll : boardHtml(ts, key, { project: p.id }));
  if (type === 'list')
    return (
      viewToolbar(key, { right: addBtn }) +
      `<div class="list-wrap">${noTasks ? emptyAll : !ts.length ? emptyFilter : listHtml(groupTasks(ts, v.group), key, { project: p.id })}</div>`
    );
  if (type === 'table') return viewToolbar(key, { cols: true, right: addBtn }) + (noTasks ? emptyAll : tableHtml(ts, key, p));
  if (type === 'calendar') return viewToolbar(key, { group: false, right: addBtn }) + calendarHtml(ts, { key, project: p.id, events: true });
  if (type === 'timeline') return viewToolbar(key, { group: false, right: addBtn, extra: tlControls(key) }) + timelineHtml(ts, key, p);
  return page404();
}
