/* =====================================================================
   SETTINGS · AUTH · ONBOARDING · DESIGN SYSTEM · SYSTEM STATES
   ===================================================================== */
import { dOff, esc, fmtDate, fmtTime } from '../core/utils.js';
import { ic, wsLogo } from '../core/icons.js';
import { DEFAULT_STAGE_SET } from '../core/constants.js';
import { D, S, canManageStages, canManageTemplates, inWs, isAdmin, me, projectsUsing, stageSetsOf, templatesOf } from '../core/store.js';
import { av, pIcon, stagePill } from '../ui/helpers.js';
import { permsTable, teamsGrid } from './members.js';
import { page404 } from './errors.js';
import { SHORTCUTS } from '../overlays/modals.js';

export const SET_NAV = [
  [
    'General',
    [
      ['workspace', 'Workspace', 'building-2'],
      ['appearance', 'Appearance', 'palette'],
      ['language', 'Language', 'languages'],
      ['datetime', 'Date & time', 'clock'],
    ],
  ],
  [
    'Workspace',
    [
      ['members', 'Members', 'users'],
      ['teams', 'Teams', 'users-round'],
      ['projects', 'Projects', 'folder-kanban'],
      ['templates', 'Templates', 'layers'],
      ['stages', 'Stages', 'list-ordered'],
      ['permissions', 'Permissions', 'shield'],
    ],
  ],
  [
    'Notifications',
    [
      ['notif-email', 'Email', 'mail'],
      ['notif-push', 'Push', 'smartphone'],
      ['notif-mentions', 'Mentions', 'at-sign'],
      ['notif-assign', 'Task assignments', 'user-check'],
    ],
  ],
  [
    'Personal',
    [
      ['profile', 'Profile', 'user'],
      ['preferences', 'Preferences', 'sliders-horizontal'],
      ['shortcuts', 'Keyboard shortcuts', 'keyboard'],
    ],
  ],
  ['Security', [['password', 'Password', 'key-round']]],
];
export function srow(t, d, ctl) {
  return `<div class="srow"><div><div class="t">${t}</div>${d ? `<div class="d">${d}</div>` : ''}</div><div class="row">${ctl}</div></div>`;
}
export const tog = (k, on, src = 'pref') =>
  `<input type="checkbox" class="toggle" data-in="${src}Toggle" data-k="${k}" ${on ? 'checked' : ''} aria-label="${k}">`;
export const sel = (k, opts, v) =>
  `<select class="select" style="width:auto;min-width:180px" data-in="prefSel" data-k="${k}" aria-label="${k}">${opts
    .map(o => {
      const [val, n] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${n}</option>`;
    })
    .join('')}</select>`;
export function pageSettings() {
  const sec = S.ui.params.sec || S.ui.settings || 'appearance';
  const title = SET_NAV.flatMap(g => g[1]).find(x => x[0] === sec) || ['appearance', 'Appearance'];
  return `<div class="set">
    <nav class="set-nav" aria-label="Settings">${SET_NAV.map(([g, items]) => `<div class="gh">${g}</div>${items.map(([k, n, i]) => `<button class="sitem ${sec === k ? 'on' : ''}" data-a="go" data-r="settings" data-sec="${k}">${ic(i, 15)}<span>${n}</span></button>`).join('')}`).join('')}</nav>
    <div class="set-body" data-keep="set:${esc(sec)}"><div class="set-in">${settingsBody(sec, title[1])}</div></div>
  </div>`;
}
export function settingsBody(sec, title) {
  const P = S.prefs;
  const d = D();
  const np = d.notifPrefs;
  const admin = isAdmin();
  const H = lead => `<h1>${title}</h1><p class="lead">${lead}</p>`;
  switch (sec) {
    case 'workspace':
      return (
        H(admin ? 'Your workspace name, address, and identity.' : 'Your workspace name, address, and identity. Only admins can change them.') +
        `
      <form data-submit="saveWorkspace">
      <div class="sblock" style="margin-top:0"><div class="row" style="gap:14px;margin-bottom:18px">${wsLogo(d.ws, 52)}${admin ? `<div><div class="label" style="margin-bottom:6px">Workspace icon</div><div class="swatches">${['#2F2E2A', '#5A67D8', '#3B82C4', '#23918A', '#C54B78', '#C48A1E'].map(c => `<button type="button" class="sw ${d.ws.c === c ? 'on' : ''}" style="--c:${c};width:22px;height:22px" data-a="wsColor" data-v="${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>` : ''}</div>
      <div class="col" style="gap:14px;max-width:440px"><div class="field"><label class="label" for="ws-name">Workspace name</label><input class="input" id="ws-name" value="${esc(d.ws.name)}" ${admin ? '' : 'disabled'}></div>
      <div class="field"><label class="label" for="ws-url">Workspace URL</label><div class="row" style="gap:0"><span class="input" style="width:auto;background:var(--surface-2);border-right:0;border-radius:6px 0 0 6px;display:flex;align-items:center;color:var(--text-2)">${esc(location.host)}/</span><input class="input" id="ws-url" value="${esc(d.ws.url)}" style="border-radius:0 6px 6px 0" ${admin ? '' : 'disabled'}></div>${admin ? '<span class="hint">Changing the URL will break existing links.</span>' : ''}</div>
      ${admin ? '<div><button class="btn btn-primary" data-a="saveWorkspace" id="ws-save">Save changes</button></div>' : ''}</div></div></form>`
      );
    case 'appearance':
      return (
        H('Customize how PM Space looks on this device.') +
        `
      <div class="sblock" style="margin-top:0"><h2>Theme</h2><div class="themecards" style="margin-top:12px" role="radiogroup" aria-label="Theme">${[
        ['light', 'Light'],
        ['dark', 'Dark'],
        ['system', 'System'],
      ]
        .map(([k, n]) => {
          const L = { bg: '#FBFAF8', s: '#F2F1EE', t: '#1D1C1A', b: '#E3E1DC', a: '#4B5BD6' },
            Dk = { bg: '#1D1D1C', s: '#151514', t: '#ECEAE5', b: '#333230', a: '#8E9AF3' };
          const pv = c =>
            `<div class="s" style="background:${c.s}"><i style="background:${c.b};width:70%"></i><i style="background:${c.a};width:55%"></i><i style="background:${c.b};width:80%"></i><i style="background:${c.b};width:60%"></i></div><div class="m" style="background:${c.bg}"><i style="background:${c.t};width:45%;height:7px"></i><i style="background:${c.b}"></i><i style="background:${c.b};width:80%"></i><i style="background:${c.a};width:30%;height:10px;margin-top:4px"></i></div>`;
          return `<button class="tcard ${P.theme === k ? 'on' : ''}" role="radio" aria-checked="${P.theme === k}" data-a="setTheme" data-v="${k}"><div class="tprev" style="${k === 'system' ? 'grid-template-columns:1fr 1fr;display:grid' : ''}">${k === 'system' ? `<div style="display:grid;grid-template-columns:30% 1fr">${pv(L)}</div><div style="display:grid;grid-template-columns:30% 1fr">${pv(Dk)}</div>` : pv(k === 'light' ? L : Dk)}</div><span class="row" style="font-weight:500;font-size:13px;gap:6px">${ic(k === 'light' ? 'sun' : k === 'dark' ? 'moon' : 'monitor', 14)}${n}${P.theme === k ? `<span class="sp"></span><span style="color:var(--accent)">${ic('circle-check', 15)}</span>` : ''}</span></button>`;
        })
        .join('')}</div></div>
      <div class="sblock"><h2>Accent color</h2>${srow(
        'Accent',
        'Used for primary buttons, focus rings, and selection.',
        `<div class="swatches" role="radiogroup" aria-label="Accent color">${[
          ['indigo', '#4B5BD6'],
          ['blue', '#2F6CD4'],
          ['violet', '#7348CC'],
          ['teal', '#1A7F7A'],
          ['rose', '#B93D68'],
          ['graphite', '#34332F'],
        ]
          .map(
            ([k, c]) =>
              `<button class="sw ${P.accent === k ? 'on' : ''}" style="--c:${c}" role="radio" aria-checked="${P.accent === k}" data-a="setPref" data-k="accent" data-v="${k}" aria-label="${k}" data-tip="${esc(k[0].toUpperCase() + k.slice(1))}">${P.accent === k ? ic('check', 13) : ''}</button>`,
          )
          .join('')}</div>`,
      )}</div>
      <div class="sblock"><h2>Density</h2>
        ${srow('Sidebar density', 'Compact fits more projects on screen.', `<div class="seg">${['comfortable', 'compact'].map(k => `<button class="${P.side === k ? 'on' : ''}" data-a="setPref" data-k="side" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`)}
        ${srow('Task display', 'Row height in lists and card padding on boards.', `<div class="seg">${['comfortable', 'compact'].map(k => `<button class="${P.density === k ? 'on' : ''}" data-a="setPref" data-k="density" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`)}
        ${srow(
          'Motion',
          'Reduce animations for drawers, modals, and transitions.',
          sel(
            'motion',
            [
              ['system', 'Follow system'],
              ['reduce', 'Reduce motion'],
            ],
            P.motion,
          ),
        )}
      </div>`
      );
    case 'language':
      return (
        H('Language and regional formats.') +
        srow(
          'Language',
          'The language used throughout the interface.',
          sel('lang', ['English (US)', 'English (UK)', 'Deutsch', 'Español', 'Français', '日本語'], P.lang),
        ) +
        srow('Spellcheck', 'Check spelling as you type.', tog('spell', P.spell !== false))
      );
    case 'datetime':
      return (
        H('How dates and times appear across the workspace.') +
        srow(
          'Time zone',
          'Used for due dates and reminders.',
          sel('tz', ['(GMT-08:00) Pacific Time', '(GMT-05:00) Eastern Time', '(GMT+00:00) London', '(GMT+01:00) Berlin', '(GMT+08:00) Singapore'], P.tz),
        ) +
        srow(
          'Date format',
          `Preview: <b>${fmtDate(dOff(8))}</b>`,
          sel(
            'dateFmt',
            [
              ['MMM d', 'Oct 1'],
              ['d/M', '1/10'],
              ['M/d', '10/1'],
              ['yyyy-MM-dd', '2026-10-01'],
            ],
            P.dateFmt,
          ),
        ) +
        srow(
          'Start week on',
          'Affects calendars and the timeline.',
          sel(
            'weekStart',
            [
              ['1', 'Monday'],
              ['0', 'Sunday'],
              ['6', 'Saturday'],
            ],
            P.weekStart,
          ),
        ) +
        srow(
          'Time format',
          '',
          sel(
            'timeFmt',
            [
              ['12', '12-hour (2:30 PM)'],
              ['24', '24-hour (14:30)'],
            ],
            P.timeFmt || '12',
          ),
        )
      );
    case 'members':
      return (
        H(`${d.members.length} people have access to ${esc(d.ws.name)}.`) +
        `<div class="row" style="margin-bottom:12px"><button class="btn btn-secondary" data-a="go" data-r="members">Open member directory</button></div>
      <div class="panel" style="overflow:hidden">${d.members.map(m => `<div class="mini" style="min-height:52px;cursor:default" data-ctx="member" data-id="${esc(m.id)}">${av(m.id, 'md', false)}<div class="grow"><div style="font-weight:500">${esc(m.name)}</div><div class="faint" style="font-size:12px">${esc(m.email)}</div></div>${admin && m.id !== d.me ? `<button class="pillbtn bordered" data-a="pop" data-pop="role" data-id="${esc(m.id)}">${esc(m.role)}${ic('chevron-down', 12)}</button>` : `<span class="pillbtn">${esc(m.role)}</span>`}<button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="member" data-id="${esc(m.id)}" aria-label="Options">${ic('ellipsis', 14)}</button></div>`).join('')}</div>`
      );
    case 'teams':
      return H('Teams group people and projects.') + teamsGrid();
    case 'projects': {
      const arch = d.projects.filter(p => p.archived && inWs(p));
      return (
        H('Defaults for new projects and archived work.') +
        srow(
          'Default project view',
          'The tab that opens when you open a project.',
          sel(
            'defaultTab',
            [
              ['board', 'Board'],
              ['list', 'List'],
              ['table', 'Table'],
              ['overview', 'Overview'],
              ['timeline', 'Timeline'],
            ],
            P.defaultTab || 'board',
          ),
        ) +
        srow('Show completed tasks on boards', '', tog('showDoneBoard', P.showDoneBoard !== false)) +
        `<div class="sblock"><h2>Archived projects</h2>${arch.length ? arch.map(p => `<div class="srow"><div class="row">${pIcon(p, '', 14)}<b style="font-weight:500">${esc(p.name)}</b></div><div class="row"><button class="btn btn-secondary btn-sm" data-a="restoreProject" data-id="${esc(p.id)}">Restore</button><button class="btn btn-danger-ghost btn-sm" data-a="delProject" data-id="${esc(p.id)}">Delete</button></div></div>`).join('') : `<p class="faint" style="padding:12px 0">No archived projects. Archived projects are hidden from the sidebar but keep all their tasks.</p>`}<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" data-a="go" data-r="archive">${ic('archive', 13)}Open archive</button></div></div>`
      );
    }
    case 'templates': {
      const manage = canManageTemplates();
      const list = templatesOf(d.ws.id);
      return (
        H(`Templates for ${esc(d.ws.name)}. New projects can start from one.`) +
        (list.length
          ? `<div class="sblock" style="margin-top:0">${list.map(t => templateRow(t, manage)).join('')}</div>`
          : `<p class="faint" style="padding:12px 0">No templates yet.${manage ? ' Open a project and choose ••• › Save as template.' : ''}</p>`) +
        (manage ? '' : '<p class="faint" style="font-size:12px;margin-top:12px">Only admins and managers can change templates.</p>')
      );
    }
    case 'stages': {
      const manage = canManageStages();
      const list = stageSetsOf(d.ws.id);
      return (
        H(`Stages for ${esc(d.ws.name)}. Each project sits in one stage of a set.`) +
        `<div class="sblock" style="margin-top:0">${(list.length ? list : [DEFAULT_STAGE_SET]).map(s => stageSetRow(s, manage, !list.length)).join('')}</div>` +
        (!manage
          ? '<p class="faint" style="font-size:12px;margin-top:12px">Only admins and managers can change stage sets.</p>'
          : list.length
            ? `<div class="row" style="margin-top:12px"><button class="btn btn-secondary" data-a="newStageSet">${ic('plus', 14)}New stage set</button></div>`
            : '<p class="faint" style="font-size:12px;margin-top:12px">Customize the built-in set to add more stage sets.</p>')
      );
    }
    case 'permissions':
      return H('Control what each role can do.') + `<div class="sblock"><h2>Role permissions</h2><div style="margin-top:12px">${permsTable()}</div></div>`;
    case 'notif-email':
      return (
        H('Choose which emails you receive.') +
        srow('Mentions', 'When someone @mentions you.', tog('email_mention', np.email_mention, 'np')) +
        srow('Assignments', 'When a task is assigned to you.', tog('email_assign', np.email_assign, 'np')) +
        srow('Comments', 'On tasks you created or are assigned.', tog('email_comment', np.email_comment, 'np')) +
        srow('Daily digest', `A summary of what changed, every weekday at ${fmtTime('08:00')}.`, tog('email_digest', np.email_digest, 'np'))
      );
    case 'notif-push':
      return (
        H('Notifications on desktop and mobile.') +
        srow('Mentions', '', tog('push_mention', np.push_mention, 'np')) +
        srow('Assignments', '', tog('push_assign', np.push_assign, 'np')) +
        srow('Comments', '', tog('push_comment', np.push_comment, 'np')) +
        srow('Due date reminders', 'One day before a task is due.', tog('push_due', np.push_due, 'np'))
      );
    case 'notif-mentions':
      return (
        H('Decide which mentions reach you.') +
        srow('@mentions in comments and descriptions', '', tog('mention_all', np.mention_all, 'np')) +
        srow('@team mentions', 'When your team is mentioned, e.g. @Product.', tog('mention_team', np.mention_team !== false, 'np')) +
        srow('@workspace mentions', 'Announcements to everyone.', tog('mention_ws', !!np.mention_ws, 'np'))
      );
    case 'notif-assign':
      return (
        H('Updates about tasks assigned to you.') +
        srow("When I'm assigned a task", '', tog('assign_self', np.assign_self, 'np')) +
        srow('When my task changes status', '', tog('assign_status', np.assign_status !== false, 'np')) +
        srow('When my task is overdue', '', tog('assign_over', np.assign_over !== false, 'np'))
      );
    case 'profile': {
      const err = S.ui.errors.pname2;
      return (
        H('How you appear to others in the workspace.') +
        `<form data-submit="saveProfile" class="col" style="gap:16px;max-width:440px">
      <div class="row" style="gap:14px">${av(d.me, 'xl', false)}<div><div class="label" style="margin-bottom:6px">Avatar color</div><div class="swatches">${['#5A67D8', '#C54B78', '#3B82C4', '#23918A', '#C48A1E', '#8662C9'].map(c => `<button type="button" class="sw ${me().c === c ? 'on' : ''}" style="--c:${c};width:22px;height:22px" data-a="avColor" data-v="${c}" aria-label="Color"></button>`).join('')}</div></div></div>
      <div class="field"><label class="label" for="pf-name">Full name</label><input class="input ${err ? 'is-error' : ''}" id="pf-name" value="${esc(me().name)}">${err ? `<span class="err">${ic('circle-alert', 12)}${esc(err)}</span>` : ''}</div>
      <div class="field"><label class="label" for="pf-title">Title</label><input class="input" id="pf-title" value="${esc(me().title)}"></div>
      <div class="field"><label class="label" for="pf-email">Email</label><input class="input" id="pf-email" value="${esc(me().email)}" disabled><span class="hint">Ask an admin to change your sign-in email.</span></div>
      <div><button class="btn btn-primary" data-a="saveProfile" id="pf-save">Save profile</button></div></form>`
      );
    }
    case 'preferences':
      return (
        H('Personal defaults for how you work.') +
        srow(
          'Open on launch',
          'The page you see when PM Space opens.',
          sel(
            'home',
            [
              ['home', 'Home'],
              ['mytasks', 'My Tasks'],
              ['inbox', 'Inbox'],
            ],
            P.home,
          ),
        ) +
        srow(
          'Open tasks in',
          'Side panel keeps your place in the list.',
          sel(
            'openTasks',
            [
              ['drawer', 'Side panel'],
              ['full', 'Full page'],
            ],
            P.openTasks,
          ),
        ) +
        srow('Confirm before deleting tasks', '', tog('confirmDel', P.confirmDel !== false))
      );
    case 'shortcuts':
      return (
        H('Move faster with the keyboard.') +
        SHORTCUTS.map(
          ([g, list]) =>
            `<div class="sblock" style="margin-top:18px"><h2>${g}</h2>${list.map(([n, k]) => `<div class="srow" style="padding:9px 0"><span>${n}</span><span class="row" style="gap:4px">${k.map((x, i) => `${i && k[0] === 'G' ? '<span class="faint" style="font-size:11px">then</span>' : ''}<kbd>${x}</kbd>`).join('')}</span></div>`).join('')}</div>`,
        ).join('')
      );
    case 'password': {
      const e = S.ui.errors;
      const pw = S.ui.pwNew || '';
      return (
        H("Use a long password you don't use anywhere else.") +
        `${S.ui.pwDone ? `<div class="alert ok" style="margin-bottom:14px">${ic('circle-check', 15)}<span>Password updated. You stay signed in here. Any other device is signed out and needs the new password.</span></div>` : ''}<form data-submit="savePassword" class="col" style="gap:14px;max-width:400px">
      <div class="field"><label class="label" for="pw-cur">Current password</label><input type="password" class="input ${e.pwCur ? 'is-error' : ''}" id="pw-cur" autocomplete="current-password">${e.pwCur ? `<span class="err">${ic('circle-alert', 12)}${esc(e.pwCur)}</span>` : ''}</div>
      <div class="field"><label class="label" for="pw-new">New password</label><input type="password" class="input ${e.pwNew ? 'is-error' : ''}" id="pw-new" data-in="pwStrength" value="${esc(pw)}" autocomplete="new-password">${strengthMeter(pw)}${e.pwNew ? `<span class="err">${ic('circle-alert', 12)}${esc(e.pwNew)}</span>` : '<span class="hint">At least 10 characters with a number or symbol.</span>'}</div>
      <div class="field"><label class="label" for="pw-conf">Confirm new password</label><input type="password" class="input ${e.pwConf ? 'is-error' : ''}" id="pw-conf" autocomplete="new-password">${e.pwConf ? `<span class="err">${ic('circle-alert', 12)}${esc(e.pwConf)}</span>` : ''}</div>
      <div><button class="btn btn-primary${S.ui.pwBusy ? ' is-loading' : ''}" data-a="savePassword" id="pw-save"${S.ui.pwBusy ? ' aria-busy="true"' : ''}>Update password</button></div></form>`
      );
    }
  }
  return page404();
}
/* One template in Settings > Templates: its name, description and size, the whole description and the task titles when it is open, and
   what can be done with it. */
function templateRow(t, manage) {
  const open = !!S.ui.expanded[t.id];
  const n = t.tasks.length;
  const meta = `${n} task${n === 1 ? '' : 's'}${t.updated ? ` · updated ${fmtDate(new Date(t.updated))}` : ''}`;
  const desc = t.desc ? `<p class="muted" style="margin:0 0 8px 46px;font-size:12.5px;white-space:pre-line;overflow-wrap:anywhere">${esc(t.desc)}</p>` : '';
  // the task list shows only when the row is open: a collapsed row does not build it
  const titles = !open
    ? ''
    : t.tasks.length
      ? `<ol class="muted" style="margin:0 0 14px 46px;padding:0 0 0 18px;font-size:12.5px;line-height:1.7">${t.tasks
          .map(
            x =>
              `<li>${esc(x.title)}${x.subtasks.length ? ` <span class="faint">· ${x.subtasks.length} subtask${x.subtasks.length === 1 ? '' : 's'}</span>` : ''}</li>`,
          )
          .join('')}</ol>`
      : '<p class="faint" style="margin:0 0 14px 46px;font-size:12.5px">This template has no tasks.</p>';
  return `<div style="border-bottom:1px solid var(--divider)"><div class="srow" style="border-bottom:0">
    <div class="row" style="gap:10px;min-width:0;align-items:flex-start">
      <button class="ibtn ibtn-sm" data-a="toggleExpand" data-id="${esc(t.id)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} the tasks in ${esc(t.name)}">${ic(open ? 'chevron-down' : 'chevron-right', 14)}</button>
      ${pIcon(t, '', 14)}
      <div style="min-width:0"><div class="t trunc">${esc(t.name)}</div>${t.desc ? `<div class="faint trunc" style="font-size:12.5px">${esc(t.desc)}</div>` : ''}<div class="faint" style="font-size:12px;margin-top:2px">${meta}</div></div>
    </div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-a="newProject" data-tmpl="${esc(t.id)}" aria-label="New project from ${esc(t.name)}">New project</button>${manage ? `<button class="btn btn-secondary btn-sm" data-a="editTemplate" data-id="${esc(t.id)}" aria-label="Edit template ${esc(t.name)}">Edit</button><button class="btn btn-danger-ghost btn-sm" data-a="delTemplate" data-id="${esc(t.id)}" aria-label="Delete template ${esc(t.name)}">Delete</button>` : ''}</div>
  </div>${open ? desc + titles : ''}</div>`;
}
/* One stage set in Settings > Stages: its name, how many stages and projects it has, its stages in order, and what can be done with it.
   The built-in set (no records yet) cannot be edited: Customize makes a copy of it that can. */
function stageSetRow(set, manage, builtin) {
  const n = set.stages.length;
  const using = projectsUsing(set.id);
  const arch = using.filter(x => x.archived).length;
  const meta = `${n} stage${n === 1 ? '' : 's'} · ${using.length} project${using.length === 1 ? '' : 's'}${arch ? ` (${arch} archived)` : ''}`;
  const btns = !manage
    ? ''
    : builtin
      ? `<button class="btn btn-secondary btn-sm" data-a="customiseStages" aria-label="Customize ${esc(set.name)}">Customize</button>`
      : `<button class="btn btn-secondary btn-sm" data-a="editStageSet" data-id="${esc(set.id)}" aria-label="Edit ${esc(set.name)}">Edit</button><button class="btn btn-danger-ghost btn-sm" data-a="delStageSet" data-id="${esc(set.id)}" aria-label="Delete ${esc(set.name)}">Delete</button>`;
  return `<div style="border-bottom:1px solid var(--divider);padding-bottom:12px"><div class="srow" style="border-bottom:0;grid-template-columns:minmax(0,1fr) auto;gap:12px">
    <div class="row" style="gap:10px;min-width:0;align-items:flex-start">
      <span class="picon" style="--c:var(--gray)">${ic('list-ordered', 14)}</span>
      <div style="min-width:0"><div class="t trunc">${esc(set.name)}${builtin ? ' <span class="faint" style="font-weight:400">(built-in)</span>' : ''}</div><div class="faint" style="font-size:12px;margin-top:2px">${meta}</div></div>
    </div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-end">${btns}</div>
  </div><div class="row" style="flex-wrap:wrap;gap:4px;margin-left:46px">${set.stages.map(s => stagePill(s)).join('')}</div></div>`;
}
export function strengthMeter(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  const c = ['var(--red)', 'var(--red)', 'var(--amber)', 'var(--green)', 'var(--green)'][s];
  const n = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][s];
  return pw
    ? `<div class="row" style="gap:8px"><div class="strength grow" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i < s ? 'on' : ''}" style="--c:${c}"></i>`).join('')}</div><span style="font-size:11.5px;color:${c};width:60px;text-align:right">${n}</span></div>`
    : '';
}
