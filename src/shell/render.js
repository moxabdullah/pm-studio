/* =====================================================================
   SHELL: render loop, router, sidebar, topbar, skeletons, filter engine
   ===================================================================== */
import { $, $$ } from '../core/utils.js';
import { D, S, mem, proj, team } from '../core/store.js';
import { applyPrefs } from '../core/theme.js';
import { lookup } from '../core/safe.js';
import { enhanceSelects, selectMenu } from '../ui/select.js';
import { renderShell } from './layout.js';
import { PTABS } from '../pages/project.js';
import { tlAfter } from '../views/timeline.js';
import { projTableAfter } from '../pages/projects.js';
import { renderLayer } from '../overlays/drawer.js';
import { placePop } from '../overlays/popovers.js';
import { renderAuth } from '../pages/auth.js';
import { syncRailTip } from '../ui/tooltip.js';

/* The URL hash picks a route, so "#constructor" must not count as one: only the table's own keys resolve. */
export const ROUTE_NAMES = lookup({
  home: 'Home',
  inbox: 'Inbox',
  mytasks: 'My Tasks',
  favorites: 'Favorites',
  notifications: 'Notifications',
  search: 'Search',
  overview: 'Overview',
  projects: 'Projects',
  tasks: 'Tasks',
  calendar: 'Calendar',
  timeline: 'Timeline',
  members: 'Members',
  member: 'Member',
  teams: 'Teams',
  team: 'Team',
  activity: 'Activity',
  settings: 'Settings',
  system: 'Design system',
  states: 'System states',
  archive: 'Archive',
});
export const ROUTE_ICONS = {
  home: 'house',
  inbox: 'inbox',
  mytasks: 'circle-check',
  favorites: 'star',
  notifications: 'bell',
  search: 'search',
  overview: 'layout-dashboard',
  projects: 'folder-kanban',
  tasks: 'list-checks',
  calendar: 'calendar',
  timeline: 'chart-gantt',
  members: 'users',
  activity: 'activity',
  teams: 'users',
  settings: 'settings',
  system: 'component',
  states: 'layers',
  archive: 'archive',
};

/* At this width and below the sidebar is a drawer from the screen's edge, shut or open (responsive.css), not a column of the page. */
export const sideIsDrawer = () => matchMedia('(max-width: 900px)').matches;
/* The collapsed sidebar (S.ui.collapsed, a setting that is kept) is the narrow icon-only rail of the desktop. The drawer is never that rail: it has
   no room to save and its items would have no names. So the setting is drawn only where the sidebar is a column. */
export const sideCollapsed = () => S.ui.collapsed && !sideIsDrawer();
export function go(route, params = {}, opt = {}) {
  if (route === 'project' && !params.tab) params.tab = 'board';
  if (!opt.back) S.ui.history.push({ route: S.ui.route, params: S.ui.params });
  const same = S.ui.route === route && JSON.stringify(S.ui.params) === JSON.stringify(params);
  const moved = S.ui.route !== route || S.ui.params.id !== params.id; // another page, not another tab or section of this one
  S.ui.route = route;
  S.ui.params = params;
  const drawer = S.ui.mnav && sideIsDrawer();
  const inSide = drawer && !!$('.side')?.contains(document.activeElement);
  const had = document.activeElement && document.activeElement !== document.body;
  S.ui.mnav = false;
  S.ui.sel.clear();
  S.ui.pop = null;
  S.ui.composer = null;
  S.ui.editCell = null;
  if (!opt.keepDrawer && S.ui.drawer && sideIsDrawer()) S.ui.drawer = null;
  // Pages render instantly; motion (not a fake wait) carries the transition.
  clearTimeout(go._t);
  S.ui.loading = false;
  if (!same) fxSet(opt.tab ? { tab: true, tabs: true } : { route: true, tabs: true });
  render();
  // The control that was activated may be gone: a link of the drawer that was open is hidden now, which cannot hold focus, and a link of the page
  // (the breadcrumb's Projects, a stat card) is not on the page it led to. Focus is lost then, and the next Tab would start where the control was.
  // Focus goes to the page. That the link had it is read before the render: a drawer link's key is the bottom nav's too (they share keys), whose
  // visible copy render() gives the focus to instead. Not asked of a sidebar that is a column: there the link keeps focus, as it should.
  // On another page a control of the page or the layer that has the focus again was found by its key, and is another page's control that looks
  // like the first ("New task" is on most pages): not that, it is the page that gets the focus. The navigation (sidebar, bottom nav, top bar and
  // the page's tabs) keeps it. A dialog, the command menu and a full task panel are over the page and have the focus, or take it back if it is
  // lost: nothing behind them is for the focus to go to.
  const a = document.activeElement;
  const lost = !a || a === document.body;
  const part = lost ? '' : partOf(a);
  const panel = S.ui.drawer && S.ui.drawerFull;
  const over = S.ui.modals.length || S.ui.palette || panel;
  if ((drawer && (inSide || lost)) || (!over && ((had && lost) || (moved && (part === '#main-content' || part === '#layer'))))) {
    $('#main-content')?.focus({ preventScroll: true });
  } else if (lost && panel && !S.ui.modals.length && !S.ui.palette) $('.drawer')?.focus({ preventScroll: true });
  const c = $('.content');
  if (c && !same) c.scrollTop = 0;
}

/* One-shot motion flags: read by templates during the next render, then cleared, so full re-renders never replay them. */
export const reduceMotion = () => S.prefs.motion === 'reduce' || (S.prefs.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
export function fxSet(o) {
  S.ui.fx = Object.assign(S.ui.fx || {}, o);
}
export const fxc = (kind, id) => (S.ui.fx && S.ui.fx[kind] === id ? ' fx-' + kind : '');
/* Focus survives full re-renders: every control is addressable by its data-* identity. */
export const FKEYS = ['a', 'id', 'r', 'tab', 'pop', 'ctx', 'k', 'v', 'sec', 'i', 'field', 'sid', 'key', 'e', 'f', 'dragCard', 'taskRow', 'gk', 'd'];
/* The sidebar and the bottom nav share their keys on purpose: go(), closeMnav and the 900 px listener (events.js) fall back from the one that is
   hidden to the other. Any other control has its part of the page in its key. Without it, a link to Projects in the breadcrumb, the page or a
   menu would be found as the sidebar's, which comes first in the document, and the focus would restore into the sidebar. The project's page
   tabs are a part of their own: they are the same links as the sidebar's sub-list and as the buttons of the Overview ("View list"). */
const PARTS = ['.topbar', 'nav.tabs', '#main-content', '#layer'];
const LAYER = '#layer ';
/* The part of the page an element is in: one of PARTS (the first, as the page tabs are inside #main-content), or '' for the sidebar, the bottom nav
   and anything else outside them. */
const partOf = el => PARTS.find(p => el.closest(p)) || '';
/* The part a key stands for. A key made by focusKey() has its part in front (or none, for the sidebar's and the bottom nav's). null: not such a
   key (an id, a selector of the caller's own), which is not about a part. */
const keyPart = key => PARTS.find(p => key.startsWith(p + ' ')) ?? (/^[a-z][a-z0-9-]*\[data-/.test(key) ? '' : null);
export function focusKey(el) {
  if (!el || el === document.body || !el.tagName) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const d = el.dataset || {};
  const parts = FKEYS.filter(k => d[k] != null).map(k => `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${CSS.escape(d[k])}"]`);
  const part = partOf(el);
  return parts.length ? (part ? part + ' ' : '') + el.tagName.toLowerCase() + parts.join('') : null;
}
/* The elements a key finds again. A key made by focusKey() finds those in its own part of the page only, not what its selector would also match
   (the Overview's "View list" button has the page tab's data-*, but #main-content comes first in its key and the tab is in nav.tabs; the bottom
   nav's Projects has the Home page's stat card's, but its key has no part, and the card is in #main-content). A key without a part finds those
   outside every part: the sidebar and the bottom nav, which share keys. `any`: wherever they are, for a key that was cut down to this. Throws on
   a selector that is not valid. */
export function keyEls(key, any = false) {
  const els = [...document.querySelectorAll(key)];
  const part = any ? null : keyPart(key);
  return part == null ? els : els.filter(el => partOf(el) === part);
}
/* The key to give the focus back to when `el` has opened a surface. A control of a popover goes with it: the popover's opener is meant. */
export const openerKey = el => (el?.closest?.('[data-pop-root]') ? S.ui.popOpener : focusKey(el));
/* An opener found again once its surface has closed. One recorded in the layer (a dialog's button, an item of a popover) went with the surface,
   so its twin on the page is meant. Only here: for the control that has focus (below), a twin is the wrong one (the sidebar's, for a link). */
const tryOpener = key => tryFocus(key) || (!!key?.startsWith(LAYER) && tryFocus(key.slice(LAYER.length), true));
export function tryFocus(key, any = false) {
  if (!key) return false;
  let els;
  try {
    els = keyEls(key, any);
  } catch {
    return false;
  }
  // A key is not unique: the sidebar comes first in the page and shares its keys with the bottom nav, and on a phone its closed copy is
  // visibility:hidden, which offsetParent does not tell. So the first match that takes the focus is the one, not the first match.
  for (const el of els) {
    if (el.offsetParent === null) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return true;
  }
  return false;
}
export function pageTitle() {
  const u = S.ui;
  if (u.auth) return 'PM Space';
  let t = ROUTE_NAMES[u.route] || 'Not found';
  if (u.route === 'project' && proj(u.params.id)) t = `${(PTABS.find(x => x[0] === u.params.tab) || [0, 'Saved view'])[1]} · ${proj(u.params.id).name}`;
  if (u.route === 'member' && mem(u.params.id)) t = mem(u.params.id).name;
  if (u.route === 'team' && team(u.params.id)) t = team(u.params.id).name;
  return `${t} · ${D().ws.name}`;
}
/* Anything clickable is keyboard-reachable: non-native [data-a] controls get a role and a tab stop. The sidebar's project icon and the buttons
   that show on its row under the pointer (.hov) are not: the row around them is the control, and they are its mouse-only shortcuts (the arrow
   keys and the context-menu key do the same on the row). */
export function makeFocusable() {
  for (const el of document.querySelectorAll('[data-a]:not(button):not(a):not(input):not(label):not(select):not(textarea):not([tabindex])')) {
    if (el.matches('.scrim,.modal-wrap,.drawer-scrim,.side-scrim,.pico,.hov [data-a]')) continue;
    el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', el.dataset.a === 'go' ? 'link' : 'button');
  }
}
export function render() {
  applyPrefs();
  const prevOv = render._ov || {};
  const ov = { pop: !!S.ui.pop, modals: S.ui.modals.length, drawer: S.ui.drawer, pal: !!S.ui.palette, sub: !!S.ui.subOpen };
  // Entrances animate only on the render where the surface first appears.
  const fx = S.ui.fx || (S.ui.fx = {});
  if (ov.drawer && prevOv.drawer !== ov.drawer) fx.drawer = true;
  if (ov.modals > (prevOv.modals || 0)) fx.modal = ov.modals;
  const popSig = S.ui.pop ? [S.ui.pop.type, S.ui.pop.id, S.ui.pop.i, S.ui.pop.field, S.ui.pop.ctx, S.ui.pop.key].join('|') : '';
  if (popSig && popSig !== render._popSig) fx.pop = true;
  render._popSig = popSig;
  if (S.ui.sel.size && !render._selN) fx.bulk = true;
  render._selN = S.ui.sel.size;
  const authSig = S.ui.auth || '';
  if (authSig && authSig !== render._authSig) fx.auth = true;
  render._authSig = authSig;
  const a = document.activeElement;
  const fid = a && a.id;
  let s0 = null,
    s1 = null;
  const fkey = focusKey(a);
  // If the render drops that control (the rail's project icon), the control around it takes the focus.
  const fup = a && a.parentElement ? focusKey(a.parentElement.closest('[data-a]')) : null;
  try {
    s0 = a.selectionStart;
    s1 = a.selectionEnd;
  } catch {
    /* not supported here; safe to skip */
  }
  const keep = $$('[data-keep]').map(el => [el.dataset.keep, el.scrollTop, el.scrollLeft]);
  $('#app').innerHTML = S.ui.auth ? renderAuth() : renderShell();
  $('#layer').innerHTML = renderLayer();
  makeFocusable();
  keep.forEach(([k, t, l]) => {
    const el = document.querySelector(`[data-keep="${CSS.escape(k)}"]`);
    if (el) {
      el.scrollTop = t;
      el.scrollLeft = l;
    }
  });
  if (fid) {
    const el = document.getElementById(fid);
    if (el && el !== document.activeElement) {
      el.focus({ preventScroll: true });
      try {
        if (s0 != null) el.setSelectionRange(s0, s1);
      } catch {
        /* not supported here; safe to skip */
      }
    }
  }
  // Return focus to whatever opened a surface that just closed; otherwise keep the control that had it.
  const lost = () => !document.activeElement || document.activeElement === document.body;
  if (prevOv.modals > ov.modals) {
    const k = S.ui.modalOpeners.splice(ov.modals).shift();
    if (lost()) tryOpener(k);
  }
  if (prevOv.pop && !ov.pop && lost()) tryOpener(S.ui.popOpener);
  if (prevOv.drawer && !ov.drawer && lost()) tryOpener(S.ui.drawerOpener);
  if (prevOv.pal && !ov.pal && lost()) tryOpener(S.ui.palOpener);
  if (prevOv.sub && !ov.sub && lost()) tryFocus('.drawer .subt [data-sid="' + (S.ui.lastSub || '') + '"]');
  if (lost() && fkey) tryFocus(fkey);
  if (lost() && fup) tryFocus(fup);
  // A surface closed and its opener took no focus (a list row): the task panel below takes it, or the page, never <body>.
  const closed = prevOv.modals > ov.modals || (prevOv.pop && !ov.pop) || (prevOv.drawer && !ov.drawer) || (prevOv.pal && !ov.pal);
  if (closed && !ov.modals && lost()) ((ov.drawer && $('.drawer')) || $('#main-content'))?.focus({ preventScroll: true });
  render._ov = ov;
  const played = S.ui.fx;
  S.ui.fx = {};
  if (played.route && !reduceMotion()) countUp();
  const title = pageTitle();
  if (document.title !== title) {
    document.title = title;
    const live = document.getElementById('sr-live');
    if (live && !S.ui.loading) live.textContent = title.split(' · ').slice(0, -1).join(', ');
  }
  afterRender();
}
export function afterRender() {
  selectMenu.close();
  enhanceSelects();
  placePop();
  $$('textarea[data-autosize]').forEach(autosize);
  const pal = $('#pal-in');
  if (pal && document.activeElement !== pal && !S.ui.pop) pal.focus();
  if ((S.ui.route === 'project' && S.ui.params.tab === 'timeline') || S.ui.route === 'timeline') tlAfter();
  projTableAfter();
  syncRailTip();
}
/* Headline numbers count up once when a dashboard is entered. */
export function countUp() {
  for (const el of document.querySelectorAll('.fx-route .stat .v')) {
    const m = el.textContent.match(/^(\d+)(%?)$/);
    if (!m) continue;
    const to = +m[1],
      suf = m[2];
    if (to < 2) continue;
    const t0 = performance.now(),
      dur = 520;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      if (!el.isConnected) return;
      el.textContent = Math.round(to * e) + suf;
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = '0' + suf;
    requestAnimationFrame(step);
  }
}
export function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
