/* ---------- OVERVIEW ---------- */
import { TODAY, dayBucket, diffD, esc, fmtDate, parse } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { STAGE_COLORS, STATUSES } from '../core/constants.js';
import { D, TM, fieldText, fieldsOf, isOver, mem, pColor, progressOf, setOf, stageOf, task, tasksOf } from '../core/store.js';
import { av, avStack, empty, pHealth, pStage, stIcon } from '../ui/helpers.js';
import { sortTasks } from '../shell/view-engine.js';
import { actHtml, miniRow } from '../components/task-list.js';

/* The icon of a project field's row in Details, by the field's type. */
const FIELD_ICON = { text: 'type', number: 'hash', date: 'calendar', select: 'list' };
/* The project's own workspace's fields (not the current one's: the project may be open after the workspace was switched), in the
   list's order, after Due. A value is read-only here (the Edit button of About is how it changes) and is cut to the width of the panel. */
export function projOverview(p) {
  const ts = tasksOf(p.id);
  const pr = progressOf(p.id);
  const cnt = STATUSES.map(s => ({ s, n: ts.filter(t => t.status === s.id).length }));
  const over = ts.filter(isOver);
  const soon = sortTasks(
    ts.filter(t => t.status !== 'done' && t.due),
    { f: 'due', dir: 1 },
  ).slice(0, 6);
  const acts = D()
    .activity.filter(a => a.project === p.id)
    .slice(0, 6);
  const daysLeft = diffD(parse(p.due), TODAY);
  return `<div class="page" style="max-width:1160px;padding-top:22px">
    <div class="grid2">
      <div class="stack">
        <section class="panel"><div class="panel-h"><h2>About</h2><div class="acts"><button class="btn btn-sm btn-ghost" data-a="editProject" data-id="${esc(p.id)}">${ic('pencil', 13)}Edit</button></div></div><div class="panel-b" style="font-size:14px;line-height:1.6;color:var(--text)">${esc(p.desc)}</div></section>
        <section class="panel"><div class="panel-h"><h2>Progress</h2><div class="acts"><span class="faint" style="font-size:12px">${ts.filter(t => t.status === 'done').length} of ${ts.length} tasks done</span></div></div>
          <div class="panel-b">
            <div class="row" style="align-items:baseline;gap:10px;margin-bottom:10px"><span style="font-size:30px;font-weight:600;letter-spacing:-.03em" class="num">${pr}%</span><span class="muted">${daysLeft >= 0 ? `${daysLeft} days until ${fmtDate(p.due)}` : `Ended ${fmtDate(p.due)}`}</span>${over.length ? `<span class="badge red">${ic('clock-alert', 11)}${over.length} overdue</span>` : ''}</div>
            <div class="stackbar" style="height:8px;margin-bottom:12px">${cnt.map(c => `<i style="width:${(c.n / Math.max(ts.length, 1)) * 100}%;background:var(--st-${c.s.id})" title="${c.s.name}: ${c.n}"></i>`).join('')}</div>
            <div class="row" style="flex-wrap:wrap;gap:14px;font-size:12.5px">${cnt.map(c => `<button class="row" style="gap:5px" data-a="goFilteredList" data-id="${esc(p.id)}" data-st="${c.s.id}">${stIcon(c.s.id, 12)}<span class="muted">${c.s.name}</span><b class="num" style="font-weight:600">${c.n}</b></button>`).join('')}</div>
          </div></section>
        <section class="panel"><div class="panel-h"><h2>Coming up</h2><div class="acts"><button class="btn btn-sm btn-ghost" data-a="go" data-r="project" data-id="${esc(p.id)}" data-tab="list">View list</button></div></div>${soon.map(t => miniRow(t, { noProj: true })).join('') || empty('circle-check', 'Nothing scheduled', 'Tasks with due dates will show up here.', '', 'sm')}</section>
      </div>
      <div class="stack">
        <section class="panel"><div class="panel-h"><h2>Details</h2></div><div class="panel-b"><dl class="kv">
          <dt>${ic('circle-dot', 14)}Stage</dt><dd><button class="pillbtn" data-a="pop" data-pop="pstage" data-id="${esc(p.id)}">${pStage(p, ic('chevron-down', 12))}</button></dd>
          <dt>${ic('activity', 14)}Health</dt><dd><button class="pillbtn" data-a="pop" data-pop="phealth" data-id="${esc(p.id)}">${pHealth(p, ic('chevron-down', 12)) || `<span class="faint">On track</span>${ic('chevron-down', 12)}`}</button></dd>
          <dt>${ic('user', 14)}Lead</dt><dd><span class="pillbtn">${av(p.lead, 'sm', false)}${esc(mem(p.lead)?.name)}</span></dd>
          <dt>${ic('users', 14)}Team</dt><dd><button class="pillbtn" data-a="go" data-r="team" data-id="${esc(p.team)}">${ic(TM[p.team].icon, 13)}${esc(TM[p.team].name)}</button></dd>
          <dt>${ic('calendar', 14)}Start</dt><dd><span class="pillbtn num">${fmtDate(p.start, true)}</span></dd>
          <dt>${ic('flag', 14)}Due</dt><dd><span class="pillbtn num">${fmtDate(p.due, true)}</span></dd>
          ${fieldsOf(p.workspace)
            .map(fl => {
              const v = fieldText(p, fl);
              // (the name and the value wrap, a long word anywhere, so neither is cut and the value needs no tooltip: see .kv-f in projects-files.css)
              return `<dt class="kv-f">${ic(FIELD_ICON[fl.type] || 'type', 14)}<span>${esc(fl.name)}</span></dt><dd class="kv-f">${v ? `<span class="pillbtn">${esc(v)}</span>` : '<span class="pillbtn empty"><span class="sr">No value</span><span aria-hidden="true">—</span></span>'}</dd>`;
            })
            .join('')}
          <dt>${ic('user-plus', 14)}Members</dt><dd><button class="pillbtn" data-a="share" data-id="${esc(p.id)}">${avStack(p.members, 6)}<span class="faint">${p.members.length}</span></button></dd>
        </dl></div></section>
        <section class="panel"><div class="panel-h"><h2>Stage history</h2></div><div class="panel-b">${stageHistory(p)}</div></section>
        <section class="panel"><div class="panel-h"><h2>Milestones</h2></div><div class="panel-b">${
          (p.milestones || [])
            .map(m => {
              const n = diffD(parse(m.date), TODAY);
              return `<div class="row" style="height:32px;font-size:13px"><span style="width:9px;height:9px;transform:rotate(45deg);border-radius:2px;flex-shrink:0;margin:0 3px;background:${n < 0 ? 'var(--green)' : pColor(p)}"></span><span class="grow trunc ${n < 0 ? 'faint' : ''}">${esc(m.name)}</span><span class="num muted">${fmtDate(m.date)}</span></div>`;
            })
            .join('') || '<span class="faint">No milestones yet</span>'
        }</div></section>
        <section class="panel"><div class="panel-h"><h2>Recent activity</h2><div class="acts"><button class="btn btn-sm btn-ghost" data-a="go" data-r="project" data-id="${esc(p.id)}" data-tab="activity">View all</button></div></div><div class="panel-b feed">${acts.map(a => actHtml(a)).join('') || '<span class="faint">No activity yet</span>'}</div></section>
      </div>
    </div>
  </div>`;
}
/* The stages of the project's set in order, the current one marked, each with the day the project last entered it (history of a stage
   that is no longer in the set is not shown). */
function stageHistory(p) {
  const now = stageOf(p).id;
  const at = new Map(); // (not {}: a stage id comes from the server, and "__proto__" is one)
  for (const h of p.stageHistory || []) at.set(h.stage, h.at);
  const stages = setOf(p).stages;
  if (!stages.length) return '<span class="faint">No stages</span>';
  return stages
    .map(s => {
      const d = at.has(s.id) ? fmtDate(new Date(at.get(s.id)), true) : '';
      return `<div class="row" style="height:30px;font-size:13px;gap:8px"><span class="pdot" style="--c:${STAGE_COLORS[s.color]};border-radius:50%;width:8px;height:8px;flex-shrink:0"></span><span class="grow trunc ${s.id === now ? '' : 'muted'}" style="${s.id === now ? 'font-weight:600' : ''}">${esc(s.name)}</span>${s.id === now ? `<span class="faint" style="font-size:11.5px">current</span>` : ''}<span class="num ${d ? 'muted' : 'faint'}" style="font-size:12px">${d || '\u2014'}</span></div>`;
    })
    .join('');
}
export function projActivity(p) {
  const as = D().activity.filter(a => a.project === p.id);
  const cs = D()
    .comments.filter(c => task(c.task)?.project === p.id)
    .map(c => ({ id: c.id, by: c.by, verb: 'commented on', task: c.task, project: p.id, at: c.at, extra: '' }));
  const all = [...as, ...cs].sort((a, b) => b.at - a.at);
  const b = {};
  all.forEach(a => (b[dayBucket(a.at)] ||= []).push(a));
  return `<div class="page" style="max-width:780px;padding-top:18px">${
    all.length
      ? Object.entries(b)
          .map(([k, list]) => `<div class="day-h">${k}</div><div class="feed lined">${list.map(a => actHtml(a)).join('')}</div>`)
          .join('')
      : empty('activity', 'No activity yet', 'Changes to this project will appear here.')
  }</div>`;
}
