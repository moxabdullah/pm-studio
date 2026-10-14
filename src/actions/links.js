/* =====================================================================
   LINKS: copy a link to a task, project or file, and open the one somebody sent.
   The app lives at one address, this server's, and what comes after the # says what to open:
     #/task/<id>             the task's project on its board, with the task open in the side panel
     #/project/<id>          the project, on the person's usual tab
     #/project/<id>/<tab>    the project on one tab (overview, board, list, table, calendar, timeline, files, activity)
   The ids are the records' real ids, never the keys: a key such as WEB-201 changes when a task moves to another project, and a link
   must keep working. Whatever the address names has to be something this person can read, because the server only sends them what they
   may see; anything else (an id that never existed, one that was deleted, a private project they are not on) is the not-found page.
   Pages such as #inbox keep working too: main.js reads them at boot, and this module on every later change of the address.
   ===================================================================== */
import { D, S, proj, task } from '../core/store.js';
import { toast } from '../ui/toast.js';
import { ROUTE_NAMES, go, render } from '../shell/render.js';
import { PTABS } from '../pages/project.js';
import { A, copy, setWorkspace } from './actions.js';

const TABS = new Set(PTABS.map(t => t[0]));
const base = () => location.origin + location.pathname;

/* ---------- making links ---------- */
export const taskLink = id => `${base()}#/task/${encodeURIComponent(id)}`;
export const projectLink = (id, tab = '') => `${base()}#/project/${encodeURIComponent(id)}${tab ? '/' + encodeURIComponent(tab) : ''}`;

/* "Copy link" buttons say what they mean with data-id (a task or a project: whichever the id belongs to), data-pid (a project) or
   data-fid (a file). The right-click menu only knows the id of what was clicked, and its kind from S.ui.pop. A file has no address of
   its own: its link opens the Files tab of its project. */
A.copyLink = el => {
  const d = el.dataset;
  const kind = S.ui.pop?.ctx;
  S.ui.pop = null;
  render();
  const file = id => D().files.find(f => f.id === id);
  let link = '';
  if (d.fid) link = file(d.fid) ? projectLink(file(d.fid).project, 'files') : '';
  else if (d.pid) link = proj(d.pid) ? projectLink(d.pid) : '';
  else if (d.id) {
    if (kind === 'file' && file(d.id)) link = projectLink(file(d.id).project, 'files');
    else if (task(d.id)) link = taskLink(d.id);
    else if (proj(d.id)) link = projectLink(d.id);
    else if (file(d.id)) link = projectLink(file(d.id).project, 'files');
  }
  if (!link) {
    toast("Couldn't make a link: that is no longer available.", { kind: 'err' });
    return;
  }
  copy(link);
};

/* ---------- opening links ---------- */
function parse(hash) {
  const m = /^#\/?(task|project)\/([^/?#]+)(?:\/([^/?#]+))?\/?$/.exec(hash || '');
  if (!m) return null;
  try {
    return { kind: m[1], id: decodeURIComponent(m[2]), tab: m[3] ? decodeURIComponent(m[3]) : '' };
  } catch {
    return { kind: m[1], id: '', tab: '' }; // a broken %-escape names nothing
  }
}
function notFound() {
  S.ui.drawer = null;
  S.ui.drawerFull = false;
  go('notfound'); // not a page: the router answers an unknown name with the not-found page
}
/* A link to something in another workspace opens in that workspace, so the sidebar shows where the person is. */
function inItsWorkspace(p) {
  const w = p.workspace && p.workspace !== D().ws.id && D().workspaces.find(x => x.id === p.workspace);
  if (w) setWorkspace(w);
}
/* Opens what the address names, if it names something. Returns true when it did (the page is already drawn), false for any other
   address. Call it once the data has loaded. The address is cleared first, so a reload does not repeat it and the same link can be
   followed again. */
export function openLink() {
  const link = parse(location.hash);
  if (!link) return false;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* the address cannot be rewritten here: the link opens anyway */
  }
  if (link.kind === 'task') {
    const t = task(link.id);
    const p = t && proj(t.project);
    if (!p) {
      notFound();
      return true;
    }
    inItsWorkspace(p);
    go('project', { id: p.id, tab: 'board' });
    A.openTask({ dataset: { id: t.id } });
    return true;
  }
  const p = proj(link.id);
  if (!p) {
    notFound();
    return true;
  }
  inItsWorkspace(p);
  go('project', { id: p.id, tab: TABS.has(link.tab) ? link.tab : S.prefs.defaultTab || 'board' });
  return true;
}
A.openLink = openLink;

/* While signed out or loading there is nothing to open yet: boot and sign-in call openLink() when the data is there. */
addEventListener('hashchange', () => {
  if (S.ui.auth || S.ui.loading || !D().me) return;
  if (openLink()) return;
  const page = location.hash.slice(1);
  if (page && ROUTE_NAMES[page]) go(page);
});
