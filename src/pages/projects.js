/* ---------- PROJECTS ---------- */
import { ago, esc, fmtDate, minsAgo } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { STAGE_COLORS } from '../core/constants.js';
import { D, S, TM, canSee, fieldText, fieldsOf, isFinished, mem, progressOf, setOf, stageOf, stageSetsOf, tasksOf, visibleProjects } from '../core/store.js';
import { av, avStack, empty, pHealth, pIcon, pStatuses, progBar, progClass } from '../ui/helpers.js';

export function projectCard(p) {
  const ts = tasksOf(p.id);
  const pr = progressOf(p.id);
  const open = ts.filter(t => t.status !== 'done').length;
  const locked = !canSee(p);
  return `<div class="pcard" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project" role="link" tabindex="0" aria-label="${esc(p.name)}">
    <div class="row">${pIcon(p)}<div class="grow" style="min-width:5em"><div class="row" style="gap:6px"><b class="trunc" style="font-weight:600;font-size:14px">${esc(p.name)}</b>${p.fav ? `<span style="color:var(--amber)">${ic('star', 12)}</span>` : ''}${p.private ? `<span class="faint" data-tip="Private project">${ic('lock', 12)}</span>` : ''}</div></div>${pStatuses(p)}</div>
    <div class="desc">${esc(p.desc)}</div>
    ${locked ? `<div class="row faint" style="font-size:12px">${ic('lock', 12)}Restricted — request access to see tasks</div>` : `<div class="row" style="gap:10px">${progBar(pr, progClass(p))}<span class="num" style="font-size:12px;font-weight:500">${pr}%</span></div>`}
    <div class="foot"><span class="row" style="gap:4px">${ic('circle-check', 12)}${locked ? '—' : `${ts.length - open}/${ts.length}`}</span>${p.due ? `<span class="row" style="gap:4px">${ic('calendar', 12)}${fmtDate(p.due)}</span>` : ''}<span class="row hide-m" style="gap:4px">${ic('clock', 12)}${ago(minsAgo(p.last))}</span><span class="sp"></span>${avStack(p.members, 3)}</div>
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
/* The stage set the Board shows: the set of a stage filter, else the one picked in the selector (S.ui.projBoardSet) while the workspace
   still has it, else the first. Written back, so that the selector shows what is applied. `st` is what filterNow() returned. */
function shownSet(st) {
  const sets = setsShown();
  const [kind, setId] = st.split(':');
  const set = (kind === 'stage' && sets.find(s => s.id === setId)) || sets.find(s => s.id === S.ui.projBoardSet) || sets[0];
  S.ui.projBoardSet = set.id;
  return set;
}
/* A column of the Board is collapsed when it was (S.ui.collapsedCols, true or false: unlike the task board's, this key is kept once
   it has been set), else when its stage finishes projects, unless the filter is there to show them. */
const pipeKey = (set, s) => `pipe:${set.id}:${s.id}`;
const pipeCollapsed = (set, s, st) => S.ui.collapsedCols[pipeKey(set, s)] ?? (s.finished && st !== 'finished' && st !== `stage:${set.id}:${s.id}`);
/* A project on the Board: a link like projectCard (a div, with buttons in it), to drag to another column. Its stage is its column, so
   there is no stage pill; the stage button is the way to move it without a mouse (it opens the picker the project's page has). */
function pipeCard(p) {
  const pr = progressOf(p.id);
  const stage = stageOf(p);
  const health = pHealth(p);
  const move = `Move ${p.name} to another stage (now: ${stage.name})`;
  return `<div class="pbcard" draggable="true" data-drag-pcard="${esc(p.id)}" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project" role="link" tabindex="0" aria-label="${esc(p.name)}">
    <div class="row" style="gap:8px">${pIcon(p, '', 14)}<b class="trunc grow" style="font-weight:600" title="${esc(p.name)}">${esc(p.name)}</b>${p.private ? `<span class="faint" data-tip="Private project">${ic('lock', 12)}</span>` : ''}</div>
    ${health ? `<div class="pstatuses">${health}</div>` : ''}
    ${canSee(p) ? `<div class="row" style="gap:10px">${progBar(pr, progClass(p))}<span class="num" style="font-size:12px;font-weight:500">${pr}%</span></div>` : `<div class="row faint" style="font-size:12px">${ic('lock', 12)}Restricted — request access to see tasks</div>`}
    <div class="pfoot">${p.due ? `<span class="row" style="gap:4px">${ic('calendar', 12)}${fmtDate(p.due)}</span>` : ''}<span class="sp"></span>${av(p.lead, 'sm')}<button class="btn btn-ghost btn-sm pmove" data-a="pop" data-pop="pstage" data-id="${esc(p.id)}" aria-label="${esc(move)}">Move${ic('chevron-down', 12)}</button></div>
  </div>`;
}
/* The Board: a column per stage of the set shown, in the set's order, and the projects of that set (`ps`) in them, in the page's sort.
   A column takes a drop (drag-drop.js) and moves the project to its stage; the "Unknown stage" one, for projects whose stage is not in
   the set, takes none. A collapsed column is the narrow strip, which takes a drop and a click (to expand it) as well. */
function pipeBoard(ps, set, st) {
  const mine = ps.filter(p => setOf(p).id === set.id);
  const other = ps.length - mine.length;
  const unknown = mine.filter(p => !set.stages.some(s => s.id === stageOf(p).id));
  const dot = c => `<span class="pdot" style="--c:${c};border-radius:50%;width:10px;height:10px" aria-hidden="true"></span>`;
  const cols = set.stages.map(s => {
    const cards = mine.filter(p => stageOf(p).id === s.id);
    const drop = `data-drop-stage="${esc(s.id)}" data-set="${esc(set.id)}"`;
    const ck = pipeKey(set, s);
    if (pipeCollapsed(set, s, st)) {
      const expand = `Expand ${s.name}, ${cards.length} ${cards.length === 1 ? 'project' : 'projects'}`;
      return `<button class="bcol collapsed" ${drop} data-a="togglePipeCol" data-key="${esc(ck)}" data-to="expand" aria-label="${esc(expand)}" title="${esc(expand)}">${dot(STAGE_COLORS[s.color])}<span class="vname"><span class="vn">${esc(s.name)}</span><span class="faint">${cards.length}</span></span></button>`;
    }
    return `<section class="bcol" ${drop} aria-label="${esc(s.name)}">
      <div class="bcol-h">${dot(STAGE_COLORS[s.color])}<span class="trunc" title="${esc(s.name)}">${esc(s.name)}</span><span class="cnt">${cards.length}</span><span class="acts"><button class="ibtn ibtn-xs" data-a="togglePipeCol" data-key="${esc(ck)}" data-to="collapse" data-tip="Collapse" aria-label="Collapse ${esc(s.name)}">${ic('chevrons-left', 14)}</button></span></div>
      <div class="bcol-b" data-keep="pcol:${esc(set.id)}:${esc(s.id)}">${cards.map(pipeCard).join('')}</div>
    </section>`;
  });
  if (unknown.length)
    cols.unshift(`<section class="bcol" aria-label="Unknown stage">
      <div class="bcol-h">${dot(STAGE_COLORS.gray)}<span class="trunc">Unknown stage</span><span class="cnt">${unknown.length}</span></div>
      <div class="bcol-b" data-keep="pcol:${esc(set.id)}:unknown">${unknown.map(pipeCard).join('')}</div>
    </section>`);
  return `${other ? `<p class="faint" style="font-size:12px;margin:0 0 8px">${other} ${other === 1 ? 'project in another stage set' : 'projects in other stage sets'}</p>` : ''}<div class="board pboard" data-keep="pboard:${esc(set.id)}">${cols.join('')}</div>`;
}
/* The Projects table scrolls sideways when it has more columns than fit. After each render (render.js), and when the panel or the table
   changes size or is scrolled, this marks the wrapper (.sfade) with the edges that have more beyond them (.sf-l, .sf-r: a fade, see
   projects-files.css) and makes the panel a tab stop, so the keyboard can scroll it, only while it scrolls: a wide screen gets no extra
   stop. The panel is rendered with the tab stop and loses it here, since render() puts focus back by id before this runs; one that has
   focus keeps it (focus would drop to the page) and is looked at again when it loses it. */
const tableSize = new ResizeObserver(() => projTableFade());
export function projTableAfter() {
  const el = document.getElementById('proj-table');
  tableSize.disconnect(); // (observing starts with one report, so this is not repeated from the report)
  if (!el) return;
  tableSize.observe(el);
  tableSize.observe(el.firstElementChild);
  el.onscroll = projTableFade;
  el.onblur = () => setTimeout(projTableFade, 0); // (a window that loses focus keeps the panel focused: it stays a tab stop)
  projTableFade();
}
function projTableFade() {
  const el = document.getElementById('proj-table');
  if (!el) return;
  const over = el.scrollWidth > el.clientWidth + 1;
  el.parentElement.classList.toggle('sf-l', over && el.scrollLeft > 1);
  el.parentElement.classList.toggle('sf-r', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  if (!over && document.activeElement === el) return;
  for (const [k, v] of [
    ['tabindex', '0'],
    ['role', 'region'],
    ['aria-label', 'Projects table'],
  ]) {
    if (over) el.setAttribute(k, v);
    else el.removeAttribute(k);
  }
}
export function pageProjects() {
  const u = S.ui;
  const q = (u.projQ || '').toLowerCase();
  const st = filterNow();
  const sort = u.projSort || 'recent';
  let ps = visibleProjects().filter(p => inFilter(p, st) && (!q || p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)));
  // (a project with no target date sorts after every dated one)
  const sorter = { recent: p => p.last, name: p => p.name, due: p => p.due || '\uffff', progress: p => -progressOf(p.id) }[sort];
  ps.sort((a, b) => (sorter(a) > sorter(b) ? 1 : -1));
  const view = u.projView;
  const set = view === 'board' ? shownSet(st) : null;
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
        return `<div class="mini" style="min-height:52px;gap:12px" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project">${pIcon(p)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px"><b style="font-weight:500">${esc(p.name)}</b>${p.private ? ic('lock', 12) : ''}</div><div class="trunc faint" style="font-size:12px">${esc(p.desc)}</div></div><span class="hide-m">${pStatuses(p)}</span><span class="row hide-m" style="width:140px">${progBar(pr, progClass(p))}<span class="num faint" style="font-size:11.5px">${pr}%</span></span><span class="num muted hide-m" style="width:70px;font-size:12px">${p.due ? fmtDate(p.due) : '<span class="faint"><span class="sr">No target date</span><span aria-hidden="true">—</span></span>'}</span>${avStack(p.members, 3)}<button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="Options">${ic('ellipsis', 14)}</button></div>`;
      })
      .join('')}</div>`;
  else if (view === 'board') body = pipeBoard(ps, set, st);
  else {
    // a column for each project field marked for the table, straight after the project's name (so they are in view without scrolling); the
    // table is wider by a fixed amount for each, and the panel scrolls. While it does (projTableAfter), a fade on the edge with more columns
    // beyond it says so, and the panel is a focusable region, so the keyboard can scroll it.
    const cols = fieldsOf(D().ws.id).filter(fl => fl.inTable);
    body = `<div class="sfade"><div class="panel" id="proj-table" data-keep="proj-table" tabindex="0" role="region" aria-label="Projects table" style="overflow-x:auto"><table class="perm-t" style="min-width:${860 + 120 * cols.length}px"><thead><tr><th style="padding-left:14px">Project</th>${cols.map(fl => `<th style="text-align:left" title="${esc(fl.name)}"><span class="trunc" style="display:block;max-width:180px">${esc(fl.name)}</span></th>`).join('')}<th style="text-align:left">Stage</th><th style="text-align:left">Lead</th><th style="text-align:left">Team</th><th style="text-align:left;width:16%">Progress</th><th>Tasks</th><th style="text-align:left">Start</th><th style="text-align:left">Due</th><th style="text-align:left">Last activity</th><th></th></tr></thead><tbody>
    ${ps
      .map(p => {
        const ts = tasksOf(p.id);
        const pr = progressOf(p.id);
        const extra = cols
          .map(fl => {
            const v = fieldText(p, fl);
            return `<td style="text-align:left" class="muted"${v ? ` title="${esc(v)}"` : ''}><span class="trunc" style="display:block;max-width:180px">${esc(v)}</span></td>`;
          })
          .join('');
        return `<tr style="cursor:pointer" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project"><td style="padding-left:14px"><span class="row">${pIcon(p, '', 14)}<span style="font-weight:500">${esc(p.name)}</span>${p.private ? `<span class="faint" data-tip="Private project">${ic('lock', 12)}</span>` : ''}</span></td>${extra}<td style="text-align:left">${pStatuses(p)}</td><td style="text-align:left"><span class="row">${av(p.lead, 'sm', true, true)}${esc(mem(p.lead)?.name)}</span></td><td style="text-align:left" class="muted">${esc(TM[p.team]?.name)}</td><td><span class="row">${progBar(pr, progClass(p))}<span class="num faint" style="font-size:11.5px">${pr}%</span></span></td><td class="num">${ts.length}</td><td style="text-align:left" class="num muted">${fmtDate(p.start)}</td><td style="text-align:left" class="num muted">${p.due ? fmtDate(p.due) : '<span class="faint"><span class="sr">No target date</span><span aria-hidden="true">—</span></span>'}</td><td style="text-align:left" class="muted">${ago(minsAgo(p.last))}</td><td><button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="Options">${ic('ellipsis', 14)}</button></td></tr>`;
      })
      .join('')}
    </tbody></table></div></div>`;
  }
  return `<div class="page wide">
    <div class="ph"><div><h1>Projects</h1><p>${visibleProjects().filter(p => !isFinished(p)).length} active · ${visibleProjects().filter(isFinished).length} finished</p></div><div class="acts"><button class="btn btn-primary" data-a="newProject">${ic('plus', 14)}New project</button></div></div>
    <div class="row" style="margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="proj-q" data-in="projQ" placeholder="Search projects" value="${esc(u.projQ || '')}" aria-label="Search projects"></div>
      <select class="select" style="height:26px;width:auto;font-size:12px" data-in="projStatus" aria-label="Filter projects">${filterOptions(st)}</select>
      <select class="select" style="height:26px;width:auto;font-size:12px" data-in="projSort" aria-label="Sort">${[
        ['recent', 'Recently active'],
        ['name', 'Name'],
        ['due', 'Due date'],
        ['progress', 'Progress'],
      ]
        .map(([k, n]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>Sort: ${n}</option>`)
        .join('')}</select>
      ${
        view === 'board' && setsShown().length > 1
          ? `<select class="select" style="height:26px;width:auto;font-size:12px" data-in="projBoardSet" aria-label="Stage set">${setsShown()
              .map(x => `<option value="${esc(x.id)}" ${x.id === set.id ? 'selected' : ''}>${esc(x.name)}</option>`)
              .join('')}</select>`
          : ''
      }
      <span class="sp"></span>
      <div class="seg" role="tablist" aria-label="Layout">${[
        ['grid', 'Grid', 'layout-grid'],
        ['list', 'List', 'list'],
        ['table', 'Table', 'table-2'],
        ['board', 'Board', 'square-kanban'],
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
