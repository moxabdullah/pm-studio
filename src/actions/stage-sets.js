/* =====================================================================
   ACTIONS · STAGE SETS: make one (Customise the built-in, or New), edit, delete (Settings > Stages)
   A project's own stage and health are in stages.js.
   ===================================================================== */
import { $, uid } from '../core/utils.js';
import { DEFAULT_STAGE_SET, STAGES_MAX, STAGE_COLORS, STAGE_NAME_MAX, STAGE_SETS_MAX, STAGE_SET_NAME_MAX } from '../core/constants.js';
import { D, S, canManageStages, findStageSet, projectsUsing, stageSetsOf } from '../core/store.js';
import { latest, mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { openModal } from '../overlays/modals.js';
import { A, IN, confirmDlg, isTop, needWorkspace } from './actions.js';

const COLORS = Object.keys(STAGE_COLORS);
const projectsText = n => `${n} project${n === 1 ? '' : 's'}`;
/* "3 projects", or "3 projects (1 archived)": archived projects count, since they come back in the stage they were in. */
const countText = list => {
  const a = list.filter(p => p.archived).length;
  return projectsText(list.length) + (a ? ` (${a} archived)` : '');
};
/* A stage as normalize.js yields it (exactly these four keys): the editor's form and every record made here hold copies. */
const stageCopy = s => ({ id: s.id, name: s.name, color: COLORS.includes(s.color) ? s.color : 'gray', finished: s.finished === true });
const stagesCopy = stages => stages.map(stageCopy);

/* The server refuses anyone else, but a member who got here (a stale menu, a keyboard shortcut) should hear why. */
function mayManage() {
  if (canManageStages()) return true;
  toast('Only admins and managers can change stage sets.', { kind: 'err' });
  return false;
}
/* Projects in a stage of a set, as the sentence that refuses removing the stage, or ''. A project with no stage, or no set, counts for
   the first stage of the first set (store.js projectsUsing). */
function inStageError(setId, stage) {
  const list = projectsUsing(setId, stage.id);
  const n = list.length;
  return n ? `${countText(list)} ${n === 1 ? 'is' : 'are'} in ${stage.name}. Move ${n === 1 ? 'it' : 'them'} to another stage first.` : '';
}
/* Why the stages the saved set has and `keep` (a Set of ids) does not cannot go, or ''. Checked when Remove is clicked and again when
   the set is saved (a project may have been moved in meanwhile). */
function removedError(set, keep) {
  for (const s of set.stages) if (!keep.has(s.id)) return inStageError(set.id, s);
  return '';
}
const usedError = (set, list) =>
  `${countText(list)} ${list.length === 1 ? 'uses' : 'use'} ${set.name}. Move ${list.length === 1 ? 'it' : 'them'} to another stage set first.`;

/* ---------- make: Customise (the built-in set becomes a record) and New ---------- */
/* Customise copies the built-in set with the same stage ids, so the projects that name no set keep their stage. */
A.customiseStages = () => {
  if (!mayManage() || needWorkspace()) return;
  const ws = D().ws.id;
  let why = '';
  mutate(
    () => {
      why = '';
      if (stageSetsOf(ws).length) {
        why = 'This workspace has its own stage sets already.'; // a double click, or another admin was first
        return;
      }
      (D().stageSets ||= []).push({ id: uid(), workspace: ws, name: DEFAULT_STAGE_SET.name, stages: stagesCopy(DEFAULT_STAGE_SET.stages) });
    },
    () => (why ? toast(why, { kind: 'err' }) : toast(`Made ‘${DEFAULT_STAGE_SET.name}’ a stage set you can edit`)),
  );
};
/* New starts as a copy of the built-in stages, in the editor: nothing is made until it is saved. A workspace with no set of its own
   starts with Customize instead, since a first set made here would take the built-in one's place and its projects with it. */
A.newStageSet = () => {
  if (!mayManage() || needWorkspace()) return;
  if (!stageSetsOf(D().ws.id).length) {
    toast('Customize the built-in set to add more stage sets.', { kind: 'err' });
    return;
  }
  if (stageSetsOf(D().ws.id).length >= STAGE_SETS_MAX) {
    toast(`A workspace can have up to ${STAGE_SETS_MAX} stage sets.`, { kind: 'err' });
    return;
  }
  openEditor(null, '', stagesCopy(DEFAULT_STAGE_SET.stages));
};
A.editStageSet = el => {
  const s = findStageSet(el.dataset.id);
  if (!s || !mayManage()) return;
  openEditor(s.id, s.name, stagesCopy(s.stages));
};
function openEditor(id, name, stages) {
  S.ui.errors = {};
  S.ui.ssform = { name, stages };
  openModal(id ? { type: 'stageSet', edit: id } : { type: 'stageSet' });
}

/* ---------- the editor ---------- */
/* What was typed stays in S.ui.ssform, so a re-render (a stage moved, a live change from the server) does not lose it. */
IN.ssName = el => {
  S.ui.ssform.name = el.value;
  if (S.ui.errors.ssname && el.value.trim()) {
    S.ui.errors.ssname = null;
    render();
  }
};
IN.ssStage = el => {
  const s = S.ui.ssform.stages[+el.dataset.i];
  if (!s) return;
  const f = el.dataset.f;
  if (f === 'finished') s.finished = el.checked;
  else if (f === 'color') s.color = COLORS.includes(el.value) ? el.value : 'gray';
  else s.name = el.value;
  // the colour shows in a swatch, and a message about the stages is out of date once one is changed
  if (f === 'color' || S.ui.errors.sslist) {
    S.ui.errors.sslist = null;
    S.ui.errors.ssrow = -1;
    render();
  }
};
A.ssMove = el => {
  const stages = S.ui.ssform.stages;
  const i = +el.dataset.i;
  const j = i + +el.dataset.d;
  if (!stages[i] || !stages[j]) return;
  [stages[i], stages[j]] = [stages[j], stages[i]];
  S.ui.errors.sslist = null;
  render();
};
A.ssRemove = el => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const stages = S.ui.ssform.stages;
  const i = +el.dataset.i;
  const s = stages[i];
  if (!s) return;
  const saved = m.edit && findStageSet(m.edit);
  const why = saved?.stages.some(x => x.id === s.id) ? inStageError(saved.id, s) : ''; // a stage added in this dialog has no projects
  S.ui.errors.sslist = why || null;
  S.ui.errors.ssrow = why ? i : -1;
  if (!why) stages.splice(i, 1);
  render();
};
A.ssAdd = () => {
  const stages = S.ui.ssform.stages;
  if (stages.length >= STAGES_MAX) {
    S.ui.errors.sslist = `A set can have up to ${STAGES_MAX} stages.`;
    S.ui.errors.ssrow = -1;
    render();
    return;
  }
  stages.push({ id: uid(), name: '', color: 'gray', finished: false });
  S.ui.errors.sslist = null;
  render();
  setTimeout(() => $(`#ss-name-${stages.length - 1}`)?.focus(), 0);
};
A.submitStageSet = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.ssform;
  if (!mayManage()) return;
  const name = f.name.trim();
  const stages = f.stages.map(s => stageCopy({ ...s, name: s.name.trim() }));
  const saved = m.edit ? findStageSet(m.edit) : null;
  const nameErr = !name ? 'Give the stage set a name' : name.length > STAGE_SET_NAME_MAX ? `Names can be up to ${STAGE_SET_NAME_MAX} characters` : '';
  let listErr = '';
  let row = -1;
  if (!stages.length) listErr = 'Add at least one stage.';
  else if (stages.length > STAGES_MAX) listErr = `A set can have up to ${STAGES_MAX} stages.`;
  else {
    row = stages.findIndex(s => !s.name || s.name.length > STAGE_NAME_MAX);
    if (row >= 0) listErr = stages[row].name ? `Stage names can be up to ${STAGE_NAME_MAX} characters.` : 'Every stage needs a name.';
  }
  if (!listErr && saved) listErr = removedError(saved, new Set(stages.map(s => s.id)));
  if (nameErr || listErr) {
    S.ui.errors.ssname = nameErr;
    S.ui.errors.sslist = listErr;
    S.ui.errors.ssrow = row;
    render();
    $(nameErr ? '#ss-name' : row >= 0 ? `#ss-name-${row}` : '#ss-name')?.focus();
    return;
  }
  // what was validated: the form stays editable after a refusal, so "Try again" must not read it again
  const v = { name, stages };
  const id = m.edit;
  const ws = D().ws.id;
  if (!id && needWorkspace()) return;
  const fresh = latest(m);
  let why = '';
  mutate(
    () => {
      why = '';
      if (id) {
        const s = findStageSet(id); // by id: sync or Undo can replace the set while a refused save waits for "Try again"
        if (!s) {
          why = 'That stage set is gone.';
          return;
        }
        why = removedError(s, new Set(v.stages.map(x => x.id)));
        if (why) return;
        Object.assign(s, { name: v.name, stages: stagesCopy(v.stages) });
      } else {
        if (stageSetsOf(ws).length >= STAGE_SETS_MAX) {
          why = `A workspace can have up to ${STAGE_SETS_MAX} stage sets.`;
          return;
        }
        // (a delete by another admin since the dialog opened) with no set saved, this one becomes the first and takes the built-in one's projects
        if (!stageSetsOf(ws).length) {
          why = removedError(DEFAULT_STAGE_SET, new Set(v.stages.map(x => x.id)));
          if (why) return;
        }
        (D().stageSets ||= []).push({ id: uid(), workspace: ws, name: v.name, stages: stagesCopy(v.stages) });
      }
    },
    () => {
      if (why) {
        S.ui.errors.sslist = why;
        S.ui.errors.ssrow = -1;
        render();
        return;
      }
      S.ui.modals.pop();
      render();
      toast(`Saved stage set ‘${v.name}’`);
    },
    () => isTop(m) && fresh() && (!id || !!findStageSet(id)),
  );
};

/* ---------- delete ---------- */
A.delStageSet = el => {
  const s = findStageSet(el.dataset.id);
  if (!s || !mayManage()) return;
  const { id, name } = s;
  const using = projectsUsing(id);
  if (using.length) {
    toast(usedError(s, using), { kind: 'err' });
    return;
  }
  const last = stageSetsOf(s.workspace).length === 1;
  confirmDlg({
    ssId: id, // so a live deletion of the set closes this question (forgetUi in sync.js)
    title: `Delete stage set ‘${name}’?`,
    body: last ? 'No project is in it. The workspace goes back to the built-in stages.' : 'No project is in it.',
    ok: 'Delete stage set',
    danger: true,
    run: () => {
      let why = '';
      mutate(
        () => {
          why = '';
          const set = findStageSet(id); // by id: sync can replace the set while a refused delete waits for "Try again"
          const left = set ? projectsUsing(id) : []; // a project may have been put in it while the question was open
          if (left.length) {
            why = usedError(set, left);
            return;
          }
          D().stageSets = D().stageSets.filter(x => x.id !== id);
        },
        () => (why ? toast(why, { kind: 'err' }) : toast(`Deleted stage set ‘${name}’`)),
        () => !!findStageSet(id),
      );
    },
  });
};
