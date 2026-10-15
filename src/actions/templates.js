/* =====================================================================
   ACTIONS · PROJECT TEMPLATE: save a project as one, edit, delete
   Starting a project from one is createProject() in actions.js.
   ===================================================================== */
import { $, TODAY, diffD, parse, uid } from '../core/utils.js';
import {
  TEMPLATE_BYTES_MAX,
  TEMPLATE_DESC_MAX as DESC_MAX,
  TEMPLATE_NAME_MAX as NAME_MAX,
  TEMPLATE_SUBTASKS_MAX,
  TEMPLATE_TASKS_MAX,
} from '../core/constants.js';
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
/* Why a project cannot be saved as a template, or '': it has no tasks to copy, more than a template holds (archived tasks are not
   copied), or a template too long for the server to take. The size is that of the doc the save would write; `desc` is the description
   the template will keep: the one of the template being replaced, none for a new one. */
function tasksError(p, desc = '') {
  const n = tasksOf(p.id).length;
  if (!n) return 'This project has no tasks to save.';
  if (n > TEMPLATE_TASKS_MAX) return `Templates can hold up to ${TEMPLATE_TASKS_MAX} tasks; this project has ${n}.`;
  const doc = { icon: p.icon, color: p.color, desc, tasks: templateTasks(p), updated: Date.now() };
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  return bytes > TEMPLATE_BYTES_MAX ? 'These tasks are too long for a template. Shorten their descriptions and try again.' : '';
}

/* What a template keeps of a project's tasks, in the order the project's list shows them (manual order, within each group). Status:
   backlog stays, everything else becomes todo, since a new project has not started anything. Dates become whole days from the
   project's start. Left out: assignees, dependencies, attachments, comments, recurrence; and the subtasks beyond the first
   TEMPLATE_SUBTASKS_MAX of a task. Everything is written in the form normalize.js yields for it (it cuts a template to the same
   limits), or the template would differ from its baseline for ever and be sent again and again. */
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
    subtasks: t.subtasks.slice(0, TEMPLATE_SUBTASKS_MAX).map(s => ({ title: s.title })),
    startOff: off(t.start),
    dueOff: off(t.due),
  }));
}

/* ---------- save a project as a template ---------- */
const WHAT_IS_COPIED =
  "Copies this project's tasks to start new projects. Tasks start as To do (Backlog stays Backlog); dates count from the project's start. Not copied: assignees, dependencies, comments, files, recurrence. Everyone can see templates.";
/* Templates are read by every signed-in user, whoever can open the project they came from. */
const PRIVATE_WARNING = 'This project is private. Everyone will be able to see the template, including its task titles and descriptions.';
A.saveAsTemplate = el => {
  const id = el.dataset.id;
  S.ui.pop = null;
  const p = proj(id);
  if (!p || !mayManage()) return;
  openModal({
    type: 'prompt',
    title: 'Save as template',
    sub: p.private ? `${PRIVATE_WARNING} ${WHAT_IS_COPIED}` : WHAT_IS_COPIED,
    label: 'Template name',
    value: p.name.slice(0, NAME_MAX),
    ok: 'Save template',
    max: NAME_MAX,
    validate: name => {
      const p = proj(id);
      // the description the template will keep, when this replaces one: it counts towards the size
      return nameError(name) || (p ? tasksError(p, templatesOf(p.workspace).find(t => sameName(t.name, name))?.desc) : 'That project is gone.');
    },
    run: name => saveTemplate(id, name),
  });
};
/* `name` is trimmed and checked by the prompt (validate above). A template of that name (any case) in the project's workspace is
   replaced, after asking. */
function saveTemplate(pid, name) {
  if (!mayManage()) return;
  const p = proj(pid);
  if (!p || needWorkspace()) return;
  const old = templatesOf(p.workspace).find(t => sameName(t.name, name));
  if (!old) {
    writeTemplate(pid, name, '');
    return;
  }
  const oldId = old.id;
  confirmDlg({
    title: `Replace template ‘${old.name}’?`,
    body: `Its <b>${tasksText(old.tasks.length)}</b> will be replaced with this project's <b>${tasksText(tasksOf(p.id).length)}</b>.`,
    ok: 'Replace template',
    icon: 'layers',
    run: () => {
      if (!proj(pid)) {
        toast('That project is gone.', { kind: 'err' }); // deleted while the question was open
        return;
      }
      writeTemplate(pid, name, oldId);
    },
  });
}
function writeTemplate(pid, name, replaceId) {
  let saved = null; // the template as written
  let why = ''; // when nothing was written, the reason
  // No `still`: "Try again" runs all of this again, which says so when the project is gone and makes a new template when the one to be
  // replaced is gone.
  mutate(
    () => {
      saved = null;
      const p = proj(pid); // by id: sync or Undo can replace the project while a refused save waits for "Try again"
      if (!p) {
        why = 'That project is gone.';
        return;
      }
      // The replaced template keeps its id, its description and its name (as the question named it: ‘Weekly’ stays ‘Weekly’ when the
      // project was saved as “weekly”). One of that name that appeared after the name was checked (another admin saved it, or the one
      // being replaced was deleted and another took its name) is not replaced without asking: the save stops and says so, and "Save
      // again" asks.
      const clash = templatesOf(p.workspace).find(t => t.id !== replaceId && sameName(t.name, name));
      const old = replaceId ? tmpl(replaceId) : null; // gone (deleted while the question was open, or while a refused save waited for "Try again"): a new template is made instead
      // (the project's tasks may have changed since the name was checked)
      why = clash ? `A template called ‘${clash.name}’ was saved meanwhile. Save again to replace it.` : tasksError(p, old?.desc);
      if (why) return;
      const fields = { icon: p.icon, color: p.color, tasks: templateTasks(p), updated: Date.now() };
      if (old) Object.assign((saved = old), fields);
      else D().templates.push((saved = { id: uid('tm'), workspace: p.workspace, name, desc: '', ...fields }));
    },
    () => {
      if (!saved) toast(why, { kind: 'err' });
      else toast(`Saved template ‘${saved.name}’ (${tasksText(saved.tasks.length)})`, { action: 'View', onAction: () => go('settings', { sec: 'templates' }) });
    },
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
  if (el.dataset.f === 'desc' && S.ui.errors.tpdesc && el.value.length <= DESC_MAX) {
    S.ui.errors.tpdesc = null;
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
    nameError(f.name) ||
    (templatesOf(tmpl(m.edit)?.workspace).some(t => t.id !== m.edit && sameName(t.name, f.name)) ? `A template called “${f.name}” already exists` : '');
  // (the edit dialog stops typing at the limit, but a description written through the API can be longer already)
  const descErr = f.desc.length > DESC_MAX ? `Descriptions can be up to ${DESC_MAX} characters` : '';
  if (err || descErr) {
    S.ui.errors.tpname = err;
    S.ui.errors.tpdesc = descErr;
    render();
    $(err ? '#tp-name' : '#tp-desc')?.focus();
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
    tmplId: id, // so a live deletion of the template closes this question (forgetUi in sync.js)
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
