/* =====================================================================
   ACTIONS · TEAMS: create, edit, delete
   ===================================================================== */
import { $, uid } from '../core/utils.js';
import { PCOLORS } from '../core/constants.js';
import { D, S, allTeams, isAdmin, mem, team, teamsList } from '../core/store.js';
import { latest, mutate, toast } from '../ui/toast.js';
import { go, render } from '../shell/render.js';
import { openModal } from '../overlays/modals.js';
import { A, IN, confirmDlg, isTop, needWorkspace, restore, snapshot } from './actions.js';

A.newTeam = () => {
  if (needWorkspace(A.newTeam)) return;
  S.ui.pop = null;
  S.ui.errors = {};
  S.ui.tform = { name: '', desc: '', icon: 'users', color: 'teal', members: [] };
  openModal({ type: 'team' });
};
A.editTeam = el => {
  const t = team(el.dataset.id);
  if (!t) return;
  S.ui.pop = null;
  S.ui.errors = {};
  S.ui.tform = {
    name: t.name,
    desc: t.desc,
    icon: t.icon,
    color: Object.keys(PCOLORS).find(k => PCOLORS[k] === t.c) || 'slate',
    members: D()
      .members.filter(m => m.team === t.id)
      .map(m => m.id),
  };
  openModal({ type: 'team', edit: t.id });
};
IN.tform = el => {
  S.ui.tform[el.dataset.f] = el.value;
  if (el.dataset.f === 'name' && S.ui.errors.tname && el.value.trim()) {
    S.ui.errors.tname = null;
    render();
  }
};
A.tformSet = el => {
  S.ui.tform[el.dataset.f] = el.dataset.v;
  render();
};
/* Who is on a team is a field of each person's own account, so only an admin can change it (the server refuses anyone else; the dialog
   does not offer it to them). */
A.tformMember = el => {
  if (!isAdmin()) return;
  const l = S.ui.tform.members;
  const id = el.dataset.id;
  S.ui.tform.members = l.includes(id) ? l.filter(x => x !== id) : [...l, id];
  render();
};
A.submitTeam = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.tform;
  f.name = ($('#tm-name')?.value || '').trim();
  f.desc = ($('#tm-desc')?.value || '').trim();
  if (!f.name) {
    S.ui.errors.tname = 'Give the team a name';
    render();
    $('#tm-name')?.focus();
    return;
  }
  if (teamsList().some(t => t.name.toLowerCase() === f.name.toLowerCase() && t.id !== m.edit)) {
    S.ui.errors.tname = `A team called “${f.name}” already exists`;
    render();
    $('#tm-name')?.focus();
    return;
  }
  if (!m.edit && needWorkspace()) return; // the workspace went away while the form was open
  const admin = isAdmin();
  const fresh = latest(m);
  let t;
  mutate(
    () => {
      if (m.edit) {
        t = team(m.edit);
        Object.assign(t, { name: f.name, desc: f.desc, icon: f.icon, c: PCOLORS[f.color] });
        if (admin)
          D().members.forEach(x => {
            if (x.team === t.id && !f.members.includes(x.id)) x.team = '';
          });
      } else {
        t = { id: uid('tm'), workspace: D().ws.id, name: f.name, desc: f.desc || 'No description yet.', icon: f.icon, c: PCOLORS[f.color] };
        allTeams().push(t);
      }
      if (admin)
        f.members.forEach(id => {
          const x = mem(id);
          if (x) x.team = t.id;
        });
    },
    () => {
      // in mutate's `done`, so "Try again" after an offline refusal also closes the form (which the `still` below keeps from being saved twice)
      S.ui.modals.pop();
      if (m.edit) {
        render();
        toast(`Saved ${t.name}`);
      } else {
        go('team', { id: t.id });
        toast(`Created ${t.name}`);
      }
    },
    () => isTop(m) && fresh(),
  );
};
/* Deleting a team also clears it from each member's own account (their `team` field), which only an admin can write, so only an admin
   can delete one; anyone else would leave those accounts pointing at a team that is gone. */
A.delTeam = el => {
  if (!isAdmin()) {
    toast('Only admins can delete a team.', { kind: 'err' });
    return;
  }
  const t = team(el.dataset.id);
  const n = D().members.filter(x => x.team === t.id).length;
  const np = D().projects.filter(p => p.team === t.id).length;
  S.ui.modals.pop();
  confirmDlg({
    title: `Delete ${t.name}?`,
    body: `${n ? `<b>${n} member${n > 1 ? 's' : ''}</b> will have no team` : 'The team has no members'}${np ? ` and <b>${np} project${np > 1 ? 's' : ''}</b> will need a new team` : ''}. People and projects are not deleted.`,
    ok: 'Delete team',
    danger: true,
    icon: 'users',
    run: () => {
      const snap = snapshot();
      if (
        mutate(() => {
          D().teams = allTeams().filter(x => x !== t);
          D().members.forEach(x => {
            if (x.team === t.id) x.team = '';
          });
          D().projects.forEach(p => {
            if (p.team === t.id) p.team = '';
          });
        })
      ) {
        if (S.ui.route === 'team') go('teams');
        toast(`Deleted ${t.name}`, { action: 'Undo', onAction: () => restore(snap) });
      }
    },
  });
};
