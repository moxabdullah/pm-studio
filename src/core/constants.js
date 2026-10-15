import { lookup } from './safe.js';

/* ---------- vocab ---------- */
/* Lookups keyed by stored values (status, priority, project status, colour name, label id) go through lookup():
   an unknown or hostile key gets a neutral entry (or undefined where there is no fallback) instead of crashing. */
export const STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
];
export const ST = lookup(Object.fromEntries(STATUSES.map(s => [s.id, s])), { id: 'unknown', name: 'Unknown' });
export const PRIOS = [
  { id: 'urgent', name: 'Urgent', w: 4 },
  { id: 'high', name: 'High', w: 3 },
  { id: 'medium', name: 'Medium', w: 2 },
  { id: 'low', name: 'Low', w: 1 },
  { id: 'none', name: 'No priority', w: 0 },
];
export const PR = lookup(Object.fromEntries(PRIOS.map(p => [p.id, p])), PRIOS[4]);
export const LABELS = [
  { id: 'design', name: 'Design', c: 'var(--violet)' },
  { id: 'frontend', name: 'Frontend', c: 'var(--blue)' },
  { id: 'backend', name: 'Backend', c: 'var(--teal)' },
  { id: 'research', name: 'Research', c: 'var(--amber)' },
  { id: 'content', name: 'Content', c: 'var(--rose)' },
  { id: 'bug', name: 'Bug', c: 'var(--red)' },
  { id: 'qa', name: 'QA', c: 'var(--green)' },
  { id: 'growth', name: 'Growth', c: 'var(--orange)' },
];
export const LB = lookup(Object.fromEntries(LABELS.map(l => [l.id, l])));
/* A project's health, a flag apart from its stage (stages are the workspace's own, see DEFAULT_STAGE_SET). */
export const HEALTH = lookup(
  {
    ok: { name: 'On track', c: 'var(--green)' },
    risk: { name: 'At risk', c: 'var(--red)' },
    hold: { name: 'On hold', c: 'var(--amber)' },
  },
  { name: 'On track', c: 'var(--green)' },
);
/* The colours a stage can have. A stage stores the key only; the CSS value comes from here, so a stage written through the API
   cannot put its own CSS into a style attribute. An unknown key reads as gray. normalize.js keeps a copy of the keys: change both
   together. */
export const STAGE_COLORS = lookup(
  {
    gray: 'var(--gray)',
    blue: 'var(--blue)',
    violet: 'var(--violet)',
    teal: 'var(--teal)',
    amber: 'var(--amber)',
    rose: 'var(--rose)',
    red: 'var(--red)',
    green: 'var(--green)',
    orange: 'var(--orange)',
  },
  'var(--gray)',
);
/* The stages a workspace has until it makes its own set (Settings > Stages > Customise copies these, with the same ids, so a project
   keeps its stage). `finished` stages leave the "Active" lists. */
export const DEFAULT_STAGE_SET = Object.freeze({
  id: 'builtin',
  name: 'Integrator job',
  stages: Object.freeze(
    [
      ['tender', 'Tender', 'gray', false],
      ['awarded', 'Awarded', 'violet', false],
      ['design', 'Design', 'blue', false],
      ['procurement', 'Procurement', 'teal', false],
      ['fat', 'FAT', 'amber', false],
      ['installation', 'Installation', 'orange', false],
      ['commissioning', 'Commissioning / SAT', 'rose', false],
      ['handover', 'Handover', 'green', false],
      ['warranty', 'Warranty', 'teal', false],
      ['closed', 'Closed', 'green', true],
      ['cancelled', 'Cancelled', 'gray', true],
      ['lost', 'Lost tender', 'gray', true],
    ].map(([id, name, color, finished]) => Object.freeze({ id, name, color, finished })),
  ),
});
export const PCOLORS = lookup({
  indigo: '#5A67D8',
  blue: '#3B82C4',
  violet: '#8662C9',
  teal: '#23918A',
  rose: '#C54B78',
  amber: '#C48A1E',
  green: '#3D8E5F',
  slate: '#6B7280',
});
export const PICONS = [
  'globe',
  'smartphone',
  'megaphone',
  'rocket',
  'component',
  'building-2',
  'layout-grid',
  'palette',
  'code',
  'briefcase',
  'target',
  'layers',
  'zap',
  'heart',
  'folder',
  'sparkles',
];
/* The longest name a project template can have: the Save as template prompt and the edit dialog stop typing there. */
export const TEMPLATE_NAME_MAX = 80;
/* The longest description a template can have: the edit dialog stops typing there. */
export const TEMPLATE_DESC_MAX = 1000;
/* How much a template holds: tasks in all, and subtasks in each task. Saving refuses a bigger project (subtasks beyond the limit are
   left out); normalize.js cuts what the server holds to the same numbers (a copy of them: it imports nothing from the app) and
   createProject() applies them again when it copies a template, so a template written through the API cannot make a huge project. */
export const TEMPLATE_TASKS_MAX = 300;
export const TEMPLATE_SUBTASKS_MAX = 50;
/* The most bytes a template's doc (everything but its name and workspace: icon, colour, description, tasks) may take, measured as a
   whole. The server refuses a template record over 2 MB (1791849606_templates.js) and this leaves a margin, so a project with long
   descriptions is refused when saving, not after. */
export const TEMPLATE_BYTES_MAX = 1.9 * 1024 * 1024;
/* How much stage data one workspace and one project can hold: stage sets in a workspace, stages in a set, the longest stage and set
   name (the editor stops typing there), and the entries of a project's stage history (the oldest go first). normalize.js cuts what
   the server holds to the same numbers (a copy of them, as with the template limits above): change both together, or a record is
   cut on reading and stays pending for ever. */
export const STAGE_SETS_MAX = 20;
export const STAGES_MAX = 30;
export const STAGE_NAME_MAX = 40;
export const STAGE_SET_NAME_MAX = 80;
export const STAGE_HISTORY_MAX = 200;
export const ROLES = ['Admin', 'Manager', 'Member'];
export const TEAMS_SEED = [
  { id: 'design', workspace: 'w1', name: 'Design', icon: 'palette', c: '#8662C9', desc: 'Product design, brand, and research' },
  { id: 'eng', workspace: 'w1', name: 'Engineering', icon: 'code', c: '#3B82C4', desc: 'Web, mobile, and platform engineering' },
  { id: 'mkt', workspace: 'w1', name: 'Marketing', icon: 'megaphone', c: '#C54B78', desc: 'Campaigns, content, and growth' },
  { id: 'product', workspace: 'w1', name: 'Product', icon: 'target', c: '#C48A1E', desc: 'Roadmap, planning, and QA' },
];
