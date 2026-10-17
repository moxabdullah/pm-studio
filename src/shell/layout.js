/* ---------- shell ---------- */
import { MOD, TODAY, diffD, esc, parse } from '../core/utils.js';
import { ic, wsLogo } from '../core/icons.js';
import { HEALTH } from '../core/constants.js';
import { lookup } from '../core/safe.js';
import { D, S, allTasks, inWs, isFinished, me, mem, pColor, proj, stageOf, team, teamsList, visibleProjects, wsArchivedTasks } from '../core/store.js';
import { av, pDot, safely } from '../ui/helpers.js';
import { ROUTE_NAMES, sideCollapsed } from './render.js';
import { skeleton } from './skeletons.js';
import { pageHome } from '../pages/home.js';
import { pageOverview } from '../pages/overview.js';
import { pageMyTasks } from '../pages/my-tasks.js';
import { pageTasks } from '../pages/tasks.js';
import { pageInbox } from '../pages/inbox.js';
import { pageNotifications } from '../pages/notifications.js';
import { pageFavorites } from '../pages/favorites.js';
import { pageProjects } from '../pages/projects.js';
import { pageMember, pageMembers, pageTeam, pageTeams } from '../pages/members.js';
import { pageActivity } from '../pages/activity.js';
import { pageSearch } from '../pages/search.js';
import { page404, stateFailed } from '../pages/errors.js';
import { PTABS, pageProject } from '../pages/project.js';
import { pageWsCalendar } from '../views/calendar.js';
import { pageWsTimeline } from '../views/timeline.js';
import { pageSettings } from '../pages/settings.js';
import { pageStates, pageSystem } from '../pages/design-system.js';
import { pageArchive } from '../features/archive.js';

export function renderShell() {
  const u = S.ui;
  // While the sidebar is open as the phone's drawer, all that is outside it and its scrim (the skip link, the page, the bottom nav) is inert:
  // it takes no Tab stop and no tap, and the page behind the scrim is not read out. The offline bar is the exception, and it is in <main>: so
  // <main> is not inert itself, but the top bar and the page are. The bar is above the scrim (responsive.css), so a tap reaches it where the
  // sidebar does not cover it (the drawer is narrower than the phone by the room of the bar's button: .offline, responsive.css), and it is a part of the
  // sidebar's Tab cycle (keyboard.js).
  const inert = u.mnav ? ' inert' : '';
  return `<button class="skip" data-a="skipToContent"${inert}>Skip to content</button><div class="shell ${sideCollapsed() ? 'collapsed' : ''} ${u.mnav ? 'mnav' : ''} ${u.offline ? 'offline' : ''} ${u.fx.tabs ? 'fx-tabs' : ''}">
    ${safely(renderSidebar)}
    ${u.mnav ? '<div class="side-scrim" data-a="closeMnav"></div>' : ''}
    <main class="main" id="main">
      ${safely(renderTopbar)}
      ${u.offline ? `<div class="offline-bar" role="alert">${ic('wifi-off', 15)}<span><b>You're offline.</b> Changes won't be saved until your connection is back.</span><span class="sp"></span><button class="btn btn-sm btn-secondary" data-a="retryOnline">Try again</button></div>` : ''}
      <div class="content ${u.fx.route ? 'fx-route' : ''}" id="main-content" tabindex="-1"${inert} data-keep="c:${esc(u.route)}:${esc(u.params.id || '')}:${esc(u.params.tab || '')}:${esc(u.params.sec || '')}">${u.loading ? skeleton() : renderPage()}</div>
    </main>
    ${safely(renderBottomNav)}
  </div>`;
}
export function renderPage() {
  const r = S.ui.route;
  try {
    // only the table's own names resolve, so a route named "constructor" is not-found rather than an inherited function
    const P = lookup({
      home: pageHome,
      inbox: pageInbox,
      mytasks: pageMyTasks,
      favorites: pageFavorites,
      notifications: pageNotifications,
      search: pageSearch,
      overview: pageOverview,
      projects: pageProjects,
      project: pageProject,
      tasks: pageTasks,
      calendar: pageWsCalendar,
      timeline: pageWsTimeline,
      members: pageMembers,
      member: pageMember,
      teams: pageTeams,
      team: pageTeam,
      activity: pageActivity,
      settings: pageSettings,
      system: pageSystem,
      states: pageStates,
      archive: pageArchive,
    });
    return (P[r] || page404)();
  } catch (e) {
    console.error(e);
    return stateFailed();
  }
}

// The rail's tooltip, and the item's name while its label is hidden (the label names it in the full sidebar, with its count)
const railTip = label => (sideCollapsed() ? `data-tip="${esc(label)}" data-tip-pos="right" aria-label="${esc(label)}"` : '');
export function sItem(route, label, icon, opt = {}) {
  const on = S.ui.route === route && (!opt.id || S.ui.params.id === opt.id);
  return `<button class="sitem ${on ? 'on' : ''}" data-a="${opt.act || 'go'}" data-r="${route}" ${opt.id ? `data-id="${esc(opt.id)}"` : ''} ${railTip(label)} ${on ? 'aria-current="page"' : ''}>${ic(icon, 16)}<span class="trunc">${esc(label)}</span>${opt.ct ? `<span class="ct ${opt.dot ? 'dotc' : ''}">${opt.ct}</span>` : ''}${opt.kbd ? `<span class="ct hide-m"><kbd>${opt.kbd}</kbd></span>` : ''}</button>`;
}
// The pages a project lists under its row in the sidebar are some of its tabs (PTABS). Read when drawn: the two modules import each other.
const SIDE_TABS = new Set(['board', 'list', 'timeline', 'files']);
export function renderSidebar() {
  const u = S.ui,
    d = D();
  const subTabs = PTABS.filter(([tab]) => SIDE_TABS.has(tab));
  const col = sideCollapsed();
  const unreadInbox = d.notifs.filter(n => !n.read && n.type !== 'update').length;
  const unreadAll = d.notifs.filter(n => !n.read).length;
  const myOpen = allTasks().filter(t => t.assignee === d.me && t.status !== 'done' && t.due && diffD(parse(t.due), TODAY) <= 0).length;
  const projs = visibleProjects().filter(p => !isFinished(p));
  const inProj = u.route === 'project' ? u.params.id : null;
  return `<nav class="side" id="side-nav" aria-label="Main">
    <div class="side-top">
      <div class="row" style="gap:2px">
        <button class="ibtn side-close" data-a="closeMnav" aria-label="Close navigation">${ic('x', 17)}</button>
        <button class="ws grow" data-a="pop" data-pop="ws" aria-haspopup="menu" aria-label="Switch workspace">
          ${wsLogo(d.ws, 22)}
          <span class="ws-name trunc">${esc(d.ws.name)}</span>
          <span class="chev-d faint">${ic('chevrons-up-down', 13)}</span>
        </button>
        ${col ? '' : `<button class="ibtn ibtn-sm hide-m" data-a="toggleSide" data-tip="Collapse sidebar  [" aria-label="Collapse sidebar">${ic('panel-left', 15)}</button>`}
      </div>
    </div>
    <div class="side-scroll" data-keep="side">
      ${col ? `<button class="sitem" data-a="toggleSide" ${railTip('Expand sidebar')}>${ic('panel-left', 16)}</button>` : ''}
      ${sItem('home', 'Home', 'house')}
      ${sItem('inbox', 'Inbox', 'inbox', { ct: unreadInbox || '', dot: true })}
      ${sItem('mytasks', 'My Tasks', 'circle-check', { ct: myOpen || '' })}
      ${sItem('favorites', 'Favorites', 'star')}
      ${sItem('notifications', 'Notifications', 'bell', { ct: unreadAll || '' })}
      <div class="sgroup" role="group" aria-labelledby="sg-workspace">
        <div class="sgroup-h" id="sg-workspace">Workspace</div>
        ${sItem('overview', 'Overview', 'layout-dashboard')}
        ${sItem('projects', 'Projects', 'folder-kanban')}
        ${sItem('tasks', 'Tasks', 'list-checks')}
        ${sItem('calendar', 'Calendar', 'calendar')}
        ${sItem('timeline', 'Timeline', 'chart-gantt')}
        ${sItem('members', 'Members', 'users')}
        ${sItem('activity', 'Activity', 'activity')}
      </div>
      <div class="sgroup" id="side-projects" role="group" aria-labelledby="sg-projects">
        <div class="sgroup-h"><span id="sg-projects">Projects</span><span class="sp"></span><button class="ibtn ibtn-xs" data-a="newProject" data-tip="New project  P" aria-label="New project">${ic('plus', 14)}</button></div>
        ${projs
          .map(p => {
            const open = !!u.expanded[p.id];
            const on = inProj === p.id;
            // With the sub-list shown, the current page is its item and the row only holds it
            const cur = open && !col && subTabs.some(([tab]) => tab === u.params.tab) ? 'true' : 'page';
            return `<div class="sproj" data-proj-drop="${esc(p.id)}">
            <div class="sitem ${on ? 'on' : ''}" draggable="true" data-drag-proj="${esc(p.id)}" data-a="go" data-r="project" data-id="${esc(p.id)}" data-ctx="project" role="link" tabindex="0" ${col ? '' : `aria-expanded="${open}"`} ${on ? `aria-current="${cur}"` : ''} ${railTip(p.name)}>
              <span class="pico" style="--c:${pColor(p)}" ${col ? '' : `data-a="toggleExpand" data-id="${esc(p.id)}"`}>${ic(p.icon, 12)}</span>
              <span class="trunc">${esc(p.name)}</span>
              ${p.fav ? `<span class="fav">${ic('star', 11)}</span>` : ''}
              ${p.private ? `<span class="faint" style="margin-left:4px">${ic('lock', 11)}</span>` : ''}
              <span class="sdot" style="background:${pDot(p)}" title="${esc(stageOf(p).name)}${p.health && p.health !== 'ok' ? ' · ' + HEALTH[p.health].name : ''}"></span>
              <span class="hov" aria-hidden="true"><span class="ibtn ibtn-xs" data-a="ctxBtn" data-ctx="project" data-id="${esc(p.id)}" aria-label="Project options">${ic('ellipsis', 14)}</span><span class="ibtn ibtn-xs" data-a="toggleExpand" data-id="${esc(p.id)}" aria-label="Expand">${ic('chevron-right', 13, 'chev ' + (open ? 'open' : ''))}</span></span>
            </div>
            <div class="sub ${open && !col ? 'open' : ''}">
              ${subTabs
                .map(
                  ([tab, n, i]) =>
                    `<button class="sitem ${on && u.params.tab === tab ? 'on' : ''}" data-a="go" data-r="project" data-id="${esc(p.id)}" data-tab="${esc(tab)}" ${on && u.params.tab === tab ? 'aria-current="page"' : ''}>${ic(i, 14)}<span>${n}</span></button>`,
                )
                .join('')}
            </div>
          </div>`;
          })
          .join('')}
        ${sItem('archive', 'Archive', 'archive', { ct: wsArchivedTasks().length + D().projects.filter(p => p.archived && inWs(p)).length || '' })}
      </div>
      <div class="sgroup" role="group" aria-labelledby="sg-teams">
        <div class="sgroup-h"><span id="sg-teams">Teams</span><span class="sp"></span><button class="ibtn ibtn-xs" data-a="newTeam" data-tip="New team" aria-label="New team">${ic('plus', 14)}</button></div>
        ${teamsList()
          .map(t => sItem('team', t.name, t.icon, { id: t.id }))
          .join('')}
      </div>
    </div>
    <div class="side-bot">
      <button class="sitem" data-a="pop" data-pop="help" aria-haspopup="menu" ${railTip('Help')}>${ic('circle-help', 16)}<span>Help & resources</span></button>
      ${sItem('settings', 'Settings', 'settings')}
      <button class="sitem" data-a="pop" data-pop="user" aria-haspopup="menu" style="height:36px" ${railTip('Account')}>${av(d.me, 'presence', false, true)}<span class="trunc" style="color:var(--text);font-weight:500">${esc(me().name)}</span><span class="ct">${ic('chevrons-up-down', 13)}</span></button>
    </div>
  </nav>`;
}

export function crumbs() {
  const u = S.ui,
    r = u.route,
    out = [];
  const c = (label, act = '', cur = false, icon = '') => `<button class="${cur ? 'cur' : ''}" ${act}>${icon}${esc(label)}</button>`;
  if (r === 'project') {
    const p = proj(u.params.id);
    out.push(c('Projects', 'data-a="go" data-r="projects"'));
    if (p)
      out.push(
        c(
          p.name,
          `data-a="go" data-r="project" data-id="${esc(p.id)}" data-tab="overview"`,
          true,
          `<span class="pico" style="--c:${pColor(p)};width:16px;height:16px;border-radius:4px;display:grid;place-items:center;color:${pColor(p)}">${ic(p.icon, 11)}</span>`,
        ),
      );
  } else if (r === 'member') {
    out.push(c('Members', 'data-a="go" data-r="members"'));
    out.push(c(mem(u.params.id)?.name || 'Member', '', true));
  } else if (r === 'team') {
    out.push(c('Teams', 'data-a="go" data-r="teams"'));
    out.push(c(team(u.params.id)?.name || 'Team', '', true));
  } else if (r === 'settings') {
    out.push(c('Settings', '', true));
  } else out.push(c(ROUTE_NAMES[r] || 'Not found', '', true));
  return out.join('<span class="sep">/</span>');
}
export function renderTopbar() {
  return `<header class="topbar"${S.ui.mnav ? ' inert' : ''}>
    <button class="ibtn" data-a="openMnav" aria-label="Open navigation" aria-expanded="${!!S.ui.mnav}" aria-controls="side-nav" style="display:none" id="mnav-btn">${ic('menu', 17)}</button>
    <style>@media(max-width:900px){#mnav-btn{display:inline-flex!important}}</style>
    <nav class="crumbs trunc" aria-label="Breadcrumb">${crumbs()}</nav>
    <span class="sp"></span>
    <button class="topsearch" data-a="openPalette" aria-label="Search and commands">${ic('search', 14)}<span class="lbltxt">Search or jump to…</span><span class="kbd">${MOD}K</span></button>
    <button class="ibtn" id="top-notifs" data-a="go" data-r="notifications" data-tip="Notifications" aria-label="Notifications">${ic('bell', 16)}${D().notifs.some(n => !n.read) ? '<span style="position:absolute;top:6px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px var(--surface)"></span>' : ''}</button>
    <button class="btn btn-secondary btn-sm" data-a="pop" data-pop="create" aria-haspopup="menu" aria-label="Create new">${ic('plus', 14)}<span class="hide-m">New</span>${ic('chevron-down', 12, 'hide-m')}</button>
    <button class="ibtn hide-m" id="top-account" data-a="pop" data-pop="user" aria-haspopup="menu" aria-label="Account" style="width:auto;padding:0 2px">${av(D().me, 'md', false)}</button>
  </header>`;
}
export function renderBottomNav() {
  const r = S.ui.route;
  const unread = D().notifs.some(n => !n.read && n.type !== 'update');
  const b = (route, label, icon, extra = '') =>
    `<button class="${r === route ? 'on' : ''}" data-a="go" data-r="${route}">${ic(icon, 19)}<span>${label}</span>${extra}</button>`;
  return `<nav class="bottomnav" aria-label="Primary"${S.ui.mnav ? ' inert' : ''}>
    ${b('home', 'Home', 'house')}${b('mytasks', 'My Tasks', 'circle-check')}${b('projects', 'Projects', 'folder-kanban')}${b('inbox', 'Inbox', 'inbox', unread ? '<span class="bdot"></span>' : '')}
    <button id="mnav-more" data-a="openMnav" aria-expanded="${!!S.ui.mnav}" aria-controls="side-nav">${ic('ellipsis', 19)}<span>More</span></button>
  </nav>`;
}
