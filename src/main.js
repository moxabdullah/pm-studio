/* =====================================================================
   ENTRY: styles, then every module in dependency order (several register
   global listeners or add handlers to the action table when they load), then boot.
   ===================================================================== */
import './styles/index.css';
import './core/utils.js';
import './core/icons.js';
import './core/constants.js';
import './core/store.js';
import './ui/helpers.js';
import './core/theme.js';
import './ui/toast.js';
import './ui/select.js';
import './shell/render.js';
import './shell/layout.js';
import './shell/skeletons.js';
import './shell/view-engine.js';
import './components/task-list.js';
import './pages/home.js';
import './pages/overview.js';
import './pages/my-tasks.js';
import './pages/tasks.js';
import './pages/inbox.js';
import './pages/notifications.js';
import './pages/favorites.js';
import './pages/projects.js';
import './pages/members.js';
import './pages/activity.js';
import './pages/search.js';
import './pages/errors.js';
import './pages/project.js';
import './views/project-overview.js';
import './views/board.js';
import './views/table.js';
import './views/calendar.js';
import './views/timeline.js';
import './views/files.js';
import './overlays/drawer.js';
import './overlays/modals.js';
import './overlays/popovers.js';
import './overlays/context-menu.js';
import './overlays/palette.js';
import './pages/settings.js';
import './pages/auth.js';
import './pages/design-system.js';
import './actions/actions.js';
import './actions/events.js';
import './actions/keyboard.js';
import './actions/drag-drop.js';
import './features/teams.js';
import './features/subtasks.js';
import './features/archive.js';
import './actions/teams.js';
import './actions/subtasks.js';
import './actions/archive.js';
import { S, D } from './core/store.js';
import { pb } from './core/pb.js';
import * as sync from './core/sync.js';
import { A, showLogin } from './actions/actions.js';
import { openLink } from './actions/links.js';
import { ROUTE_NAMES, render, go } from './shell/render.js';
import { remoteRender } from './shell/remote-render.js';
import { toast } from './ui/toast.js';

/* Boot. The app's data comes from the server, so what happens first depends on whether there is a stored session:
   none -> the sign-in page; one -> the shell with skeletons while the session is refreshed and the data loads, then the page. */
(async function init() {
  document.documentElement.lang = 'en';
  if (!document.getElementById('sr-live')) {
    const l = document.createElement('div');
    l.id = 'sr-live';
    l.className = 'sr';
    l.setAttribute('aria-live', 'polite');
    document.body.appendChild(l);
  }
  try {
    localStorage.removeItem('gr8r.v2'); // the browser-only demo data of earlier versions
  } catch {
    /* storage blocked: nothing was kept there */
  }
  sync.bindSync({ render: remoteRender, toast, loggedOut: showLogin });
  if (!pb.authStore.isValid) {
    S.ui.auth = 'login';
    render();
    return;
  }
  const h = (location.hash || '').slice(1);
  const route = () => {
    S.ui.route = h && ROUTE_NAMES[h] ? h : S.prefs.home || 'home';
  };
  S.ui.loading = true;
  route();
  render();
  try {
    await sync.startSync({ boot: true });
  } catch (err) {
    if (err.cancelled) return;
    pb.authStore.clear();
    showLogin([401, 403].includes(err.status) ? 'Your session expired. Sign in again.' : `Couldn't load your data: ${err.response?.message || err.message}`);
    return;
  }
  S.ui.loading = false;
  route(); // the saved home page is known now
  if (!openLink()) render(); // a link such as #/task/<id> goes straight to what it names (it draws the page itself)
})();

// Dev-only handle for debugging and screenshot tooling; stripped from production builds.
if (import.meta.env.DEV) window.__gr8r = { S, D, A, go, render, sync, pb };
