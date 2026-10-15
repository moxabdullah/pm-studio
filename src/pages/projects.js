/* ---------- PROJECTS ---------- */
import { ago, esc, fmtDate, minsAgo } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { D, S, TM, canSee, isFinished, mem, progressOf, setOf, stageOf, stageSetsOf, tasksOf, visibleProjects } from '../core/store.js';
import { av, avStack, empty, pIcon, pStatuses, progBar, progClass } from '../ui/helpers.js';

export function projectCard(p) {
  const ts = tasksOf(p.id);
  const pr = progressOf(p.id);
  const open = ts.filter(t => t.status !== 'done').length;
  const locked = !canSee(p);
  return `<div class="pcard" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project" role="link" tabindex="0" aria-label="${esc(p.name)}">
    <div class="row">${pIcon(p)}<div class="grow" style="min-width:5em"><div class="row" style="gap:6px"><b class="trunc" style="font-weight:600;font-size:14px">${esc(p.name)}</b>${p.fav ? `<span style="color:var(--amber)">${ic('star', 12)}</span>` : ''}${p.private ? `<span class="faint" data-tip="Private project">${ic('lock', 12)}</span>` : ''}</div></div>${pStatuses(p)}</div>
    <div class="desc">${esc(p.desc)}</div>
    ${locked ? `<div class="row faint" style="font-size:12px">${ic('lock', 12)}Restricted — request access to see tasks</div>` : `<div class="row" style="gap:10px">${progBar(pr, progClass(p))}<span class="num" style="font-size:12px;font-weight:500">${pr}%</span></div>`}
    <div class="foot"><span class="row" style="gap:4px">${ic('circle-check', 12)}${locked ? '—' : `${ts.length - open}/${ts.length}`}</span><span class="row" style="gap:4px">${ic('calendar', 12)}${fmtDate(p.due)}</span><span class="row hide-m" style="gap:4px">${ic('clock', 12)}${ago(minsAgo(p.last))}</span><span class="sp"></span>${avStack(p.members, 3)}</div>
    <button class="ibtn ibtn-sm more" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="Project options" style="background:var(--surface);box-shadow:0 0 0 1px var(--border)">${ic('ellipsis', 14)}</button>
  </div>`;
}
/* The projects page's filter: active (not in a finished stage), finished, all, a health (`health:risk`), or one stage of one set
   (`stage:<setId>:<stageId>`; a stage id could hold a colon, so the rest after the set id is the stage id). */
function inFilter(p, st) {
  if (st === 'all') return true;
  if (st === 'active') return !isFinished(p);
  if (st === 'finished') return isFinished(p);
  if (st.startsWith('health:')) return p.health === st.slice(7);
  const [, setId, ...rest] = st.split(':');
  return setOf(p).id === setId && stageOf(p).id === rest.join(':');
}
/* The sets the workspace's projects are in: its own, or the built-in one when it has none. */
const setsShown = () => {
  const sets = stageSetsOf(D().ws.id);
  return sets.length ? sets : [setOf(null)];
};
/* The filter's options after Active, Finished and All: the two health flags, then the stages (a group per set when there is more than one). */
function filterOptions(st) {
  const sets = setsShown();
  const opt = (v, n) => `<option value="${esc(v)}" ${st === v ? 'selected' : ''}>${esc(n)}</option>`;
  const stages = set => set.stages.map(s => opt(`stage:${set.id}:${s.id}`, s.name)).join('');
  return (
    [
      ['active', 'Active'],
      ['finished', 'Finished'],
      ['all', 'All projects'],
      ['health:risk', 'At risk'],
      ['health:hold', 'On hold'],
    ]
      .map(([v, n]) => opt(v, n))
      .join('') + (sets.length > 1 ? sets.map(set => `<optgroup label="${esc(set.name)}">${stages(set)}</optgroup>`).join('') : stages(sets[0]))
  );
}
/* What the filter holds, or 'active' when it names a stage (or a health) that is not in this workspace any more (a set deleted live, another
   workspace's), which is also written back so that the select shows what is applied. */
function filterNow() {
  const u = S.ui;
  const st = u.projStatus || 'active';
  const [kind, setId, ...rest] = st.split(':');
  const ok =
    ['active', 'finished', 'all'].includes(st) ||
    (kind === 'health' && ['risk', 'hold'].includes(setId) && !rest.length) ||
    (kind === 'stage' &&
      !!setsShown()
        .find(s => s.id === setId)
        ?.stages.some(x => x.id === rest.join(':')));
  if (!ok) u.projStatus = 'active';
  return ok ? st : 'active';
}
export function pageProjects() {
  const u = S.ui;
  const q = (u.projQ || '').toLowerCase();
  const st = filterNow();
  const sort = u.projSort || 'recent';
  let ps = visibleProjects().filter(p => inFilter(p, st) && (!q || p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)));
  const sorter = { recent: p => p.last, name: p => p.name, due: p => p.due, progress: p => -progressOf(p.id) }[sort];
  ps.sort((a, b) => (sorter(a) > sorter(b) ? 1 : -1));
  const view = u.projView;
  let body;
  if (!visibleProjects().length)
    body = `<div class="panel">${empty('folder-kanban', 'No projects yet', 'Create your first project to start organizing your work.', `<button class="btn btn-primary btn-sm" data-a="newProject">${ic('plus', 14)}Create project</button>`)}</div>`;
  else if (!ps.length && st === 'active' && !q)
    body = `<div class="panel">${empty('folder-kanban', 'No active projects', `${visibleProjects().filter(isFinished).length} finished.`, `<button class="btn btn-secondary btn-sm" data-a="set" data-k="projStatus" data-v="all">Show all</button>`)}</div>`;
  else if (!ps.length)
    body = `<div class="panel">${empty('search-x', 'No results found', 'No projects match your search or filters. Try a different term.', `<button class="btn btn-secondary btn-sm" data-a="clearProjFilters">Clear filters</button>`)}</div>`;
  else if (view === 'grid') body = `<div class="pgrid">${ps.map(projectCard).join('')}</div>`;
  else if (view === 'list')
    body = `<div class="panel" style="overflow:hidden">${ps
      .map(p => {
        const pr = progressOf(p.id);
        return `<div class="mini" style="min-height:52px;gap:12px" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project">${pIcon(p)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px"><b style="font-weight:500">${esc(p.name)}</b>${p.private ? ic('lock', 12) : ''}</div><div class="trunc faint" style="font-size:12px">${esc(p.desc)}</div></div><span class="hide-m">${pStatuses(p)}</span><span class="row hide-m" style="width:140px">${progBar(pr)}<span class="num faint" style="font-size:11.5px">${pr}%</span></span><span class="num muted hide-m" style="width:70px;font-size:12px">${fmtDate(p.due)}</span>${avStack(p.members, 3)}<button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="Options">${ic('ellipsis', 14)}</button></div>`;
      })
      .join('')}</div>`;
  else
    body = `<div class="panel" style="overflow-x:auto"><table class="perm-t" style="min-width:860px"><thead><tr><th style="padding-left:14px">Project</th><th style="text-align:left">Stage</th><th style="text-align:left">Lead</th><th style="text-align:left">Team</th><th style="text-align:left;width:16%">Progress</th><th>Tasks</th><th style="text-align:left">Start</th><th style="text-align:left">Due</th><th style="text-align:left">Last activity</th><th></th></tr></thead><tbody>
    ${ps
      .map(p => {
        const ts = tasksOf(p.id);
        const pr = progressOf(p.id);
        return `<tr style="cursor:pointer" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project"><td style="padding-left:14px"><span class="row">${pIcon(p, '', 14)}<span style="font-weight:500">${esc(p.name)}</span>${p.private ? `<span class="faint" data-tip="Private project">${ic('lock', 12)}</span>` : ''}</span></td><td style="text-align:left">${pStatuses(p)}</td><td style="text-align:left"><span class="row">${av(p.lead, 'sm')}${esc(mem(p.lead)?.name)}</span></td><td style="text-align:left" class="muted">${esc(TM[p.team]?.name)}</td><td><span class="row">${progBar(pr)}<span class="num faint" style="font-size:11.5px">${pr}%</span></span></td><td class="num">${ts.length}</td><td style="text-align:left" class="num muted">${fmtDate(p.start)}</td><td style="text-align:left" class="num muted">${fmtDate(p.due)}</td><td style="text-align:left" class="muted">${ago(minsAgo(p.last))}</td><td><button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="Options">${ic('ellipsis', 14)}</button></td></tr>`;
      })
      .join('')}
    </tbody></table></div>`;
  return `<div class="page wide">
    <div class="ph"><div><h1>Projects</h1><p>${visibleProjects().filter(p => !isFinished(p)).length} active · ${visibleProjects().filter(isFinished).length} finished</p></div><div class="acts"><button class="btn btn-primary" data-a="newProject">${ic('plus', 14)}New project</button></div></div>
    <div class="row" style="margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="proj-q" data-in="projQ" placeholder="Search projects" value="${esc(u.projQ || '')}" aria-label="Search projects"></div>
      <select class="select" style="height:26px;width:auto;font-size:12px" data-in="projStatus" aria-label="Filter by stage">${filterOptions(st)}</select>
      <select class="select" style="height:26px;width:auto;font-size:12px" data-in="projSort" aria-label="Sort">${[
        ['recent', 'Recently active'],
        ['name', 'Name'],
        ['due', 'Due date'],
        ['progress', 'Progress'],
      ]
        .map(([k, n]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>Sort: ${n}</option>`)
        .join('')}</select>
      <span class="sp"></span>
      <div class="seg" role="tablist" aria-label="Layout">${[
        ['grid', 'Grid', 'layout-grid'],
        ['list', 'List', 'list'],
        ['table', 'Table', 'table-2'],
      ]
        .map(
          ([k, n, i]) =>
            `<button class="${view === k ? 'on' : ''}" data-a="set" data-k="projView" data-v="${k}" aria-label="${n}">${ic(i, 13)}<span class="hide-m">${n}</span></button>`,
        )
        .join('')}</div>
    </div>
    ${body}
  </div>`;
}
