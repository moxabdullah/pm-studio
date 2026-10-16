/* =====================================================================
   ACTIONS · LABELS: edit the workspace's task labels (Settings > Labels)
   One dialog edits the whole list: a name and a colour for each label, in order. The list is saved in the workspace's workspace_lists
   record (the first save makes it); until then the workspace has the built-in labels (store.js labelsOf). A task's own labels are
   toggled in the picker (popovers.js, A.popToggleLabel).
   ===================================================================== */
import { $, uid } from '../core/utils.js';
import { LABELS_MAX, LABEL_NAME_MAX, STAGE_COLORS } from '../core/constants.js';
import { D, S, canManageLabels, labelsOf, listsOf, proj } from '../core/store.js';
import { latest, mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { openModal } from '../overlays/modals.js';
import { A, IN, confirmDlg, isTop, needWorkspace } from './actions.js';

const COLORS = Object.keys(STAGE_COLORS);
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/* A label as normalize.js yields it (exactly these three keys, the name trimmed): the form's rows and the list saved here are copies. */
const labelCopy = l => ({ id: l.id, name: l.name.trim(), color: COLORS.includes(l.color) ? l.color : 'gray' });
const capText = `A workspace can have up to ${LABELS_MAX} labels`;
/* After a render that shows a refusal in the editor: the message may be below the fold of the dialog's body. */
const reveal = () => $('#lb-row-err, #lb-list-err')?.scrollIntoView({ block: 'nearest' });
/* The error under the row `row` of the editor, or under the list when `row` is -1 (S.ui.errors.lblist and .lbrow, as the stage editor). */
const refuse = (msg, row = -1) => {
  S.ui.errors.lblist = msg;
  S.ui.errors.lbrow = msg ? row : -1;
};

/* The server refuses anyone else, but a member who got here (a stale menu, a keyboard shortcut) should hear why. */
function mayManage() {
  if (canManageLabels()) return true;
  toast('Only admins and managers can change labels.', { kind: 'err' });
  return false;
}

/* ---------- the editor ---------- */
/* The form is S.ui.lbform: the rows as typed (so a re-render, a move or a live change from the server keeps them), the workspace the
   dialog was opened in, and `was`, a Map of each saved label's name when it opened: a name clash is refused only on a row that was added
   or renamed since (a list that already clashes stays editable, or it could never be fixed). */
A.editLabels = () => {
  if (!mayManage() || needWorkspace()) return;
  const ws = D().ws.id;
  const list = labelsOf(ws);
  S.ui.errors = {};
  S.ui.lbform = { ws, labels: list.map(labelCopy), was: new Map(list.map(l => [l.id, l.name.trim()])) };
  openModal({ type: 'labels', edit: listsOf(ws)?.id });
};
IN.lbRow = el => {
  const l = S.ui.lbform.labels[+el.dataset.i];
  if (!l) return;
  if (el.dataset.f === 'color') {
    // only the swatch changes: no re-render, so the focus stays on the color control (a message about the names is still true)
    l.color = COLORS.includes(el.value) ? el.value : 'gray';
    el.closest('[role="group"]')?.querySelector('.pdot')?.style.setProperty('--c', STAGE_COLORS[l.color]);
    return;
  }
  l.name = el.value;
  // a message about the labels is out of date once one is changed
  if (S.ui.errors.lblist) {
    refuse('');
    render();
  }
};
/* Move and Remove re-render the dialog, and focus goes where the person is working: a moved label keeps its button (the other one when
   it reached an end), a removed one hands focus to the label that took its place, or to Add label. */
A.lbMove = el => {
  const labels = S.ui.lbform.labels;
  const i = +el.dataset.i;
  const v = el.dataset.v;
  const j = v === 'up' ? i - 1 : i + 1;
  if (!labels[i] || !labels[j]) return;
  [labels[i], labels[j]] = [labels[j], labels[i]];
  refuse('');
  render();
  const btn = d => $(`[data-a="lbMove"][data-i="${j}"][data-v="${d}"]:not([disabled])`);
  const to = btn(v) || btn(v === 'up' ? 'down' : 'up');
  to?.focus({ preventScroll: true });
  to?.scrollIntoView({ block: 'nearest' }); // a label moved far (a long list) keeps its button in view
};
A.lbRemove = el => {
  const labels = S.ui.lbform.labels;
  const i = +el.dataset.i;
  if (!labels[i]) return;
  labels.splice(i, 1);
  refuse('');
  render();
  ($(`#lb-name-${i}`) || $('[data-a="lbAdd"]:not([disabled])') || $('[data-a="submitLabels"]'))?.focus({ preventScroll: true });
};
A.lbAdd = () => {
  const labels = S.ui.lbform.labels;
  if (labels.length >= LABELS_MAX) return; // (the button is disabled, with a note)
  labels.push({ id: uid(), name: '', color: 'gray' });
  refuse('');
  render();
  setTimeout(() => $(`#lb-name-${labels.length - 1}`)?.focus(), 0);
};

/* ---------- save ---------- */
/* Why the rows cannot be saved, as [message, row] (row -1: about the list), or null. */
function problem(f, labels) {
  if (labels.length > LABELS_MAX) return [capText, -1];
  for (const [i, l] of labels.entries()) {
    if (!l.name) return ['Every label needs a name', i];
    if (l.name.length > LABEL_NAME_MAX) return [`Label names can be up to ${LABEL_NAME_MAX} characters`, i];
    const touched = f.was.get(l.id) !== l.name; // added here (no saved name) or renamed
    if (touched && labels.some((x, j) => j !== i && sameName(x.name, l.name))) return [`There is more than one label called “${l.name}”`, i];
  }
  return null;
}
A.submitLabels = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.lbform;
  if (!mayManage()) return;
  const labels = f.labels.map(labelCopy);
  const why = problem(f, labels);
  if (why) {
    refuse(...why);
    render();
    $(why[1] >= 0 ? `#lb-name-${why[1]}` : '[data-a="lbAdd"]')?.focus();
    reveal();
    return;
  }
  // Labels the list has now and this one lacks go from every task of the workspace that carries them. Counted over the tasks that are
  // loaded: a private project the person cannot open is not.
  const keep = new Set(labels.map(l => l.id));
  const gone = new Set(
    labelsOf(f.ws)
      .filter(l => !keep.has(l.id))
      .map(l => l.id),
  );
  const used = new Set();
  let tasks = 0;
  for (const t of D().tasks) {
    if (t.archived || proj(t.project)?.workspace !== f.ws) continue;
    const had = t.labels.filter(id => gone.has(id));
    if (!had.length) continue;
    tasks++;
    had.forEach(id => used.add(id));
  }
  if (!tasks) {
    saveLabels(m, f.ws, labels);
    return;
  }
  // (Cancel pops this question and leaves the editor as it was)
  confirmDlg({
    wlId: listsOf(f.ws)?.id, // so a live deletion of the list closes this question (forgetUi in sync.js)
    title: `Remove ${plural(used.size, 'label')} used on ${plural(tasks, 'task')}?`,
    body: `${tasks === 1 ? 'That task loses it' : 'Those tasks lose them'}. Private projects you can't see aren't counted.`,
    ok: used.size === 1 ? 'Remove label' : 'Remove labels',
    danger: true,
    run: () => saveLabels(m, f.ws, labels),
  });
};
/* What was validated is saved: the form stays editable after a refusal, so "Try again" must not read it again. The record is looked up
   again in the edit, since another admin may have saved the first list while the dialog was open (then it is updated, not made twice),
   and only `labels` is written, so the other lists in its doc (and anything not sent yet) stay as they are. */
function saveLabels(m, ws, labels) {
  const fresh = latest(m);
  mutate(
    () => {
      const rec = listsOf(ws);
      if (rec) Object.assign(rec, { labels: labels.map(labelCopy) });
      else (D().workspaceLists ||= []).push({ id: uid(), workspace: ws, labels: labels.map(labelCopy) });
    },
    () => {
      S.ui.modals.pop();
      render();
      toast('Saved labels');
    },
    () => isTop(m) && fresh(),
  );
}
