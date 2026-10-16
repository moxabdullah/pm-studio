/* =====================================================================
   ACTIONS · FIELDS: edit the workspace's project fields (Settings > Project fields)
   One dialog edits one field (a name, a type, a dropdown's options, whether the Projects table has a column for it); Move and Delete
   are buttons of the list. The list is saved in the workspace's workspace_lists record (the first save makes it, with the built-in fields
   copied in); until then the workspace has the built-in fields (store.js fieldsOf). A project's own values are filled in on its form
   (actions.js, A.submitProject).
   Every write is applied to the list as it is when it runs, by field id, and writes only `fields`: another admin may have saved
   meanwhile, and the record's other lists (and anything unsent) stay as they are.
   ===================================================================== */
import { $, uid } from '../core/utils.js';
import { FIELDS_MAX, FIELD_NAME_MAX, FIELD_OPTIONS_MAX, FIELD_OPTION_MAX, FIELD_TYPES } from '../core/constants.js';
import { D, S, canManageFields, canSee, fieldsOf, listsOf } from '../core/store.js';
import { latest, mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { fdOptName, fdOptTitle, openModal } from '../overlays/modals.js';
import { A, IN, confirmDlg, isTop, needWorkspace } from './actions.js';

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/* A field as normalize.js yields it (exactly these keys, names trimmed, `options` only on a dropdown): the form's copy and the list saved
   here are copies of it, so the frozen built-in fields are never put in a record. */
const fieldCopy = f => ({
  id: f.id,
  name: f.name.trim(),
  type: f.type,
  inTable: !!f.inTable,
  ...(f.type === 'select' ? { options: (f.options || []).map(o => ({ id: o.id, name: o.name.trim() })) } : {}),
});
const capText = `A workspace can have up to ${FIELDS_MAX} fields`;
/* Said to screen readers without moving focus: the polite live region main.js makes (render.js uses it for the page title). It is
   emptied first, so the same words twice in a row are said twice. */
const announce = msg => {
  const live = $('#sr-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => (live.textContent = msg), 50);
};
/* After a render that shows a refusal in the dialog: the message may be below the fold of the dialog's body. */
const reveal = () => $('#fd-name-err, #fd-list-err')?.scrollIntoView({ block: 'nearest' });
/* The error under the name, or under the option row `row` of the dialog, or under the list when `row` is -1 (S.ui.errors.fdname,
   .fdlist and .fdrow, as the stage editor and the labels editor). */
const refuse = (msg, row = -1) => {
  S.ui.errors.fdlist = msg;
  S.ui.errors.fdrow = msg ? row : -1;
};

/* The server refuses anyone else, but a member who got here (a stale menu, a keyboard shortcut) should hear why. */
function mayManage() {
  if (canManageFields()) return true;
  toast('Only admins and managers can change project fields.', { kind: 'err' });
  return false;
}
/* Puts `fields` in the workspace's record, or makes the record. Looked up again each time: another admin may have saved the first list
   while a dialog was open (then it is updated, not made twice). */
function put(ws, fields) {
  const rec = listsOf(ws);
  if (rec) Object.assign(rec, { fields });
  else (D().workspaceLists ||= []).push({ id: uid(), workspace: ws, fields });
}
/* The workspace's fields as a write starts from them: copies, of the record's list, or of the built-in one. */
const currentList = ws => fieldsOf(ws).map(fieldCopy);
/* Projects of the workspace that are loaded (a private one the person cannot open is not), archived ones too, whose value for field
   `id` passes `test` (default: any value). */
function projectsWith(ws, id, test = () => true) {
  const k = 'f_' + id;
  return D().projects.filter(p => p.workspace === ws && canSee(p) && p[k] !== undefined && test(p[k]));
}
/* "3 projects (1 archived)", as the stage editor and the labels editor count. */
const countOf = ps => {
  const arch = ps.filter(p => p.archived).length;
  return plural(ps.length, 'project') + (arch ? ` (${arch} archived)` : '');
};

/* ---------- the list ---------- */
A.newField = () => {
  if (!mayManage() || needWorkspace()) return;
  const ws = D().ws.id;
  if (fieldsOf(ws).length >= FIELDS_MAX) return; // (the button is aria-disabled, with a note)
  S.ui.errors = {};
  // the id is made here, so a refused save that is tried again is the same field, not a second one
  S.ui.fdform = { ws, id: uid(), name: '', type: 'text', inTable: false, options: [], was: new Map() };
  openModal({ type: 'field', wlId: listsOf(ws)?.id });
};
A.editField = el => {
  if (!mayManage() || needWorkspace()) return;
  const ws = D().ws.id;
  const f = fieldsOf(ws).find(x => x.id === el.dataset.id);
  if (!f) return;
  const c = fieldCopy(f);
  S.ui.errors = {};
  S.ui.fdform = {
    ws,
    id: c.id,
    name: c.name,
    type: c.type,
    inTable: c.inTable,
    options: c.options || [],
    was: new Map((c.options || []).map(o => [o.id, o.name])),
  };
  openModal({ type: 'field', edit: c.id, wlId: listsOf(ws)?.id });
};
/* Move and Delete are not keyed (a workspace on the built-in fields has no record to key them by, and a delete is never replayed over a
   newer edit): each applies only while the field, and for a move its neighbour, are still where the click saw them. */
A.moveField = el => {
  if (!mayManage()) return;
  const ws = D().ws.id;
  const id = el.dataset.id;
  const dir = el.dataset.v === 'up' ? -1 : 1;
  const list = fieldsOf(ws);
  const i = list.findIndex(x => x.id === id);
  const other = list[i + dir];
  if (i < 0 || !other) return;
  const name = list[i].name;
  const nid = other.id;
  const at = l => {
    const j = l.findIndex(x => x.id === id);
    return j >= 0 && l[j + dir]?.id === nid ? j : -1;
  };
  let why = '';
  mutate(
    () => {
      why = '';
      const l = currentList(ws);
      const j = at(l);
      if (j < 0) {
        why = l.some(x => x.id === id) ? `The fields changed, so “${name}” was not moved.` : `“${name}” is gone.`;
        return;
      }
      [l[j], l[j + dir]] = [l[j + dir], l[j]];
      put(ws, l);
    },
    () => {
      if (why) {
        toast(why, { kind: 'err' });
        return;
      }
      // focus stays with the moved field: its button (the other one when it reached an end)
      const btn = d => $(`[data-a="moveField"][data-id="${CSS.escape(id)}"][data-v="${d}"]:not([disabled])`);
      const to = btn(el.dataset.v) || btn(el.dataset.v === 'up' ? 'down' : 'up');
      to?.focus({ preventScroll: true });
      to?.scrollIntoView({ block: 'nearest' });
      announce(`Moved “${name}” ${el.dataset.v}.`);
    },
    () => at(fieldsOf(ws)) >= 0,
  );
};
A.delField = el => {
  if (!mayManage()) return;
  const ws = D().ws.id;
  const id = el.dataset.id;
  const f = fieldsOf(ws).find(x => x.id === id);
  if (!f) return;
  const name = f.name;
  const ps = projectsWith(ws, id);
  const one = ps.length === 1;
  confirmDlg({
    wlId: listsOf(ws)?.id, // so a live deletion of the list closes this question (forgetUi in sync.js)
    title: `Delete the field “${name}”?`,
    body: ps.length
      ? `${countOf(ps)} ${one ? 'has' : 'have'} a value for it. ${one ? "That value isn't" : "Those values aren't"} erased: ${one ? 'it stays on the project but no longer shows' : 'they stay on the projects but no longer show'}. Private projects you can't see aren't counted.`
      : 'It will no longer show on projects.',
    ok: 'Delete field',
    danger: true,
    run: () => {
      let gone = false;
      let next, prev; // the fields around it in the list the delete is applied to
      mutate(
        () => {
          gone = false;
          const l = currentList(ws); // by id: another admin may have changed the list while the question was open
          const i = l.findIndex(x => x.id === id);
          if (i < 0) {
            gone = true;
            return;
          }
          next = l[i + 1]?.id;
          prev = l[i - 1]?.id;
          put(
            ws,
            l.filter(x => x.id !== id),
          );
        },
        () => {
          toast(gone ? `“${name}” is already deleted.` : `Deleted the field “${name}”`);
          // focus goes where the person is working: the Edit button of the row that took its place, else of the one before it, else Add field
          const edit = fid => fid && $(`[data-a="editField"][data-id="${CSS.escape(fid)}"]`);
          (edit(next) || edit(prev) || $('[data-a="newField"]'))?.focus({ preventScroll: true });
        },
        () => fieldsOf(ws).some(x => x.id === id),
      );
    },
  });
};

/* ---------- the dialog ---------- */
/* The form is S.ui.fdform: the field as typed (so a re-render, a move or a live change from the server keeps it), the workspace the
   dialog was opened in, and `was`, a Map of each saved option's name when it opened: a name clash between options is refused only on a
   row that was added or renamed since (a field that already clashes stays editable, or it could never be fixed). */
IN.fdName = el => {
  S.ui.fdform.name = el.value;
  if (S.ui.errors.fdname) {
    S.ui.errors.fdname = null;
    render();
  }
};
IN.fdType = el => {
  const f = S.ui.fdform;
  f.type = Object.hasOwn(FIELD_TYPES, el.value) ? el.value : 'text';
  refuse('');
  render();
  // the dialog is drawn again, so the select the choice was made in is a new one: focus stays with it (the enhanced select's button)
  $('[data-for="fd-type"]')?.focus({ preventScroll: true });
};
IN.fdTable = el => {
  S.ui.fdform.inTable = el.checked;
};
IN.fdOpt = el => {
  const f = S.ui.fdform;
  const o = f.options[+el.dataset.i];
  if (!o) return;
  o.name = el.value;
  // the row's group, its field and its buttons are named by it (no re-render: the focus stays in the field)
  const i = +el.dataset.i;
  const n = fdOptName(o, i);
  const g = el.closest('[role="group"]');
  const title = fdOptTitle(o, i);
  g?.setAttribute('aria-label', title);
  el.setAttribute('aria-label', `${title} name`);
  g?.querySelector('[data-v="up"]')?.setAttribute('aria-label', `Move ${n} up`);
  g?.querySelector('[data-v="down"]')?.setAttribute('aria-label', `Move ${n} down`);
  g?.querySelector('[data-a="fdOptRemove"]')?.setAttribute('aria-label', `Remove ${n}`);
  // a message about the options is out of date once one is changed
  if (S.ui.errors.fdlist) {
    refuse('');
    render();
  }
};
/* Move and Remove re-render the dialog, and focus goes where the person is working: a moved option keeps its button (the other one when
   it reached an end), a removed one hands focus to the option that took its place, or to Add option. */
A.fdOptMove = el => {
  const opts = S.ui.fdform.options;
  const i = +el.dataset.i;
  const v = el.dataset.v;
  const j = v === 'up' ? i - 1 : i + 1;
  if (!opts[i] || !opts[j]) return;
  [opts[i], opts[j]] = [opts[j], opts[i]];
  refuse('');
  render();
  const btn = d => $(`[data-a="fdOptMove"][data-i="${j}"][data-v="${d}"]:not([disabled])`);
  const to = btn(v) || btn(v === 'up' ? 'down' : 'up');
  to?.focus({ preventScroll: true });
  to?.scrollIntoView({ block: 'nearest' });
};
A.fdOptRemove = el => {
  const opts = S.ui.fdform.options;
  const i = +el.dataset.i;
  if (!opts[i]) return;
  opts.splice(i, 1);
  refuse('');
  render();
  ($(`#fd-opt-${i}`) || $('[data-a="fdOptAdd"]') || $('[data-a="submitField"]'))?.focus({ preventScroll: true });
};
A.fdOptAdd = () => {
  const opts = S.ui.fdform.options;
  if (opts.length >= FIELD_OPTIONS_MAX) return; // (the button is aria-disabled, with a note)
  opts.push({ id: uid(), name: '' });
  refuse('');
  render();
  setTimeout(() => $(`#fd-opt-${opts.length - 1}`)?.focus(), 0);
};

/* ---------- save ---------- */
/* Why the field cannot be saved, as [target, message, row]: target 'name' is under the name, 'list' under the options (row -1: under the
   list). Or null. */
function problem(f, c) {
  const name = c.name;
  if (!name) return ['name', 'Give the field a name'];
  if (name.length > FIELD_NAME_MAX) return ['name', `Field names can be up to ${FIELD_NAME_MAX} characters`];
  if (fieldsOf(f.ws).some(x => x.id !== f.id && sameName(x.name, name))) return ['name', `There is already a field called “${name}”`];
  if (c.type !== 'select') return null;
  const opts = c.options;
  if (!opts.length) return ['list', 'A dropdown needs at least one option', -1];
  if (opts.length > FIELD_OPTIONS_MAX) return ['list', `A dropdown can have up to ${FIELD_OPTIONS_MAX} options`, -1];
  for (const [i, o] of opts.entries()) {
    if (!o.name) return ['list', 'Every option needs a name', i];
    if (o.name.length > FIELD_OPTION_MAX) return ['list', `Option names can be up to ${FIELD_OPTION_MAX} characters`, i];
    const touched = f.was.get(o.id) !== o.name; // added here (no saved name) or renamed
    if (touched && opts.some((x, j) => j !== i && sameName(x.name, o.name))) return ['list', `There is more than one option called “${o.name}”`, i];
  }
  return null;
}
A.submitField = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.fdform;
  if (!mayManage()) return;
  const c = fieldCopy(f);
  const why = problem(f, c);
  if (why) {
    S.ui.errors.fdname = why[0] === 'name' ? why[1] : null;
    refuse(why[0] === 'list' ? why[1] : '', why[2]);
    render();
    $(why[0] === 'name' ? '#fd-name' : why[2] >= 0 ? `#fd-opt-${why[2]}` : '[data-a="fdOptAdd"]')?.focus();
    reveal();
    return;
  }
  S.ui.errors.fdname = null;
  refuse('');
  // Options the saved field has now and this one lacks go from every project of the workspace that has one of them as its value. Counted
  // over the projects that are loaded, archived ones too (the value is gone when they come back from the Archive).
  const keep = new Set(c.options?.map(o => o.id));
  const now = m.edit ? fieldsOf(f.ws).find(x => x.id === f.id) : null;
  const dropped = new Map((now?.options || []).filter(o => !keep.has(o.id)).map(o => [o.id, o.name]));
  const ps = dropped.size ? projectsWith(f.ws, f.id, v => dropped.has(v)) : [];
  // This attempt is the newest one even when the question below is cancelled: an older "Try again" must not save the field it was for.
  const fresh = latest(m);
  if (!ps.length) {
    saveField(m, f.ws, c, fresh);
    return;
  }
  // One option is named, as are none of several (they are counted); "it" or "them" follows how many options in use go, not how many projects.
  const used = new Set(ps.map(p => p['f_' + f.id]));
  const names = [...dropped].filter(([id]) => used.has(id)).map(([, n]) => n);
  // (Cancel pops this question and leaves the dialog as it was)
  confirmDlg({
    wlId: listsOf(f.ws)?.id, // so a live deletion of the list closes this question (forgetUi in sync.js)
    title: names.length === 1 ? `Remove the option “${names[0]}” from ${c.name}?` : `Remove ${names.length} options from ${c.name}?`,
    body: `${countOf(ps)} ${ps.length === 1 ? 'uses' : 'use'} ${used.size === 1 ? 'it' : 'them'}. ${ps.length === 1 ? 'Its value stops' : 'Their value stops'} showing. Private projects you can't see aren't counted.`,
    ok: names.length === 1 ? 'Remove option' : 'Remove options',
    danger: true,
    run: () => saveField(m, f.ws, c, fresh),
  });
};
/* What was validated is saved: the dialog stays editable after a refusal, so "Try again" must not read it again. Only this field is
   replaced, in the list as it is when the edit runs: a new one goes at the end, one that is gone (deleted by another admin) is not
   made again, and a list that has filled up meanwhile takes no more. */
function saveField(m, ws, c, fresh) {
  const isNew = !m.edit;
  let refused = '';
  let close = false;
  mutate(
    () => {
      refused = '';
      close = false;
      const l = currentList(ws);
      const i = l.findIndex(x => x.id === c.id);
      if (i < 0 && !isNew) {
        refused = `“${c.name}” is gone: it was deleted. Nothing was saved.`;
        close = true;
        return;
      }
      // the name was free when it was validated; another admin may have taken it since, or this is a "Try again" that lands later
      const clash = l.find(x => x.id !== c.id && sameName(x.name, c.name));
      if (clash) {
        refused = `There is already a field called “${clash.name}”. Nothing was saved.`;
        S.ui.errors.fdname = `There is already a field called “${clash.name}”`;
        return;
      }
      if (i >= 0) l[i] = fieldCopy(c);
      else if (l.length >= FIELDS_MAX) {
        refused = `${capText}. Nothing was saved.`;
        return;
      } else l.push(fieldCopy(c));
      put(ws, l);
    },
    () => {
      if (refused) toast(refused, { kind: 'err' });
      if (refused && !close) {
        // (the message under the name is drawn by the render that followed the write)
        if (S.ui.errors.fdname) {
          $('#fd-name')?.focus();
          reveal();
        }
        return;
      }
      S.ui.modals.pop();
      render();
      if (!refused) toast(isNew ? `Added the field “${c.name}”` : `Saved the field “${c.name}”`);
    },
    () => isTop(m) && fresh(),
  );
}
