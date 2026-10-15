/* =====================================================================
   ACTIONS · PROJECT TEMPLATE: save a project as one, edit, delete
   Starting a project from one is createProject() in actions.js.
   ===================================================================== */
import { $, TODAY, diffD, parse, uid } from '../core/utils.js';
import { TEMPLATE_NAME_MAX as NAME_MAX } from '../core/constants.js';
import { D, S, canManageTemplates, proj, tasksOf, templatesOf, tmpl } from '../core/store.js';
import { latest, mutate, toast } from '../ui/toast.js';
import { go, render } from '../shell/render.js';
import { sortTasks } from '../shell/view-engine.js';
import { openModal } from '../overlays/modals.js';
import { A, IN, confirmDlg, isTop, needWorkspace } from './actions.js';

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const tasksText = n => `${n} task${n === 1 ? '' : 's'}`;

/* The server refuses anyone else, but a member who got here (a stale menu, a keyboard shortcut) should hear why. */
function mayManage() {
  if (canManageTemplates()) return true;
  toast('Only admins and managers can change templates.', { kind: 'err' });
  return false;
}
const nameError = name => (!name ? 'Give the template a name' : name.length > NAME_MAX ? `Template names can be up to ${NAME_MAX} characters` : '');

/* What a template keeps of a project's tasks, in the order the project's list shows them (manual order, within each group). Status:
   backlog stays, everything else becomes todo, since a new project has not started anything. Dates become whole days from the
   project's start. Left out: assignees, dependencies, attachments, comments, recurrence. Everything is written in the form
   normalize.js yields for it, or the template would differ from its baseline for ever and be sent again and again. */
export function templateTasks(p) {
  const from = parse(p.start) || TODAY; // a project without a start counts from today
  const off = d => (d ? diffD(parse(d), from) : null);
  return sortTasks(tasksOf(p.id), { f: 'manual', dir: 1 }).map(t => ({
    title: t.title,
    status: t.status === 'backlog' ? 'backlog' : 'todo',
    priority: t.priority || 'none',
    estimate: t.estimate || null,
    desc: t.desc || '',
    labels: [...t.labels],
    subtasks: t.subtasks.map(s => ({ title: s.title })),
    startOff: off(t.start),
    dueOff: off(t.due),
  }));
}

/* ---------- save a project as a template ---------- */
A.saveAsTemplate = el => {
  const id = el.dataset.id;
  S.ui.pop = null;
  const p = proj(id);
  if (!p || !mayManage()) return;
  openModal({
    type: 'prompt',
    title: 'Save as template',
    sub: "New projects can start from it with this project's tasks, without assignees or comments.",
    label: 'Template name',
    value: p.name.slice(0, NAME_MAX),
    ok: 'Save template',
    max: NAME_MAX,
    run: name => saveTemplate(id, name),
  });
};
/* `name` is trimmed by the prompt. A template of that name (any case) is replaced, after asking. */
function saveTemplate(pid, name) {
  if (!mayManage()) return;
  const err = nameError(name);
  if (err) {
    toast(err, { kind: 'err' });
    return;
  }
  const p = proj(pid);
  if (!p || needWorkspace()) return;
  const old = templatesOf(D().ws.id).find(t => sameName(t.name, name));
  if (!old) {
    writeTemplate(pid, name, '');
    return;
  }
  const oldId = old.id;
  confirmDlg({
    title: `Replace template ‘${old.name}’?`,
    body: `Its <b>${tasksText(old.tasks.length)}</b> will be replaced with this project's <b>${tasksText(templateTasks(p).length)}</b>.`,
    ok: 'Replace template',
    icon: 'layers',
    run: () => writeTemplate(pid, name, oldId),
  });
}
function writeTemplate(pid, name, replaceId) {
  let n = 0;
  mutate(
    () => {
      const p = proj(pid); // by id: sync or Undo can replace the project while a refused save waits for "Try again"
      const tasks = templateTasks(p);
      n = tasks.length;
      const fields = { name, icon: p.icon, color: p.color, tasks, updated: Date.now() };
      const old = replaceId && tmpl(replaceId);
      if (old)
        Object.assign(old, fields); // keeps its id and description
      else D().templates.push({ id: uid('tm'), workspace: D().ws.id, desc: '', ...fields });
    },
    () => toast(`Saved template ‘${name}’ (${tasksText(n)})`, { action: 'View', onAction: () => go('settings', { sec: 'templates' }) }),
    () => !!proj(pid) && (!replaceId || !!tmpl(replaceId)),
  );
}

/* ---------- edit (name and description) ---------- */
A.editTemplate = el => {
  const t = tmpl(el.dataset.id);
  if (!t || !mayManage()) return;
  S.ui.errors = {};
  S.ui.tpform = { name: t.name, desc: t.desc };
  openModal({ type: 'template', edit: t.id });
};
IN.tpform = el => {
  S.ui.tpform[el.dataset.f] = el.value;
  if (el.dataset.f === 'name' && S.ui.errors.tpname && el.value.trim()) {
    S.ui.errors.tpname = null;
    render();
  }
};
A.submitTemplate = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.tpform;
  f.name = ($('#tp-name')?.value || '').trim();
  f.desc = ($('#tp-desc')?.value || '').trim();
  if (!mayManage()) return;
  const err =
    nameError(f.name) || (templatesOf(D().ws.id).some(t => t.id !== m.edit && sameName(t.name, f.name)) ? `A template called “${f.name}” already exists` : '');
  if (err) {
    S.ui.errors.tpname = err;
    render();
    $('#tp-name')?.focus();
    return;
  }
  // what was validated: the form stays editable after a refusal, so "Try again" must not read it again
  const v = { name: f.name, desc: f.desc };
  const id = m.edit;
  const fresh = latest(m);
  mutate(
    () => {
      const t = tmpl(id); // by id: sync or Undo can replace the template while a refused edit waits for "Try again"
      if (t) Object.assign(t, { name: v.name, desc: v.desc, updated: Date.now() });
    },
    () => {
      S.ui.modals.pop();
      render();
      toast(`Saved template ‘${v.name}’`);
    },
    () => isTop(m) && fresh() && !!tmpl(id),
  );
};

/* ---------- delete ---------- */
A.delTemplate = el => {
  const t = tmpl(el.dataset.id);
  if (!t || !mayManage()) return;
  const { id, name } = t;
  confirmDlg({
    title: `Delete template ‘${name}’?`,
    body: 'Projects made from it keep their tasks.',
    ok: 'Delete template',
    danger: true,
    run: () => {
      mutate(
        () => {
          D().templates = D().templates.filter(x => x.id !== id); // by id: sync can replace the template while a refused delete waits for "Try again"
        },
        () => toast(`Deleted template ‘${name}’`),
        () => !!tmpl(id),
      );
    },
  });
};
