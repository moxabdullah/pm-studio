/* =====================================================================
   ACTIONS · A PROJECT'S STAGE AND HEALTH: the writers behind the pickers on a project (popovers.js 'pstage', 'phealth').
   The stage sets themselves are edited in stage-sets.js. Everything is written in the form normalize.js yields for a project.
   ===================================================================== */
import { HEALTH, STAGE_HISTORY_MAX } from '../core/constants.js';
import { proj, pushAct, setOf, stageOf, stageSetsOf } from '../core/store.js';
import { latestFields, mutate, toast } from '../ui/toast.js';

/* Put a project in a stage of a set. `setId` is given when the picker chose another set than the project's: the set is written with
   the stage, in one change. The history gets an entry when the stage changes (by id: a stage with the same id in another set, which
   "Customize" makes, is the same stage to the project) or the set does; picking where the project already is writes nothing and says
   nothing. Look-ups are by id, inside the change, since sync or Undo can replace the project (or the set can go) while a refused
   change waits for "Try again". */
export function moveProject(id, stageId, setId) {
  const pr0 = proj(id);
  if (!pr0) return;
  const set0 = setId ? stageSetsOf(pr0.workspace).find(s => s.id === setId) : setOf(pr0);
  if (set0 && set0.id === setOf(pr0).id && stageOf(pr0).id === stageId && set0.stages.some(s => s.id === stageId)) return;
  const fresh = latestFields('proj', id, setId ? ['stageSet', 'stage', 'stageHistory'] : ['stage', 'stageHistory']);
  let name = '';
  let moved = null; // [the stage, its set] the project is in now; null when nothing was written
  mutate(
    () => {
      moved = null;
      const pr = proj(id);
      const set = setId ? stageSetsOf(pr.workspace).find(s => s.id === setId) : setOf(pr);
      const stage = set?.stages.find(s => s.id === stageId);
      if (!stage) return;
      const was = stageOf(pr).id;
      const setChanged = set.id !== setOf(pr).id;
      if (setId) pr.stageSet = setId;
      pr.stage = stage.id;
      if (stage.id !== was || setChanged) {
        pr.stageHistory = [...(pr.stageHistory || []), { stage: stage.id, at: new Date().toISOString() }].slice(-STAGE_HISTORY_MAX);
        pushAct('moved project', null, pr.id, 'to ' + stage.name + (setChanged ? ` (${set.name})` : ''));
      }
      name = pr.name;
      moved = [stage, setChanged ? set : null];
    },
    () => (moved ? toast(`${name} moved to ${moved[0].name}${moved[1] ? ` (${moved[1].name})` : ''}`) : toast('That stage is gone.', { kind: 'err' })),
    () => fresh() && !!proj(id),
  );
}

export function setHealth(id, v) {
  if (!Object.keys(HEALTH).includes(v) || proj(id)?.health === v) return;
  const fresh = latestFields('proj', id, ['health']);
  let pr;
  mutate(
    () => {
      pr = proj(id);
      pr.health = v;
      pushAct('changed health of project', null, pr.id, 'to ' + HEALTH[v].name);
    },
    () => toast(`${pr.name} marked ${HEALTH[v].name}`),
    () => fresh() && !!proj(id),
  );
}
