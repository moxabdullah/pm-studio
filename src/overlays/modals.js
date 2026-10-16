/* ---------------- MODALS ---------------- */
import { $$, MOD, ago, esc, fmtDate } from '../core/utils.js';
import { ic } from '../core/icons.js';
import {
  LABELS_MAX,
  LABEL_NAME_MAX,
  PCOLORS,
  PICONS,
  STAGE_COLORS,
  STAGE_NAME_MAX,
  STAGE_SET_NAME_MAX,
  TEMPLATE_DESC_MAX,
  TEMPLATE_NAME_MAX,
} from '../core/constants.js';
import { D, S, canManageTemplates, mem, pColor, proj, stageSetsOf, task, teamsList, templatesOf } from '../core/store.js';
import { isRaster } from '../core/files.js';
import { FT, av, filePrev, nameOf, prPill, stPill, taskLbls } from '../ui/helpers.js';
import { focusKey, render } from '../shell/render.js';
import { teamModal } from '../features/teams.js';

export function openModal(m) {
  S.ui.modalOpeners = S.ui.modalOpeners || [];
  S.ui.modalOpeners[S.ui.modals.length] = S.ui.popOpener && S.ui.pop ? S.ui.popOpener : focusKey(document.activeElement);
  S.ui.modals.push(m);
  S.ui.pop = null;
  render();
  setTimeout(() => {
    const all = $$('.modal');
    const last = all[all.length - 1];
    const af = last?.querySelector('[autofocus]');
    (af || last?.querySelector('input,textarea,button'))?.focus();
  }, 30);
}
export function closeModal() {
  S.ui.modals.pop();
  S.ui.pop = null;
  render();
}
export function modalHtml(m) {
  const H = (title, sub = '') =>
    `<div class="modal-h"><div><h2 id="mt-${esc(m.type)}">${title}</h2>${sub ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${sub}</div>` : ''}</div><button class="ibtn ibtn-sm" data-a="closeModal" aria-label="Close">${ic('x', 16)}</button></div>`;
  const wrap = (cls, inner) => `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="mt-${esc(m.type)}">${inner}</div>`;
  switch (m.type) {
    case 'task':
      return wrap('', taskModal(m, H));
    case 'project':
      return wrap('', projectModal(m, H));
    case 'share':
      return wrap('', shareModal(m, H));
    case 'confirm':
      return wrap('sm', confirmModal(m, H));
    case 'prompt':
      // m.validate(value) -> an error, when it has one, is shown under the input (m.error, set by A.promptSubmit) and the dialog stays open
      return wrap(
        'sm',
        `${H(esc(m.title), m.sub ? esc(m.sub) : '')}<form class="modal-b" data-submit="promptSubmit"><div class="field"><label class="label" for="prompt-in">${esc(m.label)}</label><input class="input ${m.error ? 'is-error' : ''}" id="prompt-in" data-in="promptIn" value="${esc(m.value || '')}"${m.max ? ` maxlength="${Number(m.max)}"` : ''} autofocus aria-invalid="${!!m.error}"${m.error ? ' aria-describedby="prompt-err"' : ''}>${m.error ? `<span class="err" id="prompt-err" role="alert">${ic('circle-alert', 12)}${esc(m.error)}</span>` : ''}</div></form><div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="promptSubmit">${esc(m.ok || 'Save')}</button></div>`,
      );
    case 'shortcuts':
      return wrap('lg', shortcutsModal(H));
    case 'team':
      return wrap('', teamModal(m, H));
    case 'template':
      return wrap('sm', templateModal(m, H));
    case 'stageSet':
      return wrap('', stageSetModal(m, H));
    case 'labels':
      return wrap('', labelsModal(H));
    case 'filePreview':
      return wrap('lg', filePreviewModal(m, H));
    case 'saveView':
      return wrap(
        'sm',
        `${H('Save view', 'Save the current filters as a tab on this project.')}<form class="modal-b" data-submit="saveViewSubmit"><div class="field"><label class="label" for="sv-name">View name</label><input class="input" id="sv-name" placeholder="e.g. Design review queue" autofocus></div><div class="field"><label class="label" for="sv-type">Layout</label><select class="select" id="sv-type"><option value="list">List</option><option value="board">Board</option><option value="table">Table</option></select></div>${m.nf ? `<div class="hint">${m.nf} filter${m.nf > 1 ? 's' : ''} will be saved with this view.</div>` : '<div class="alert info">' + ic('info', 14) + '<span>No filters are active — the view will show all tasks. You can add filters after saving.</span></div>'}</form><div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="saveViewSubmit">Save view</button></div>`,
      );
  }
  return '';
}
export function formChip(pop, html, label) {
  return `<button class="pillbtn bordered" data-a="pop" data-pop="${pop}" data-id="__form" ${pop === 'date' ? `data-field="${label}"` : ''} aria-label="${esc(label)}">${html}</button>`;
}
export function taskModal(m, H) {
  const f = S.ui.form;
  const p = proj(f.project);
  const err = S.ui.errors.title;
  return `${H(m.edit ? 'Edit task' : 'New task', m.edit ? `<span class="mono">${esc(task(m.edit)?.key)}</span>` : '')}
  <form class="modal-b" data-submit="submitTask" style="gap:12px">
    <div class="field"><label class="sr" for="f-title">Task name</label><input class="input input-lg ${err ? 'is-error' : ''}" id="f-title" data-in="form" data-f="title" value="${esc(f.title)}" placeholder="Task name" autofocus aria-invalid="${!!err}" aria-describedby="f-title-err" style="font-size:15px;font-weight:500">${err ? `<span class="err" id="f-title-err">${ic('circle-alert', 12)}${esc(err)}</span>` : ''}</div>
    <div class="field"><label class="sr" for="f-desc">Description</label><textarea class="textarea" id="f-desc" data-in="form" data-f="desc" placeholder="Add a description… (optional)" rows="3">${esc(f.desc)}</textarea></div>
    <div class="row" style="flex-wrap:wrap;gap:6px">
      ${formChip('project', `<span class="pdot" style="--c:${pColor(p)}"></span>${esc(p?.name || 'Project')}`, 'Project')}
      ${formChip('status', stPill(f.status), 'Status')}
      ${formChip('assignee', `${av(f.assignee, 'sm', false)}${esc(mem(f.assignee)?.name || 'Assignee')}`, 'Assignee')}
      ${formChip('priority', prPill(f.priority), 'Priority')}
      ${formChip('date', `${ic('calendar', 13)}${f.due ? 'Due ' + fmtDate(f.due) : 'Due date'}`, 'due')}
      ${formChip('date', `${ic('calendar-arrow-up', 13)}${f.start ? 'Starts ' + fmtDate(f.start) : 'Start date'}`, 'start')}
      ${formChip('labels', f.labels.length ? taskLbls(f) : `${ic('tag', 13)}Labels`, 'Labels')}
      ${formChip('recur', `${ic('repeat', 13)}${esc(f.recur || 'Repeat')}`, 'Repeat')}
    </div>
    <div class="field"><span class="label">Subtasks</span>
      ${f.subtasks.map((s, i) => `<div class="subt" style="padding:0 4px">${ic('circle', 13)}<span class="s">${esc(s.title)}</span><button type="button" class="ibtn ibtn-xs x" style="opacity:1" data-a="formRmSub" data-i="${i}" aria-label="Remove">${ic('x', 12)}</button></div>`).join('')}
      <div class="inwrap">${ic('plus', 14)}<input class="input" id="f-sub" data-key-enter="formAddSub" placeholder="Add a subtask and press Enter"></div></div>
    <div class="field"><span class="label">Attachments</span>
      ${f.files.length ? `<div class="col" style="gap:4px">${f.files.map((x, i) => `<div class="upl" style="padding:6px 10px"><span class="ftype" style="--c:${FT[x.type].c};width:22px;height:22px">${ic(FT[x.type].i, 12)}</span><span class="grow trunc">${esc(x.name)}</span><span class="faint" style="font-size:11.5px">${esc(x.size)}</span><button type="button" class="ibtn ibtn-xs" data-a="formRmFile" data-i="${i}" aria-label="Remove">${ic('x', 12)}</button></div>`).join('')}</div>` : ''}
      <div class="dropzone" style="padding:10px" data-a="pickFormFiles">${ic('paperclip', 14)}<span>Attach files</span></div></div>
  </form>
  <div class="modal-f">${m.edit ? '' : `<label class="row" style="gap:8px;font-size:12.5px;color:var(--text-2);cursor:pointer"><input type="checkbox" class="toggle" id="f-more" data-in="formMore" ${f.more ? 'checked' : ''}>Create more</label>`}<span class="sp"></span>
    <span class="faint hide-m" style="font-size:11.5px"><kbd>${MOD}</kbd> <kbd>↵</kbd></span>
    <button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitTask" id="f-submit">${m.edit ? 'Save changes' : 'Create task'}</button></div>`;
}
/* The Template field of the New project form: "Blank project", then the current workspace's templates. A template that went away since
   the form opened is not offered, and the form reads as blank (createProject() does the same). A card shows the description, when
   the template has one, as a second line cut to the width of the card (the whole text is its tooltip), else the number of tasks. */
function templatePicker(f) {
  const list = templatesOf(D().ws.id);
  const on = list.some(t => t.id === f.tmpl) ? f.tmpl : 'blank';
  const opt = (id, icon, name, sub, tip = '') =>
    `<button type="button" role="radio" aria-checked="${on === id}" class="opt ${on === id ? 'on' : ''}" data-a="pformSet" data-f="tmpl" data-v="${esc(id)}" style="padding:10px"${tip ? ` title="${esc(tip)}"` : ''}>${ic(icon, 16)}<b style="font-size:12.5px;overflow-wrap:anywhere">${esc(name)}</b><span class="trunc">${esc(sub)}</span></button>`;
  const tasks = t => `${t.tasks.length} task${t.tasks.length === 1 ? '' : 's'}`;
  // data-keep: the list scrolls (max-height in auth.css), and a click re-renders the dialog
  return `<div class="field"><span class="label">Template</span><div class="tmpls" data-keep="tmpls" role="radiogroup" aria-label="Template">${opt('blank', 'file', 'Blank project', 'Start from scratch')}${list.map(t => opt(t.id, t.icon, t.name, t.desc || tasks(t), t.desc)).join('')}</div>${
    list.length || !canManageTemplates() ? '' : '<div class="hint">Save a project as a template from its ••• menu.</div>'
  }</div>`;
}
export function projectModal(m, H) {
  const f = S.ui.pform;
  const err = S.ui.errors.pname;
  // data-keep: the body scrolls (the dialog is capped at 80vh), and picking a template, an icon or a colour re-renders it
  return `${H(m.edit ? 'Project settings' : 'New project', m.edit ? '' : 'Projects hold tasks, files, and conversations for one body of work.')}
  <form class="modal-b" data-submit="submitProject" data-keep="modal-project:${m.edit ? esc(m.edit) : 'new'}">
    <div class="row" style="gap:10px;align-items:flex-start">
      <button type="button" class="picon lg" style="--c:${PCOLORS[f.color]};cursor:default;flex-shrink:0;margin-top:22px" aria-hidden="true" tabindex="-1">${ic(f.icon, 18)}</button>
      <div class="field grow"><label class="label" for="p-name">Project name</label><input class="input ${err ? 'is-error' : ''}" id="p-name" data-in="pform" data-f="name" value="${esc(f.name)}" placeholder="e.g. Website Redesign" autofocus aria-invalid="${!!err}">${err ? `<span class="err">${ic('circle-alert', 12)}${esc(err)}</span>` : ''}</div>
    </div>
    <div class="field"><label class="label" for="p-desc">Description</label><textarea class="textarea" id="p-desc" data-in="pform" data-f="desc" rows="2" placeholder="What is this project about?">${esc(f.desc)}</textarea></div>
    <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:220px"><span class="label">Icon</span><div class="iconpick" role="radiogroup" aria-label="Icon">${PICONS.map(i => `<button type="button" role="radio" aria-checked="${f.icon === i}" class="${f.icon === i ? 'on' : ''}" data-a="pformSet" data-f="icon" data-v="${i}" aria-label="${i}">${ic(i, 15)}</button>`).join('')}</div></div>
      <div class="field"><span class="label">Color</span><div class="swatches" role="radiogroup" aria-label="Color" style="max-width:140px">${Object.entries(
        PCOLORS,
      )
        .map(
          ([k, v]) =>
            `<button type="button" role="radio" aria-checked="${f.color === k}" class="sw ${f.color === k ? 'on' : ''}" style="--c:${v};width:22px;height:22px" data-a="pformSet" data-f="color" data-v="${k}" aria-label="${k}">${f.color === k ? ic('check', 12) : ''}</button>`,
        )
        .join('')}</div></div>
    </div>
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-team">Team</label><select class="select" id="p-team" data-in="pform" data-f="team">${teamsList()
        .map(t => `<option value="${esc(t.id)}" ${f.team === t.id ? 'selected' : ''}>${esc(t.name)}</option>`)
        .join('')}</select></div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-lead">Lead</label><select class="select" id="p-lead" data-in="pform" data-f="lead">${D()
        .members.filter(x => x.status === 'active')
        .map(x => `<option value="${esc(x.id)}" ${f.lead === x.id ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</select></div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-due">Target date</label><input type="date" class="input" id="p-due" data-in="pform" data-f="due" value="${esc(f.due || '')}"></div>
    </div>
    ${m.edit ? '' : stageSetPicker(f)}
    ${m.edit ? '' : templatePicker(f)}
  </form>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitProject">${m.edit ? 'Save changes' : 'Create project'}</button></div>`;
}
/* Which stage set a new project is in; asked only when the workspace has more than one (a project of the only set needs no choice). */
function stageSetPicker(f) {
  const sets = stageSetsOf(D().ws.id);
  if (sets.length < 2) return '';
  return `<div class="field"><label class="label" for="p-stageset">Stage set</label><select class="select" id="p-stageset" data-in="pform" data-f="stageSet">${sets
    .map(s => `<option value="${esc(s.id)}" ${f.stageSet === s.id ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('')}</select></div>`;
}
/* Edit a template's name and description (Settings > Templates). The tasks it carries are not edited here: save the project again to replace them. */
export function templateModal(m, H) {
  const f = S.ui.tpform;
  const err = S.ui.errors.tpname;
  const descErr = S.ui.errors.tpdesc;
  return `${H('Edit template', 'To change its tasks, save a project as a template again under the same name.')}
  <form class="modal-b" data-submit="submitTemplate">
    <div class="field"><label class="label" for="tp-name">Template name</label><input class="input ${err ? 'is-error' : ''}" id="tp-name" data-in="tpform" data-f="name" value="${esc(f.name)}" maxlength="${TEMPLATE_NAME_MAX}" autofocus aria-invalid="${!!err}"${err ? ' aria-describedby="tp-name-err"' : ''}>${err ? `<span class="err" id="tp-name-err" role="alert">${ic('circle-alert', 12)}${esc(err)}</span>` : ''}</div>
    <div class="field"><label class="label" for="tp-desc">Description</label><textarea class="textarea ${descErr ? 'is-error' : ''}" id="tp-desc" data-in="tpform" data-f="desc" rows="2" maxlength="${TEMPLATE_DESC_MAX}" placeholder="What is this template for?" aria-invalid="${!!descErr}"${descErr ? ' aria-describedby="tp-desc-err"' : ''}>${esc(f.desc)}</textarea>${descErr ? `<span class="err" id="tp-desc-err" role="alert">${ic('circle-alert', 12)}${esc(descErr)}</span>` : ''}</div>
  </form>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitTemplate">Save changes</button></div>`;
}
/* Edit a stage set, or make one (Settings > Stages): its name, and its stages in order, each with a name, a color and whether it
   finishes a project. The form is S.ui.ssform; what a click or a save refuses is under S.ui.errors: ssname (under the name), and
   sslist, which is under the stage ssrow is about, or under the list when ssrow is -1. data-keep: the body scrolls, and a move or a
   removal re-renders it. */
export function stageSetModal(m, H) {
  const f = S.ui.ssform;
  const e = S.ui.errors;
  const bad = e.sslist ? e.ssrow : -1; // the stage the message under the list is about
  const err = (id, msg, st = '') =>
    msg ? `<span class="err" id="${id}" role="alert"${st ? ` style="${st}"` : ''}>${ic('circle-alert', 12)}${esc(msg)}</span>` : '';
  const last = f.stages.length - 1;
  const row = (s, i) => `<div style="margin-bottom:12px"><div class="row" role="group" aria-label="Stage ${i + 1}" style="gap:6px 8px;flex-wrap:wrap">
      <span class="pdot" style="--c:${STAGE_COLORS[s.color]};border-radius:50%;width:10px;height:10px" aria-hidden="true"></span>
      <input class="input ${bad === i ? 'is-error' : ''}" id="ss-name-${i}" data-in="ssStage" data-i="${i}" data-f="name" value="${esc(s.name)}" maxlength="${STAGE_NAME_MAX}" placeholder="Stage name" aria-label="Stage ${i + 1} name" aria-invalid="${bad === i}"${bad === i ? ' aria-describedby="ss-row-err"' : ''} style="flex:1;min-width:140px">
      <select class="select" data-in="ssStage" data-i="${i}" data-f="color" aria-label="Stage ${i + 1} color" style="width:auto">${Object.keys(STAGE_COLORS)
        .map(k => `<option value="${k}" ${s.color === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`)
        .join('')}</select>
      <label class="row" style="gap:4px;font-size:12.5px;cursor:pointer"><input type="checkbox" class="check" data-in="ssStage" data-i="${i}" data-f="finished" ${s.finished ? 'checked' : ''}>Finished</label>
      <span class="row" style="gap:2px;flex-wrap:nowrap;margin-left:auto">
        <button type="button" class="ibtn ibtn-sm" data-a="ssMove" data-i="${i}" data-v="up" ${i === 0 ? 'disabled' : ''} aria-label="Move stage ${i + 1} up">${ic('arrow-up', 14)}</button>
        <button type="button" class="ibtn ibtn-sm" data-a="ssMove" data-i="${i}" data-v="down" ${i === last ? 'disabled' : ''} aria-label="Move stage ${i + 1} down">${ic('arrow-down', 14)}</button>
        <button type="button" class="ibtn ibtn-sm" data-a="ssRemove" data-i="${i}" aria-label="Remove stage ${i + 1}">${ic('trash-2', 14)}</button>
      </span>
    </div>${bad === i ? err('ss-row-err', e.sslist, 'margin-top:4px') : ''}</div>`;
  return `${H(m.edit ? 'Edit stage set' : 'New stage set', 'A project sits in one stage of its set. A finished stage (Closed, Cancelled) takes the project out of the Active lists.')}
  <form class="modal-b" data-submit="submitStageSet" data-keep="modal-stageset:${m.edit ? esc(m.edit) : 'new'}">
    <div class="field"><label class="label" for="ss-name">Stage set name</label><input class="input ${e.ssname ? 'is-error' : ''}" id="ss-name" data-in="ssName" value="${esc(f.name)}" maxlength="${STAGE_SET_NAME_MAX}" placeholder="e.g. Integrator job" autofocus aria-invalid="${!!e.ssname}"${e.ssname ? ' aria-describedby="ss-name-err"' : ''}>${err('ss-name-err', e.ssname)}</div>
    <div class="field"><span class="label">Stages, in order</span>
      ${f.stages.map(row).join('')}
      ${bad < 0 ? err('ss-list-err', e.sslist) : ''}
      <div><button type="button" class="btn btn-secondary btn-sm" data-a="ssAdd">${ic('plus', 13)}Add stage</button></div>
    </div>
  </form>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitStageSet">${m.edit ? 'Save changes' : 'Create stage set'}</button></div>`;
}
/* Edit the workspace's task labels (Settings > Labels): each label's name and color, in the order the picker lists them. The form is
   S.ui.lbform; what a click or a save refuses is under S.ui.errors.lblist, which is under the label lbrow is about, or under the list when
   lbrow is -1. Laid out as the stage set's rows are (they wrap on a phone). data-keep: the body scrolls, and a move or a removal
   re-renders it. */
export function labelsModal(H) {
  const f = S.ui.lbform;
  const e = S.ui.errors;
  const bad = e.lblist ? e.lbrow : -1; // the label the message under the list is about
  const err = (id, msg, st = '') =>
    msg ? `<span class="err" id="${id}" role="alert"${st ? ` style="${st}"` : ''}>${ic('circle-alert', 12)}${esc(msg)}</span>` : '';
  const last = f.labels.length - 1;
  const full = f.labels.length >= LABELS_MAX;
  const row = (l, i) => `<div style="margin-bottom:12px"><div class="row" role="group" aria-label="Label ${i + 1}" style="gap:6px 8px;flex-wrap:wrap">
      <span class="pdot" style="--c:${STAGE_COLORS[l.color]};border-radius:50%;width:10px;height:10px" aria-hidden="true"></span>
      <input class="input ${bad === i ? 'is-error' : ''}" id="lb-name-${i}" data-in="lbRow" data-i="${i}" data-f="name" value="${esc(l.name)}" maxlength="${LABEL_NAME_MAX}" placeholder="Label name" aria-label="Label ${i + 1} name" aria-invalid="${bad === i}"${bad === i ? ' aria-describedby="lb-row-err"' : ''} style="flex:1;min-width:140px">
      <select class="select" data-in="lbRow" data-i="${i}" data-f="color" aria-label="Label ${i + 1} color" style="width:auto">${Object.keys(STAGE_COLORS)
        .map(k => `<option value="${k}" ${l.color === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`)
        .join('')}</select>
      <span class="row" style="gap:2px;flex-wrap:nowrap;margin-left:auto">
        <button type="button" class="ibtn ibtn-sm" data-a="lbMove" data-i="${i}" data-v="up" ${i === 0 ? 'disabled' : ''} aria-label="Move label ${i + 1} up">${ic('arrow-up', 14)}</button>
        <button type="button" class="ibtn ibtn-sm" data-a="lbMove" data-i="${i}" data-v="down" ${i === last ? 'disabled' : ''} aria-label="Move label ${i + 1} down">${ic('arrow-down', 14)}</button>
        <button type="button" class="ibtn ibtn-sm" data-a="lbRemove" data-i="${i}" aria-label="Remove label ${i + 1}">${ic('trash-2', 14)}</button>
      </span>
    </div>${bad === i ? err('lb-row-err', e.lblist, 'margin-top:4px') : ''}</div>`;
  return `${H('Edit labels', 'Labels are for sorting a workspace’s tasks. Removing one takes it off every task that has it.')}
  <form class="modal-b" data-submit="submitLabels" data-keep="modal-labels">
    <div class="field"><span class="label">Labels, in order</span>
      ${f.labels.length ? f.labels.map(row).join('') : '<p class="faint" style="margin:0 0 12px">No labels.</p>'}
      ${bad < 0 ? err('lb-list-err', e.lblist) : ''}
      <div class="row" style="gap:8px"><button type="button" class="btn btn-secondary btn-sm" data-a="lbAdd" ${full ? 'disabled' : ''}>${ic('plus', 13)}Add label</button>${full ? `<span class="faint" style="font-size:12px">A workspace can have up to ${LABELS_MAX} labels</span>` : ''}</div>
    </div>
  </form>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitLabels">Save changes</button></div>`;
}
/* Who may open a project is decided on the server by `private` and `members` (the project access rules in server/pb_migrations). The
   level of access per person is not enforced anywhere yet (roles arrive in Phase 2), so the dialog does not offer one: everybody on the
   list can edit, and the only per-person choice that does something is removing them. */
export function shareModal(m, H) {
  const p = proj(m.id);
  const priv = !!p.private;
  return `${H(`Share “${esc(p.name)}”`)}
  <div class="modal-b">
    <form class="row" style="gap:6px" data-submit="shareInvite"><div class="grow"><label class="sr" for="share-in">Add people by name or email</label><input class="input" id="share-in" placeholder="Add people by name or email" value="${esc(S.ui.shareQ || '')}" data-in="shareQ" autofocus></div>
      <button class="btn btn-primary" data-a="shareInvite" type="button">Add</button></form>
    ${
      S.ui.shareQ
        ? `<div class="panel" style="padding:4px">${
            D()
              .members.filter(
                x => !p.members.includes(x.id) && (x.name.toLowerCase().includes(S.ui.shareQ.toLowerCase()) || x.email.includes(S.ui.shareQ.toLowerCase())),
              )
              .map(
                x =>
                  `<button class="mi" data-a="shareAdd" data-id="${esc(p.id)}" data-mid="${esc(x.id)}">${av(x.id, 'sm', false)}${esc(x.name)}<span class="r">${esc(x.email)}</span></button>`,
              )
              .join('') ||
            `<div class="mi faint" style="cursor:default">${S.ui.shareQ.includes('@') ? `No account for ${esc(S.ui.shareQ)}. Ask an admin to create one.` : 'No matching members'}</div>`
          }</div>`
        : ''
    }
    <div><div class="eyebrow" style="margin-bottom:4px">People with access</div>
      ${p.members
        .map(id => {
          const x = mem(id);
          if (!x) return '';
          return `<div class="row" style="height:44px">${av(id, 'md', false)}<div class="grow"><div style="font-weight:500;font-size:13px">${esc(x.name)}${id === D().me ? ' <span class="faint" style="font-weight:400">(you)</span>' : ''}</div><div class="faint" style="font-size:11.5px">${esc(x.email)}${id === p.lead ? ' · Project lead' : ''}</div></div>
          ${id === p.lead ? `<span class="muted" style="font-size:12.5px;padding-right:8px">Can edit</span>` : `<select class="select" style="width:auto;height:26px;font-size:12px;border-color:transparent;background-color:transparent" data-in="sharePerm" data-id="${esc(p.id)}" data-mid="${esc(id)}" aria-label="Access for ${esc(x.name)}"><option selected>Can edit</option><option value="__remove">Remove access</option></select>`}</div>`;
        })
        .join('')}
    </div>
    <div style="border-top:1px solid var(--divider);padding-top:12px"><div class="eyebrow" style="margin-bottom:8px">General access</div>
      <div class="row" style="gap:10px"><span class="ftype" style="--c:var(--text-2)">${ic(priv ? 'lock' : 'building-2', 14)}</span><div class="grow"><select class="select" style="height:28px;width:auto;border-color:transparent;padding-left:4px;font-weight:500" data-in="shareAccess" data-id="${esc(p.id)}" aria-label="General access"><option value="private" ${priv ? 'selected' : ''}>Only people invited</option><option value="workspace" ${priv ? '' : 'selected'}>Everyone at ${esc(D().ws.name)}</option></select><div class="faint" style="font-size:11.5px;padding-left:4px">${priv ? 'Only the people listed above, and admins, can open this project.' : 'Everyone in the workspace can open this project.'}</div></div></div></div>
  </div>
  <div class="modal-f"><button class="btn btn-secondary" data-a="copyLink" data-pid="${esc(p.id)}">${ic('link', 14)}Copy link</button><span class="sp"></span><button class="btn btn-primary" data-a="closeModal">Done</button></div>`;
}
/* m.body is HTML built by the caller (it uses <b>): callers must esc() anything that comes from stored data. */
export function confirmModal(m) {
  const needs = m.typeName;
  const ok = !needs || (S.ui.confirmText || '') === needs;
  return `<div class="modal-b" style="padding-top:18px;gap:10px">
    <div class="row" style="gap:12px;align-items:flex-start"><span class="ftype" style="--c:${m.danger ? 'var(--red)' : 'var(--amber)'};width:34px;height:34px;border-radius:9px">${ic(m.icon || (m.danger ? 'trash-2' : 'archive'), 17)}</span>
    <div class="grow"><h2 id="mt-confirm" style="font-size:15px;font-weight:600;margin:4px 0 6px">${esc(m.title)}</h2><p class="muted" style="margin:0;font-size:13px;line-height:1.55">${m.body}</p></div></div>
    ${needs ? `<div class="field" style="margin-top:6px"><label class="label" for="confirm-in" style="font-weight:400;color:var(--text-2)">Type <b style="color:var(--text);font-weight:600">${esc(needs)}</b> to confirm</label><input class="input" id="confirm-in" data-in="confirmText" autocomplete="off" autofocus value="${esc(S.ui.confirmText || '')}"></div>` : ''}
  </div>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal" ${needs ? '' : 'autofocus'}>Cancel</button><button class="btn ${m.danger ? 'btn-danger' : 'btn-primary'}" data-a="confirmOk" ${ok ? '' : 'disabled'}>${esc(m.ok)}</button></div>`;
}
export const SHORTCUTS = [
  [
    'General',
    [
      ['Command menu', [MOD, 'K']],
      ['Search', ['/']],
      ['Keyboard shortcuts', ['?']],
      ['Toggle sidebar', ['[']],
      ['Toggle dark mode', [MOD, 'Shift', 'L']],
      ['Close panel or dialog', ['Esc']],
    ],
  ],
  [
    'Create',
    [
      ['New task', ['N']],
      ['New project', ['P']],
      ['Submit form', [MOD, '↵']],
      ['Send comment', [MOD, '↵']],
    ],
  ],
  [
    'Navigate',
    [
      ['Go to Home', ['G', 'H']],
      ['Go to My Tasks', ['G', 'T']],
      ['Go to Projects', ['G', 'P']],
      ['Go to Inbox', ['G', 'I']],
      ['Go to Calendar', ['G', 'C']],
      ['Go to Settings', ['G', 'S']],
    ],
  ],
  [
    'Command menu',
    [
      ['Move selection', ['↑', '↓']],
      ['Run command', ['↵']],
      ['Search mode', ['Tab']],
    ],
  ],
];
export function shortcutsModal(H) {
  return `${H('Keyboard shortcuts')}<div class="modal-b" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px">${SHORTCUTS.map(([g, list]) => `<div><div class="eyebrow" style="margin-bottom:6px">${g}</div>${list.map(([n, k]) => `<div class="row" style="height:30px;font-size:13px;border-bottom:1px solid var(--divider)"><span class="grow">${n}</span>${k.map((x, i) => `${i && k[0] === 'G' ? '<span class="faint" style="font-size:11px">then</span>' : ''}<kbd>${x}</kbd>`).join('')}</div>`).join('')}</div>`).join('')}</div>`;
}
/* m.file is a files object (or, for an attachment that points to no file, the attachment itself); m.src is a file URL, set by
   openFilePreview in actions.js, for the raster images that get a real picture. Everything is stored data: names, types and sizes
   go through esc(). */
export function filePreviewModal(m, H) {
  const served = !!m.file.file; // there is a stored file behind it
  const live = served ? D().files.find(x => x.id === m.file.id) : null; // the current version: a rename elsewhere shows, a deletion is noticed
  const f = live || m.file;
  const gone = served && !live;
  const canDownload = served && !gone;
  const canLink = !!(live || D().files.find(x => x.id === m.file.id)); // a link names a files record; an attachment with none has no link
  const t = FT[f.type] || FT.other;
  const prev = filePrev(f, !gone && isRaster(f) ? m.src : '').replace('class="fprev"', 'class="fprev" style="aspect-ratio:16/9"');
  const note = gone ? 'This file was deleted.' : !served ? "This attachment isn't linked to an uploaded file, so there is nothing to download." : '';
  return `${H(esc(f.name), `${t.n} · ${esc(f.size)} · Uploaded by ${esc(nameOf(f.by))} ${ago(f.at)}`)}
  <div class="modal-b"><div style="border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">${prev}</div>
  ${note ? `<div class="alert info">${ic('info', 14)}<span>${note}</span></div>` : ''}
  ${m.tid ? `<div class="row faint" style="font-size:12.5px">${ic('link', 13)}Attached to <button class="link" data-a="openTask" data-id="${esc(m.tid)}">${esc(task(m.tid)?.title)}</button></div>` : ''}</div>
  <div class="modal-f">${canLink ? `<button class="btn btn-secondary" data-a="copyLink" data-fid="${esc(f.id)}">${ic('link', 14)}Copy link</button>` : ''}<span class="sp"></span><button class="btn ${canDownload ? 'btn-secondary' : 'btn-primary'}" data-a="closeModal">Close</button>${canDownload ? `<button class="btn btn-primary" data-a="downloadFile" data-id="${esc(f.id)}">${ic('download', 14)}Download</button>` : ''}</div>`;
}
