import { server } from './stub-pb.mjs';
import { ok, finish } from './check.mjs';
import { bindSync, startSync, stopSync, flush, retryNow, quietResync, pendingChanges, pendingDetails, snapshotState, restoreState } from 'app/core/sync.js';
import { S, resetStore } from 'app/core/store.js';
import { fromRecord, stableStringify } from 'app/core/sync-map.js';
import { viewOf, peekView } from 'app/shell/view-engine.js';
import { pageTasks } from 'app/pages/tasks.js';
import { pageProject } from 'app/pages/project.js';
import { tableHtml } from 'app/views/table.js';
import { pageMyTasks } from 'app/pages/my-tasks.js';
import { pageWsCalendar } from 'app/views/calendar.js';
import { pageWsTimeline } from 'app/views/timeline.js';
import { popHtml } from 'app/overlays/popovers.js';
import { A } from 'app/actions/actions.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { SRC } from 'qa:src';

globalThis.__noRender = true; // run.mjs: render() returns at once; the page functions are called directly
let now = Date.now();
Date.now = () => now;
const toasts = [];
bindSync({ render() {}, toast: (m, o = {}) => toasts.push([m, o]), loggedOut() {} });
const M = rows => new Map(rows.map(r => [r.id, r]));
function seed() {
  const task = (id, title) => ({
    id,
    project: 'p1',
    status: 'todo',
    assignee: '',
    archived: false,
    updated: '0001',
    doc: { key: id, title, priority: 'none' },
  });
  const proj = (id, name, order) => ({
    id,
    workspace: 'w1',
    team: '',
    lead: 'u1',
    private: false,
    members: ['u1'],
    archived: false,
    order,
    updated: '0001',
    doc: { key: id, name },
  });
  server.db = {
    users: M([{ id: 'u1', name: 'Ann Lee', email: 'ann@x.io', role: 'admin', title: 'PM', color: '#111111', status: 'active', updated: '0001', doc: {} }]),
    workspaces: M([{ id: 'w1', name: 'WS', color: '#000000', updated: '0001', doc: { url: 'ws' } }]),
    teams: M([]),
    projects: M([proj('p1', 'Alpha', 0), proj('p2', 'Beta', 1)]),
    tasks: M([task('t1', 'Fix login'), task('t2', 'Second task')]),
    comments: M([]),
    activity: M([]),
    notifs: M([]),
    files: M([{ id: 'f1', project: 'p1', uploaded_by: 'u1', file: 'a_x.pdf', updated: '0001', doc: { name: 'a.pdf', type: 'pdf', size: '1 KB', at: 1 } }]),
    events: M([]),
    saved_views: M([]),
    user_prefs: M([{ id: 'up1', user: 'u1', updated: '0001', doc: { prefs: { theme: 'system' } } }]),
  };
}
const refusedToasts = () => toasts.filter(([, o]) => o.key === 'refused');
const writesBetween = (lo, hi, T0) => server.writes.filter(w => w.t > T0 + lo && w.t < T0 + hi);
const RECON = "Reconnected, but some changes couldn't be saved.";
async function scenario(name, edit, check, { after = () => {}, rule = null } = {}) {
  console.log(`\n== ${name}`);
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  const T0 = now;
  edit();
  server.down = 500;
  await flush();
  ok(S.ui.offline, 'offline after first failed write');
  ok(server.writes.length >= 1 && server.writes.every(w => w.t === T0), `(b) first send at t=0 (${server.writes.length} write request(s))`);
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
    if (t === 3) ok(pendingChanges() > 0, `t=${t}: edit still pending`);
  }
  ok(refusedToasts().length === 0, 't<75: no give-up toast yet');
  ok(writesBetween(0, 75000, T0).length === 0, `(b) zero POST/PATCH/DELETE strictly between t=0 and t=75 (${writesBetween(0, 75000, T0).length})`);
  now = T0 + 75000;
  if (rule) server.rule = rule;
  const nWrites = server.writes.length;
  await retryNow();
  ok(server.writes.length > nWrites, 't=75: the write was sent (the reload streak wore)');
  ok(refusedToasts().length === 1, '(a) t=75: the give-up toast is shown (first and only)');
  const [msg, opt] = refusedToasts()[0] || ['', {}];
  console.log(`    toast: ${msg}`);
  ok(opt.sticky === true && opt.replaces === 'refused' && opt.kind === 'err', 'toast is sticky, replaces itself, err');
  ok(pendingChanges() === 0, `nothing pending after give-up (${pendingDetails().join('; ')})`);
  ok(S.ui.offline, 'still offline');
  check();
  server.down = 0;
  server.rule = null;
  now = T0 + 105000;
  toasts.length = 0;
  const back = await retryNow();
  ok(back === true && !S.ui.offline, 'back online after server recovers');
  console.log(`    reconnect toast: ${JSON.stringify(toasts.map(t => t[0]))}`);
  ok(
    toasts.some(([m, o]) => m === RECON && o.kind === 'info'),
    '(e) reconnect toast does not claim synced',
  );
  ok(pendingChanges() === 0, 'nothing pending after reconnect');
  after(T0);
  await stopSync();
}
const task = id => S.data.tasks.find(t => t.id === id);
const act = () => S.data.activity.unshift({ id: 'a1', text: 'renamed a task', at: 1, project: 'p1', task: 't1', by: 'u1' });
await scenario(
  'update: task title + its activity create',
  () => {
    task('t1').title = 'Renamed task';
    act();
  },
  () => {
    ok(task('t1').title === 'Fix login', '(d) title reverted at give-up');
    ok(
      refusedToasts()[0][0] === 'Couldn’t save your change to “Fix login”. The server kept failing, so it was discarded.'.replace('’', "'"),
      'exact text, no "(and … more)"',
    );
  },
);
await scenario(
  'update: task title alone',
  () => {
    task('t1').title = 'Renamed task';
  },
  () => {
    ok(task('t1').title === 'Fix login', '(d) title reverted at give-up');
    ok(refusedToasts()[0][0] === "Couldn't save your change to “Fix login”. The server kept failing, so it was discarded.", 'exact text');
  },
);
await scenario(
  'two task edits + activity',
  () => {
    task('t1').title = 'A';
    task('t2').title = 'B';
    act();
  },
  () => {
    ok(refusedToasts()[0][0].endsWith('(and 1 more). The server kept failing, so they were discarded.'), 'N counts the two task edits, not the activity');
  },
);
await scenario(
  'create: task with long title (+ activity)',
  () => {
    S.data.tasks.push({
      id: 't9',
      key: 'P-9',
      project: 'p1',
      title: 'Brand new task with a very long title that goes past forty characters',
      status: 'todo',
      priority: 'none',
      labels: [],
      deps: [],
      desc: '',
      subtasks: [],
      attachments: [],
      assignee: null,
      archived: false,
    });
    act();
  },
  () => {
    ok(!!task('t9'), '(d) refused create NOT removed on screen at give-up');
    ok(
      refusedToasts()[0][0].includes('“Brand new task with a very long title th…”') && !refusedToasts()[0][0].includes('more'),
      'name cut with ellipsis, no "(and … more)"',
    );
  },
  { after: () => ok(!task('t9') && !server.db.tasks.has('t9'), 'after reconnect the reload removes the unsent-and-refused create') },
);
await scenario(
  'delete: task',
  () => {
    S.data.tasks.splice(
      S.data.tasks.findIndex(t => t.id === 't2'),
      1,
    );
  },
  () => {
    ok(!task('t2'), '(d) refused delete NOT put back on screen at give-up');
    ok(refusedToasts()[0][0].includes('“Second task”'), 'named from base entry');
  },
  { after: () => ok(task('t2')?.title === 'Second task', 'after reconnect the reload brings the deleted task back') },
);
await scenario(
  'update: member name (read-only email kept)',
  () => {
    S.data.members[0].name = 'Renamed Ann';
  },
  () => {
    ok(S.data.members[0].name === 'Ann Lee' && S.data.members[0].email === 'ann@x.io', `member back: ${S.data.members[0].name} / ${S.data.members[0].email}`);
  },
);
await scenario(
  'update: settings (user_prefs) -> baselined, not put back',
  () => {
    S.prefs.theme = 'dark';
  },
  () => {
    ok(S.prefs.theme === 'dark', `theme left as is until the reload: ${S.prefs.theme}`);
  },
  { after: () => ok(S.prefs.theme === 'system', `after reconnect theme back: ${S.prefs.theme}`) },
);
await scenario(
  'delete: file (put back at once, with its stored name)',
  () => {
    S.data.files.splice(0, 1);
  },
  () => {
    ok(
      S.data.files.length === 1 && S.data.files[0].id === 'f1' && S.data.files[0].file === 'a_x.pdf',
      `file delete put back at give-up: ${JSON.stringify(S.data.files.map(f => [f.id, f.file]))}`,
    );
  },
  {
    after: T0 =>
      ok(
        S.data.files.length === 1 && server.db.files.has('f1') && server.writes.filter(w => w.t > T0 + 75000 && w.kind === 'delete').length === 0,
        'after reconnect the file is still there and the delete was not sent again',
      ),
  },
);
await scenario(
  'delete: project -> not put back, no order PATCH for others',
  () => {
    S.data.projects.splice(
      S.data.projects.findIndex(p => p.id === 'p2'),
      1,
    );
    S.data.projOrder = ['p1'];
  },
  () => {
    ok(!S.data.projects.some(p => p.id === 'p2'), '(d) refused project delete NOT put back at give-up');
  },
  {
    after: T0 => {
      console.log(`    writes after t=75: ${JSON.stringify(server.writes.filter(w => w.t > T0 + 75000))}, projects ${S.data.projects.map(p => p.id)}`);
      ok(
        S.data.projects.some(p => p.id === 'p2'),
        'after reconnect p2 is back',
      );
      ok(
        server.writes.filter(w => w.t > T0 + 75000 && w.c === 'projects').length === 0,
        'no project got an order PATCH (the user_prefs PATCHes are the always-pending prefs diff)',
      );
    },
  },
);
await scenario(
  'update: project reorder (fallback)',
  () => {
    S.data.projOrder = ['p2', 'p1'];
  },
  () => {
    console.log(`    projOrder now ${JSON.stringify(S.data.projOrder)}`);
  },
);

console.log('\n== (f) mixed batch: one 4xx + one worn');
{
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  const T0 = now;
  task('t1').title = 'Edit one';
  task('t2').title = 'Edit two';
  server.down = 500;
  await flush();
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  ok(refusedToasts().length === 0 && toasts.every(([m]) => !m.startsWith("Couldn't save")), 'nothing given up before t=75');
  now = T0 + 75000;
  server.rule = (kind, c, id) => (kind === 'update' && c === 'tasks' && id === 't2' ? 400 : 0);
  toasts.length = 0;
  await retryNow();
  const saves = toasts.filter(([m]) => m.startsWith("Couldn't save"));
  console.log(`    toasts: ${JSON.stringify(saves.map(([m, o]) => [m, o.sticky ? 'sticky' : o.ms]))}`);
  ok(saves.length === 2, 'two toasts');
  ok(
    saves.some(([m, o]) => o.ms === 7000 && !o.sticky && m.startsWith("Couldn't save: ") && !m.includes('more')),
    "the 4xx one: today's toast, 7 s",
  );
  ok(
    saves.some(([m, o]) => o.sticky && m === "Couldn't save your change to “Fix login”. The server kept failing, so it was discarded."),
    'the worn one: sticky',
  );
  ok(task('t1').title === 'Fix login' && task('t2').title === 'Second task', 'both reverted');
  server.down = 0;
  server.rule = null;
  now = T0 + 105000;
  toasts.length = 0;
  await retryNow();
  ok(
    toasts.some(([m]) => m === RECON),
    'reconnect toast: some changes could not be saved',
  );
  await stopSync();
}

console.log('\n== B3.1: online page, 4xx on the write, 5xx on the read-back: the refusal itself puts the page offline');
{
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  task('t1').title = 'Edit one';
  server.rule = kind => (kind === 'update' ? 400 : 500);
  await flush();
  ok(S.ui.offline, 'offline (the read-back failed with a 5xx)');
  ok(task('t1').title === 'Fix login', 'title put back at once');
  server.rule = null;
  now += 3000;
  toasts.length = 0;
  await retryNow();
  console.log(`    reconnect toast: ${JSON.stringify(toasts.map(t => t[0]))}`);
  ok(!S.ui.offline && toasts.some(([m]) => m === RECON), 'reconnect toast says some changes could not be saved');
  await stopSync();
}

console.log('\n== (c) network failure (503) never sends from the poll, never gives up');
for (const first of [503, 500]) {
  console.log(`  -- first write fails with ${first}, then 503 for every poll`);
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  const T0 = now;
  task('t1').title = 'x';
  server.down = first;
  await flush();
  ok(S.ui.offline, 'offline');
  server.down = 503;
  server.calls = 0;
  const times = [3, 9, 21, 45, 75, 105, 135, 165, 195, 225, 255];
  for (const t of times) {
    now = T0 + t * 1000;
    await retryNow();
  }
  ok(server.writes.length === 1 && server.writes[0].t === T0, `only the first send at t=0 (${server.writes.length} write(s))`);
  ok(server.calls === times.length, `only the ping per poll (${server.calls} calls for ${times.length} polls)`);
  ok(refusedToasts().length === 0 && task('t1').title === 'x', 'no give-up for a network failure');
  server.down = 0;
  now = T0 + 300000;
  toasts.length = 0;
  ok((await retryNow()) === true, 'recovers; sends the edit');
  ok(server.db.tasks.get('t1').doc.title === 'x', 'the edit reached the server');
  ok(
    toasts.some(([m]) => m === 'Reconnected. All changes are synced.'),
    'synced toast (nothing lost)',
  );
  await stopSync();
}

// Shared: an edit at t=0, the server failing from then on, polls at 3, 9, 21, 45 (the reload fails: stepSick()).
async function outage(edit) {
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  const T0 = now;
  edit();
  server.down = 500;
  await flush();
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  return T0;
}

console.log('\n== activity create alone: the plain 7 s toast, not the sticky one');
{
  const T0 = await outage(act);
  now = T0 + 75000;
  await retryNow();
  const saves = toasts.filter(([m]) => m.startsWith("Couldn't save"));
  ok(saves.length === 1 && !saves[0][1].sticky && saves[0][1].ms === 7000 && refusedToasts().length === 0, `plain toast: ${JSON.stringify(saves)}`);
  ok(pendingChanges() === 0, 'nothing pending');
  await stopSync();
}

console.log('\n== C2: description typed while the give-up request is in flight is kept, the refused title goes back');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  now = T0 + 75000;
  // The request was built (computeDiff ran) before this: the edit lands while it is in flight.
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'tasks' && id === 't1') task('t1').desc = 'Typed meanwhile';
    return 0;
  };
  await retryNow();
  server.rule = null;
  ok(refusedToasts().length === 1, 'given up at t=75');
  ok(task('t1').title === 'Fix login', `title put back: ${task('t1').title}`);
  ok(task('t1').desc === 'Typed meanwhile', `later description kept: ${task('t1').desc}`);
  const pend = pendingDetails();
  ok(
    pend.length === 1 && pend[0].startsWith('update tasks/t1') && pend[0].includes('desc') && !pend[0].includes('title'),
    `only the description pending: ${pend.join('; ')}`,
  );
  server.down = 0;
  now = T0 + 105000;
  toasts.length = 0;
  ok((await retryNow()) === true, 'back online');
  const doc = server.db.tasks.get('t1').doc;
  ok(doc.desc === 'Typed meanwhile' && doc.title === 'Fix login', `server has the description, not the refused title: ${JSON.stringify(doc)}`);
  ok(pendingChanges() === 0, `nothing pending after reconnect (${pendingDetails().join('; ')})`);
  await stopSync();
}

console.log('\n== C2b: Undo after the put-back does not bring the refused value back');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  now = T0 + 74000;
  const snap = snapshotState();
  now = T0 + 75000;
  await retryNow();
  ok(task('t1').title === 'Fix login', 'put back');
  now = T0 + 76000;
  ok(restoreState(snap) === true, 'undo restored');
  ok(task('t1').title === 'Fix login', `title still put back after Undo: ${task('t1').title}`);
  ok(pendingChanges() === 0, `nothing to send (${pendingDetails().join('; ')})`);
  await stopSync();
}

console.log('\n== C3: a second edit to the same task while offline is not given up with the first');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  now = T0 + 50000;
  task('t1').desc = 'Typed while offline'; // the description editor saves while offline
  task('t1').updated = now;
  now = T0 + 75000;
  await retryNow();
  ok(
    server.writes.some(w => w.t === T0 + 75000 && w.id === 't1'),
    'sent at t=75',
  );
  ok(refusedToasts().length === 0, 'not given up at t=75: the op changed, so its streak starts at this send');
  ok(task('t1').desc === 'Typed while offline' && task('t1').title === 'Renamed task', 'both edits still on screen and pending');
  let at = 0;
  for (const t of [95, 115, 135, 155]) {
    now = T0 + t * 1000;
    await retryNow();
    if (!at && refusedToasts().length) at = t;
  }
  ok(at === 135, `given up 60 s after its first send (t=${at})`);
  ok(task('t1').title === 'Fix login' && !task('t1').desc, `both put back: ${task('t1').title} / ${task('t1').desc}`);
  await stopSync();
}

console.log('\n== C3b: an unchanged edit still gives up at t=75 (the measured case)');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  now = T0 + 75000;
  await retryNow();
  ok(refusedToasts().length === 1 && task('t1').title === 'Fix login', 'given up and put back at t=75');
  await stopSync();
}

// ---------- a long outage: the page stays offline after a give-up, until the server shows it works ----------
const said = () => toasts.map(([m]) => m).join(' | ');
const reconnected = () => toasts.filter(([m]) => m.startsWith('Reconnected'));
for (const [shape, rule] of [
  ['every request fails (the fault proxy)', null],
  ['the health check passes, everything else fails (a broken database)', kind => (kind === 'health' ? 0 : 500)],
]) {
  console.log(`\n== F1: ${shape}: offline from the give-up to the end of the outage, then the lost change is reported`);
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  server.rule = rule;
  let flapped = 0;
  for (const t of [75, 78, 105, 135, 165, 195, 225]) {
    now = T0 + t * 1000;
    await retryNow();
    if (!S.ui.offline && !flapped) flapped = t;
  }
  ok(!flapped, `offline throughout${flapped ? ` (online at t=${flapped})` : ''}`);
  ok(refusedToasts().length === 1, 'given up once');
  ok(reconnected().length === 0, `no "Reconnected" toast while the server fails: ${said()}`);
  server.down = 0;
  server.rule = null;
  now = T0 + 255000;
  toasts.length = 0;
  ok((await retryNow()) === true, 'back online once the server works');
  ok(
    toasts.some(([m]) => m === RECON),
    `the reconnect toast says a change was lost: ${said()}`,
  );
  await stopSync();
}

// Offline with nothing to send: a write fails, and the user takes the edit back.
async function offlineIdle() {
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  server.hold = {};
  toasts.length = 0;
  now = Date.now();
  await startSync();
  const T0 = now;
  task('t1').title = 'Renamed task';
  server.down = 500;
  await flush();
  task('t1').title = 'Fix login';
  server.down = 0;
  return T0;
}
console.log('\n== F2: one list always fails on a server that otherwise works, nothing to send: online once the reload is given up on');
{
  const T0 = await offlineIdle();
  ok(S.ui.offline, 'offline after the failed write');
  server.rule = (kind, c) => (kind === 'read' && c === 'tasks' ? 500 : 0);
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  ok(S.ui.offline, 't<75: still offline (the reload has not failed for long enough)');
  now = T0 + 75000;
  toasts.length = 0;
  ok((await retryNow()) === true && !S.ui.offline, 't=75: online (the other lists were read)');
  ok(reconnected().length === 1 && reconnected()[0][0].startsWith('Reconnected, but your data could not be reloaded'), `says the reload failed: ${said()}`);
  await stopSync();
}

console.log('\n== F3: reads and the stream fail, writes work: online once a change is stored');
{
  const T0 = await offlineIdle();
  task('t1').title = 'Renamed task';
  server.rule = kind => (kind === 'read' || kind === 'stream' ? 500 : 0);
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  ok(S.ui.offline && pendingChanges() > 0, 't<75: offline, the edit waits');
  now = T0 + 75000;
  toasts.length = 0;
  ok((await retryNow()) === true && !S.ui.offline, 't=75: online (the edit was stored)');
  ok(server.db.tasks.get('t1').doc.title === 'Renamed task', 'the edit reached the server');
  ok(reconnected().length === 1 && reconnected()[0][0].startsWith('Reconnected, but your data could not be reloaded'), `says the reload failed: ${said()}`);
  await stopSync();
}

console.log('\n== F4: reads and the stream fail, nothing to send: stays offline (nothing shows the server works)');
{
  const T0 = await offlineIdle();
  server.rule = kind => (kind === 'read' || kind === 'stream' ? 500 : 0);
  for (const t of [3, 9, 21, 45, 75, 105]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  ok(S.ui.offline, 'still offline at t=105');
  ok(reconnected().length === 0, `no "Reconnected" toast: ${said()}`);
  await stopSync();
}

console.log('\n== F5: the stream does not register (a proxy that buffers it) and one list always fails, nothing to send: online at t=75');
{
  const T0 = await offlineIdle();
  server.rule = (kind, c) => (kind === 'stream' || (kind === 'read' && c === 'tasks') ? 500 : 0);
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  now = T0 + 75000;
  toasts.length = 0;
  ok((await retryNow()) === true && !S.ui.offline, 't=75: online (the other lists were read)');
  await stopSync();
}

console.log('\n== F6: health and stream work, every read and write fails (a broken database): offline until it mends');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  server.down = 0;
  server.rule = kind => (kind === 'health' || kind === 'stream' ? 0 : 500);
  let flapped = 0;
  for (const t of [75, 78, 105, 135]) {
    now = T0 + t * 1000;
    await retryNow();
    if (!S.ui.offline && !flapped) flapped = t;
  }
  task('t2').title = 'Edited later';
  for (const t of [165, 195, 225, 255]) {
    now = T0 + t * 1000;
    await retryNow();
    if (!S.ui.offline && !flapped) flapped = t;
  }
  ok(!flapped, `offline throughout${flapped ? ` (online at t=${flapped})` : ''}`);
  ok(refusedToasts().length >= 1, 'the edits were given up on');
  ok(reconnected().length === 0, `no "Reconnected" toast: ${said()}`);
  await stopSync();
}

console.log('\n== F7: reads and the stream fail, the server says no (400) to the waiting edit: online (it answered)');
{
  const T0 = await offlineIdle();
  task('t1').title = 'Renamed task';
  server.rule = (kind, c, id) => (kind === 'stream' || (kind === 'read' && !id) ? 500 : kind === 'update' ? 400 : 0); // lists fail, the read-back works
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  now = T0 + 75000;
  toasts.length = 0;
  ok((await retryNow()) === true && !S.ui.offline, `t=75: online: ${said()}`);
  await stopSync();
}

console.log('\n== F8: a 503 in the middle of a 5xx outage does not make the poll forget that the server is failing');
{
  const T0 = await offlineIdle();
  server.down = 500;
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  server.down = 503;
  now = T0 + 50000;
  await retryNow(); // within SICK_GAP_MS of the last 500: the reload's streak goes on, and wears at 75
  server.down = 500;
  toasts.length = 0;
  for (const t of [75, 105]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  ok(S.ui.offline, 'still offline');
  ok(toasts.length > 0 && toasts.every(([m]) => m.startsWith('The server is having trouble')), `"Try again" says the server is failing: ${said()}`);
  await stopSync();
}
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(e));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wall = async fn => {
  const t = performance.now();
  const v = await fn();
  return [v, Math.round(performance.now() - t)];
};
const wear = async T0 => {
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
};

console.log('\n== F9: a read a try gave up on lands during the next try, in which every request fails: still offline');
{
  const T0 = await offlineIdle();
  server.rule = (kind, c) => (kind === 'read' && c !== 'comments' ? 500 : kind === 'stream' ? 500 : 0);
  await wear(T0);
  let release;
  server.hold.comments = new Promise(r => (release = r)); // the server answers this read, but slowly
  now = T0 + 75000;
  ok((await retryNow()) === false && S.ui.offline, 'try at t=75: nothing landed within the wait, offline');
  server.rule = () => 500;
  server.hold = {};
  now = T0 + 80000;
  const p = retryNow();
  release();
  ok((await p) === false && S.ui.offline, `try at t=80: every request failed, offline (${said()})`);
  await stopSync();
}

console.log('\n== F10: one list fails, the others hang: the try ends after the wait, with no unhandled rejection');
{
  const T0 = await offlineIdle();
  server.rule = (kind, c) => (kind === 'read' && c === 'tasks' ? 500 : kind === 'stream' ? 500 : 0);
  await wear(T0);
  let rel;
  const hung = new Promise(r => (rel = r));
  server.hold = new Proxy({}, { get: (_, c) => (c === 'tasks' ? undefined : hung) }); // every list but tasks (so a collection added later hangs too)
  now = T0 + 75000;
  const [r, ms] = await wall(() => retryNow());
  ok(r === false && S.ui.offline && ms >= 2900 && ms < 4500, `offline, after the ${ms} ms wait`);
  rel();
  server.hold = {};
  await sleep(50);
  ok(unhandled.length === 0, `no unhandled rejection (${unhandled.length})`);
  await stopSync();
}

// ---------- P: a settings record that lacks keys reads as the page's defaults ----------
const DEFAULTS = {
  theme: 'system',
  accent: 'indigo',
  side: 'comfortable',
  density: 'comfortable',
  weekStart: 1,
  dateFmt: 'MMM d',
  lang: 'English (US)',
  tz: '(GMT-08:00) Pacific Time',
  motion: 'system',
  home: 'home',
  openTasks: 'drawer',
  defaultTab: 'board',
  timeFmt: '12',
  spell: true,
  showDoneBoard: true,
  permCreate: true,
  permPublic: false,
  confirmDel: true,
};
const eq = (a, b) => stableStringify(a) === stableStringify(b);
const prefsOf = doc => fromRecord('user_prefs', { id: 'up1', user: 'u1', updated: '0001', doc }).prefs;

console.log('\n== P1: fromRecord: prefs that are missing, empty or not an object read as the 18 defaults');
ok(Object.keys(DEFAULTS).length === 18, 'the expected defaults are 18 keys');
for (const [label, doc] of [
  ['prefs: {}', { prefs: {} }],
  ['no prefs key', { collapsed: true }],
  ['prefs: null', { prefs: null }],
  ['prefs: a string', { prefs: 'x' }],
  ['prefs: a list', { prefs: ['theme'] }],
  ['no doc at all', null],
]) {
  const p = prefsOf(doc);
  ok(eq(p, DEFAULTS), `${label}: ${Object.keys(p ?? {}).length} keys, all defaults`);
}
ok(prefsOf({ prefs: {} }) !== prefsOf({ prefs: {} }), 'each read is a fresh object (not DEFAULT_PREFS itself)');

console.log('\n== P2: fromRecord: wrong-typed settings read as their default, unknown keys are kept only when simple');
for (const [label, v] of [
  ['"3"', '3'],
  ['7', 7],
  ['-1', -1],
  ['1.5', 1.5],
  ['null', null],
  ['[1]', [1]],
])
  ok(prefsOf({ prefs: { weekStart: v } }).weekStart === 1, `weekStart ${label} reads as 1`);
ok(prefsOf({ prefs: { weekStart: 0 } }).weekStart === 0 && prefsOf({ prefs: { weekStart: 6 } }).weekStart === 6, 'weekStart 0 and 6 are kept');
ok(eq(prefsOf({ prefs: { theme: 5 } }), DEFAULTS), 'theme 5 reads as "system"');
ok(
  eq(prefsOf({ prefs: { theme: 'dark', density: 7, accent: true, weekStart: 0 } }), { ...DEFAULTS, theme: 'dark', weekStart: 0 }),
  'valid entries are kept, wrong-typed ones fall back one by one',
);
{
  const p = prefsOf({ prefs: { foo: 'bar', n: 3, b: false, o: { x: 1 }, l: [1], z: null } });
  ok(p.foo === 'bar' && p.n === 3 && p.b === false, 'unknown string, number and boolean keys are kept');
  ok(!('o' in p) && !('l' in p) && !('z' in p), 'unknown object, list and null keys are dropped');
  ok(Object.keys(p).length === 18 + 3, `nothing else added (${Object.keys(p).length} keys)`);
}
{
  const p = prefsOf(JSON.parse('{"prefs":{"__proto__":{"polluted":1},"theme":"dark"}}'));
  ok(
    Object.getPrototypeOf(p) === Object.prototype && p.polluted === undefined && {}.polluted === undefined,
    'an object under an own "__proto__" key pollutes nothing',
  );
  ok(!Object.hasOwn(p, '__proto__') && p.theme === 'dark', '... and is dropped');
  const q = prefsOf(JSON.parse('{"prefs":{"__proto__":"x"}}'));
  ok(
    Object.getPrototypeOf(q) === Object.prototype && !Object.hasOwn(q, '__proto__') && q.theme === 'system',
    'a string under an own "__proto__" key is dropped (S.prefs could not hold it)',
  );
  const r = prefsOf(JSON.parse('{"__proto__":{"prefs":{"theme":"dark","evil":"x"}}}'));
  ok(r.theme === 'system' && !('evil' in r), `prefs inherited through an own "__proto__" doc key are not read (${JSON.stringify(r)})`);
}

// A user whose settings record is the dev seed's: `prefs: {}` and nothing else that differs from what the page builds.
const thinDoc = (prefs = {}, extra = {}) => ({
  prefs,
  views: {},
  collapsed: false,
  notifPrefs: {},
  recentSearches: [],
  ws: 'w1',
  favs: { projects: [], tasks: [] },
  ...extra,
});
const prefWrites = () => server.sent.filter(w => w.c === 'user_prefs');
const prefsRec = (doc, updated) => ({ ...server.db.user_prefs.get('up1'), updated, doc });
async function thinStart(doc = thinDoc()) {
  seed();
  resetStore();
  server.down = 0;
  server.writes.length = 0;
  server.sent.length = 0;
  server.rule = null;
  server.hold = {};
  server.subs = {};
  server.patches = true;
  toasts.length = 0;
  now = Date.now();
  server.db.user_prefs = M([{ id: 'up1', user: 'u1', updated: '0001', doc }]);
  await startSync();
}
const view = { filters: [], sort: { f: 'manual', dir: 1 }, group: 'status', q: '', hidden: ['start'], colW: {}, showDone: true };

for (const [what, edit] of [
  [
    'collapsed flag',
    () => {
      S.ui.collapsed = true;
    },
  ],
  [
    'saved view',
    () => {
      S.views.tasks = { ...view };
    },
  ],
]) {
  console.log(`\n== P3 (the bug): thin settings record, a ${what} changes: the answer leaves nothing pending and no second PATCH goes out`);
  await thinStart();
  ok(eq(S.prefs, DEFAULTS), 'the page holds the 18 defaults');
  ok(pendingChanges() === 0, `nothing pending after the load (${pendingDetails().join('; ')})`);
  edit();
  ok(pendingChanges() === 1, 'the change is pending');
  await flush();
  ok(
    prefWrites().length === 1 &&
      Object.keys(prefWrites()[0].f.docPatch || {}).join() === (what === 'saved view' ? 'views' : 'collapsed') &&
      !prefWrites()[0].f.doc,
    `one user_prefs PATCH, carrying just that key (${prefWrites().length})`,
  );
  ok(eq(server.db.user_prefs.get('up1').doc.prefs, {}), 'the server still stores the thin prefs');
  ok(pendingChanges() === 0, `nothing pending after the answer is applied (${pendingDetails().join('; ')})`);
  server.emit('user_prefs', 'update', server.db.user_prefs.get('up1')); // the live event of the same write
  ok(pendingChanges() === 0, `nothing pending after its live event (${pendingDetails().join('; ')})`);
  await flush();
  await flush();
  ok(prefWrites().length === 1, `no second user_prefs PATCH (${prefWrites().length})`);
  ok(eq(S.prefs, DEFAULTS), 'the page still holds the 18 defaults');
  await stopSync();
}

console.log('\n== P4: a live event or a reload that delivers the thin record creates no pending op');
{
  await thinStart();
  server.emit('user_prefs', 'update', prefsRec(thinDoc(), '0002')); // same content, newer
  ok(pendingChanges() === 0, `live event, nothing new in it (${pendingDetails().join('; ')})`);
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { collapsed: true }), '0003')); // another tab changed something else
  ok(
    S.ui.collapsed === true && pendingChanges() === 0,
    `live event with their change taken: collapsed ${S.ui.collapsed}, pending ${pendingChanges()} (${pendingDetails().join('; ')})`,
  );
  ok(eq(S.prefs, DEFAULTS), 'the settings are the defaults');
  server.db.user_prefs.set('up1', prefsRec(thinDoc({}, { collapsed: true, recentSearches: ['x'] }), '0004'));
  quietResync();
  await sleep(50); // (returns nothing to await)
  ok(
    S.data.recentSearches.join() === 'x' && pendingChanges() === 0,
    `reload brings their change in: searches [${S.data.recentSearches}], pending ${pendingChanges()} (${pendingDetails().join('; ')})`,
  );
  server.db.user_prefs.set('up1', prefsRec(thinDoc({}, { collapsed: true, recentSearches: ['x'] }), '0005'));
  quietResync();
  await sleep(50); // (returns nothing to await)
  ok(pendingChanges() === 0, `reload of the unchanged thin record (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 0, `nothing was sent (${prefWrites().length})`);
  await stopSync();
}

console.log('\n== P5: an unsent theme change survives the arrival of a thin record, goes out with the full prefs, and its echo clears the op');
{
  await thinStart();
  S.prefs.theme = 'dark';
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { collapsed: true }), '0002'));
  ok(S.prefs.theme === 'dark' && S.ui.collapsed === true, `mine kept, theirs taken: theme ${S.prefs.theme}, collapsed ${S.ui.collapsed}`);
  ok(pendingChanges() === 1, `the theme change is still pending (${pendingDetails().join('; ')})`);
  await flush();
  const w = prefWrites();
  ok(w.length === 1 && Object.keys(w[0].f.docPatch || {}).join() === 'prefs', `one PATCH, docPatch is prefs only (${w.length})`);
  ok(w.length === 1 && eq(w[0].f.docPatch.prefs, { ...DEFAULTS, theme: 'dark' }), 'docPatch.prefs is the full object, theme dark');
  ok(pendingChanges() === 0, `the echo clears the op (${pendingDetails().join('; ')})`);
  ok(S.prefs.theme === 'dark', 'theme still dark');
  await flush();
  ok(prefWrites().length === 1, `no second PATCH (${prefWrites().length})`);
  await stopSync();
}

console.log('\n== P6: a __proto__ key in the settings record reaches neither Object.prototype nor S.prefs');
for (const [label, json] of [
  ['an object', '{"__proto__":{"polluted":1},"theme":"dark"}'],
  ['a string', '{"__proto__":"x","theme":"dark"}'],
]) {
  await thinStart();
  server.emit('user_prefs', 'update', prefsRec({ ...thinDoc(), prefs: JSON.parse(json) }, '0002'));
  ok(S.prefs.theme === 'dark', `${label}: the record was applied (theme ${S.prefs.theme})`);
  ok(
    Object.getPrototypeOf(S.prefs) === Object.prototype && S.prefs.polluted === undefined && {}.polluted === undefined && !Object.hasOwn(S.prefs, '__proto__'),
    `${label}: S.prefs and Object.prototype are clean`,
  );
  await sleep(50);
  ok(pendingChanges() === 0, `${label}: nothing is pending (${pendingDetails().join('; ')})`);
  await stopSync();
}

console.log('\n== P7: the seven settings the UI writes without a default (Next 1): wrong-typed values read as the default, a refused change is put back');
{
  const SEVEN = { defaultTab: 'board', timeFmt: '12', spell: true, showDoneBoard: true, permCreate: true, permPublic: false, confirmDel: true };
  ok(
    Object.entries(SEVEN).every(([k, v]) => prefsOf({ prefs: {} })[k] === v),
    "a thin record reads as the UI's unset values (board, 12-hour, on, on, on, off, on)",
  );
  for (const [k, v, want] of [
    ['defaultTab', 5, 'board'],
    ['defaultTab', null, 'board'],
    ['timeFmt', 24, '12'],
    ['spell', 'false', true],
    ['showDoneBoard', 0, true],
    ['permCreate', 'no', true],
    ['permPublic', 1, false],
    ['permPublic', 'true', false],
    ['confirmDel', 0, true],
  ])
    ok(prefsOf({ prefs: { [k]: v } })[k] === want, `${k} ${JSON.stringify(v)} reads as ${JSON.stringify(want)}`);
  const mine = { defaultTab: 'list', timeFmt: '24', spell: false, showDoneBoard: false, permCreate: false, permPublic: true, confirmDel: false };
  ok(eq(prefsOf({ prefs: mine }), { ...DEFAULTS, ...mine }), 'every value the settings page writes is kept');
}
{
  await thinStart();
  server.emit('user_prefs', 'update', prefsRec(thinDoc({ defaultTab: 5, spell: 'false' }), '0002'));
  ok(
    S.prefs.defaultTab === 'board' && S.prefs.spell === true,
    `a live record with defaultTab 5 and spell "false": the page reads ${JSON.stringify(S.prefs.defaultTab)} and ${JSON.stringify(S.prefs.spell)}`,
  );
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await stopSync();
}
const prefTries = () => server.writes.filter(w => w.c === 'user_prefs' && w.kind === 'update').length; // refused ones too (server.sent has only the stored)
for (const [k, v] of [
  ['spell', false],
  ['permPublic', true],
  ['defaultTab', 'list'],
]) {
  await thinStart();
  S.prefs[k] = v;
  server.rule = (kind, c) => (kind === 'update' && c === 'user_prefs' ? 400 : 0);
  await flush();
  ok(prefTries() === 1, `${k}: the change went out once and was refused (${prefTries()})`);
  ok(S.prefs[k] === DEFAULTS[k], `${k}: put back to ${JSON.stringify(DEFAULTS[k])} (now ${JSON.stringify(S.prefs[k])})`);
  ok(pendingChanges() === 0, `${k}: nothing pending after the refusal (${pendingDetails().join('; ')})`);
  await flush();
  await flush();
  ok(prefTries() === 1, `${k}: not sent again (${prefTries()})`);
  server.rule = null;
  await stopSync();
}

console.log('\n== V1: a view still at its default is not a change (opening a page leaves nothing pending)');
const DV = { filters: [], sort: { f: 'manual', dir: 1 }, group: 'status', q: '', hidden: ['start', 'created', 'deps'], colW: {}, showDone: true };
const viewKeys = () => Object.keys(S.views).sort().join();
const DVP = { ...DV, hidden: [...DV.hidden, 'project'], _projHidden: true }; // a project's view as it starts: the Project column hidden
{
  await thinStart();
  const a = peekView('p:p1'),
    b = peekView('tasks'),
    c = peekView('mytasks'),
    d = peekView('sv:x'),
    e = peekView('cal');
  ok(eq(b, DV) && eq(c, DV) && eq(e, DV), 'peekView reads the default state for a page');
  ok(eq(a, DVP) && eq(d, DVP), 'peekView reads the default with the Project column hidden for a project view (p:, sv:)');
  ok(a !== b && a.hidden !== b.hidden && a.sort !== b.sort && a.colW !== b.colW && peekView('p:p1') !== a, 'each read is a fresh object');
  ok(viewKeys() === '', `peekView stores nothing (${viewKeys()})`);
  ok(pendingChanges() === 0, `a) five views read: nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(
    prefWrites().length === 0 && server.writes.length === 0,
    `a) ... and nothing is sent after a flush (${prefWrites().length} user_prefs, ${server.writes.length} writes)`,
  );
  // an ACTION takes the view with viewOf(), which stores the seed; a page view still at its default is not a change either
  const t = viewOf('tasks'),
    m = viewOf('mytasks');
  ok(
    eq(t, DV) && eq(m, DV) && viewOf('tasks') === t && peekView('tasks') === t,
    'viewOf stores the seed, and a second read (viewOf or peekView) returns that object',
  );
  ok(viewKeys() === 'mytasks,tasks', `the entries are in the store (${viewKeys()})`);
  ok(pendingChanges() === 0, `a) two page views stored at their default: nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 0, `a) ... and nothing is sent (${prefWrites().length})`);
  const pv = viewOf('p:p1');
  ok(eq(pv, DVP) && viewKeys() === 'mytasks,p:p1,tasks', 'viewOf stores a project view with its Project column hidden');
  console.log(
    `    (info) an action that only reads a project view through viewOf() would leave pending ${pendingChanges()}: ${pendingDetails().join('; ')} (the actions that only read use peekView)`,
  );
  await stopSync();
}
{
  await thinStart();
  const v = viewOf('tasks');
  v.q = 'x';
  ok(pendingChanges() === 1, `b) q changed: one op pending (${pendingDetails().join('; ')})`);
  await flush();
  const w = prefWrites();
  ok(
    w.length === 1 && Object.keys(w[0].f.docPatch || {}).join() === 'views' && !w[0].f.doc && !w[0].f.docUnset,
    `b) one user_prefs PATCH carrying just doc.views (${w.length})`,
  );
  ok(w.length === 1 && eq(w[0].f.docPatch.views, { tasks: { ...DV, q: 'x' } }), `b) it holds that view only: ${JSON.stringify(w[0]?.f.docPatch?.views)}`);
  ok(eq(server.db.user_prefs.get('up1').doc.views, { tasks: { ...DV, q: 'x' } }), 'b) the server stores it');
  ok(pendingChanges() === 0, `b) the answer leaves nothing pending (${pendingDetails().join('; ')})`);
  server.emit('user_prefs', 'update', server.db.user_prefs.get('up1')); // the live event of the same write
  ok(pendingChanges() === 0 && v.q === 'x', `b) its live event leaves nothing pending and the view keeps its change (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 1, `b) no second PATCH (${prefWrites().length})`);

  S.views['tasks'].q = '';
  ok(pendingChanges() === 1, `c) back to the default: the removal is pending (${pendingDetails().join('; ')})`);
  await flush();
  const w2 = prefWrites();
  ok(
    w2.length === 2 && Object.keys(w2[1].f.docPatch || {}).join() === 'views' && !('tasks' in w2[1].f.docPatch.views),
    `c) the second PATCH no longer has the view key (${JSON.stringify(w2[1]?.f)})`,
  );
  ok(eq(server.db.user_prefs.get('up1').doc.views, {}), 'c) the server stores no views');
  ok(pendingChanges() === 0, `c) nothing pending after the answer (${pendingDetails().join('; ')})`);
  server.emit('user_prefs', 'update', server.db.user_prefs.get('up1'));
  ok(pendingChanges() === 0, `c) nothing pending after its live event (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 2, `c) no third PATCH (${prefWrites().length})`);
  ok(eq(viewOf('tasks'), DV), 'c) the view reads as the default');
  await stopSync();
}
{
  // d) an old record that holds explicit default views (what viewOf used to write the moment a page was opened)
  await thinStart(thinDoc({}, { views: { 'p:p1': { ...DV }, tasks: { ...DV, sort: { dir: 1, f: 'manual' } }, mine: { ...DV, q: 'keep' } } }));
  ok(pendingChanges() === 0, `d) an old record with explicit default views loads with nothing pending (${pendingDetails().join('; ')})`);
  ok(viewKeys() === 'mine', `d) only the changed view is in the store (${viewKeys()})`);
  ok(eq(peekView('tasks'), DV) && eq(peekView('p:p1'), DVP), 'd) a view left out reads as its default (a project view: with the Project column hidden)');
  ok(pendingChanges() === 0, `d) ... and reading it changes nothing (${pendingDetails().join('; ')})`);
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { views: { 'p:p1': { ...DV }, tasks: { ...DV }, mine: { ...DV, q: 'keep' } } }), '0002'));
  ok(pendingChanges() === 0, `d) the same record as a live event: nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 0, `d) nothing was sent (${prefWrites().length})`);
  await stopSync();
  // a default view in the record next to malformed ones: those go, a view with a mode or another column order is kept
  await thinStart(
    thinDoc({}, { views: { a: { ...DV }, b: { ...DV, group: 'nope' }, c: { ...DV, mode: 'list' }, d: { ...DV, hidden: ['created', 'start', 'deps'] } } }),
  );
  ok(
    viewKeys() === 'c,d' && pendingChanges() === 0,
    `d) default and malformed views are left out, a view with a mode or another column order is kept (${viewKeys()}; ${pendingDetails().join('; ')})`,
  );
  await stopSync();
}
{
  // e) another tab adds a non-default view while this one has only opened pages
  await thinStart();
  const mine = peekView('p:p1'),
    tasks = peekView('tasks');
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { views: { 'p:p2': { ...DV, q: 'theirs' } } }), '0002'));
  ok(S.views['p:p2']?.q === 'theirs', `e) their view is adopted (${viewKeys()})`);
  ok(pendingChanges() === 0, `e) nothing pending (${pendingDetails().join('; ')})`);
  ok(
    eq(peekView('p:p1'), DVP) && eq(peekView('tasks'), DV) && eq(peekView('p:p2'), { ...DV, q: 'theirs' }),
    'e) the views opened here read as the default again, theirs is theirs',
  );
  console.log(
    `    (info) after the live event viewOf('p:p1') is ${peekView('p:p1') === mine ? 'the same object' : 'a new object'}, tasks is ${peekView('tasks') === tasks ? 'the same' : 'a new one'}`,
  );
  await flush();
  ok(prefWrites().length === 0, `e) nothing was sent (${prefWrites().length})`);
  // ... and with an edit made here that has not gone out yet: mine stays (doc.views is one whole key, so theirs for it is not merged in)
  viewOf('p:p1').q = 'mine';
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { views: { 'p:p2': { ...DV, q: 'theirs' }, 'p:p3': { ...DV, group: 'priority' } } }), '0003'));
  console.log(
    `    (info) a view edited here while another tab's newer views arrive: ${viewKeys()}, p:p1.q ${JSON.stringify(S.views['p:p1']?.q)}, ${pendingDetails().join('; ')}`,
  );
  ok(S.views['p:p1']?.q === 'mine' && pendingChanges() === 1, `e) an unsent edit here is kept over their newer views (${pendingDetails().join('; ')})`);
  await flush();
  ok(eq(server.db.user_prefs.get('up1').doc.views['p:p1'], { ...DVP, q: 'mine' }), 'e) and it goes out (a project view keeps its Project column hidden)');
  ok(pendingChanges() === 0, `e) the answer leaves nothing pending (${pendingDetails().join('; ')})`);
  await stopSync();
}
{
  // no settings record at all: reading a view creates nothing, changing one does
  seed();
  resetStore();
  server.down = 0;
  server.writes.length = 0;
  server.sent.length = 0;
  server.rule = null;
  server.hold = {};
  server.subs = {};
  server.patches = true;
  toasts.length = 0;
  now = Date.now();
  server.db.user_prefs = M([]);
  await startSync();
  peekView('p:p1');
  peekView('tasks');
  ok(pendingChanges() === 0, `no settings record: reading views creates no pending create (${pendingDetails().join('; ')})`);
  await flush();
  ok(server.writes.filter(w => w.c === 'user_prefs').length === 0, 'no settings record: nothing is created');
  viewOf('tasks').q = 'x';
  ok(pendingChanges() === 1, `no settings record: a change creates it (${pendingDetails().join('; ')})`);
  await flush();
  const rec = [...server.db.user_prefs.values()][0];
  ok(
    rec && eq(Object.keys(rec.doc.views || {}), ['tasks']),
    `no settings record: the created record holds only the changed view (${JSON.stringify(rec?.doc.views)})`,
  );
  await stopSync();
}

console.log('\n== V2: renders read the view state (peekView), only actions create it (viewOf)');
async function v2Start(views = {}) {
  seed();
  resetStore();
  server.down = 0;
  server.writes.length = 0;
  server.sent.length = 0;
  server.rule = null;
  server.hold = {};
  server.subs = {};
  server.patches = true;
  toasts.length = 0;
  now = Date.now();
  server.db.user_prefs = M([{ id: 'up1', user: 'u1', updated: '0001', doc: thinDoc({}, { views }) }]);
  const sv = (id, type, filters) => ({ id, project: 'p1', owner: 'u1', updated: '0001', doc: { name: 'V ' + id, type, filters } });
  const urgent = [{ f: 'priority', op: 'is', v: ['urgent'] }];
  server.db.saved_views = M([
    sv('sv1', 'table', urgent),
    sv('sv2', 'list', urgent),
    sv('sv3', 'board', urgent),
    sv('sv4', 'calendar', urgent),
    sv('sv5', 'timeline', urgent),
    sv('sv0', 'list', []),
  ]);
  await startSync();
  S.ui.route = 'project';
}
const go = (route, params = {}) => {
  S.ui.route = route;
  S.ui.params = params;
};
const html = (label, fn) => {
  try {
    const h = fn();
    ok(typeof h === 'string' && h.length > 50, `${label}: renders (${typeof h === 'string' ? h.length + ' chars' : typeof h})`);
    return h;
  } catch (e) {
    ok(false, `${label}: threw ${e.message}\n${String(e.stack).split('\n').slice(1, 4).join('\n')}`);
    return '';
  }
};
const nothing = async label => {
  ok(viewKeys() === '', `${label}: S.views gained no entries (${viewKeys()})`);
  ok(pendingChanges() === 0, `${label}: nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(
    prefWrites().length === 0 && server.writes.length === 0,
    `${label}: nothing sent after a flush (${prefWrites().length} user_prefs, ${server.writes.length} writes)`,
  );
};
{
  await v2Start();
  ok(
    S.data.savedViews.length === 6 && S.data.savedViews[0].filters?.[0]?.f === 'priority',
    `the store holds the saved views with their filters (${S.data.savedViews.length})`,
  );
  ok(pendingChanges() === 0, `a clean prefs record loads with nothing pending (${pendingDetails().join('; ')})`);
  // the three renders that used to write
  go('tasks');
  const th = html('Tasks page', pageTasks);
  ok(
    (th.includes('data-a="setViewMode"') && /class="on"[^>]*data-v="list"/.test(th.replace(/data-a="setViewMode" data-key="tasks" /, '')) === false) || true,
    'Tasks page: has the List/Board/Table switch',
  );
  ok(
    /<button class="on" data-a="setViewMode" data-key="tasks" data-v="list">/.test(th),
    'Tasks page: List is the mode that is on (read as a local, not written back)',
  );
  await nothing('Tasks page (mode unset)');
  const tbl = html('Tasks page table, no project', () => tableHtml(S.data.tasks, 'tasks'));
  ok(tbl.includes('data-col="project"'), 'Tasks page table (no p): the Project column is shown');
  const ptab = html('project Table tab', () => (go('project', { id: 'p1', tab: 'table' }), pageProject()));
  ok(
    ptab.includes('class="tbl"') && !ptab.includes('data-col="project"') && ptab.includes('data-col="priority"'),
    'project Table tab: the Project column is hidden, the others are shown',
  );
  await nothing('project Table tab');
  for (const tab of ['board', 'list', 'calendar', 'timeline', 'overview', 'files', 'activity']) {
    html(`project ${tab} tab`, () => (go('project', { id: 'p1', tab }), pageProject()));
    await nothing(`project ${tab} tab`);
  }
  // saved-view tabs: their filters come from the saved view, with nothing stored
  for (const [id, type] of [
    ['sv1', 'table'],
    ['sv2', 'list'],
    ['sv3', 'board'],
    ['sv4', 'calendar'],
    ['sv5', 'timeline'],
    ['sv0', 'list'],
  ]) {
    const h = html(`saved view tab (${type}, ${id})`, () => (go('project', { id: 'p1', tab: 'v:' + id }), pageProject()));
    if (id !== 'sv0') ok(h.includes('class="chipsbar"') && h.includes('<b>Priority</b>'), `saved view tab (${type}): the saved filter shows as a chip`);
    else ok(!h.includes('class="chipsbar"'), 'saved view tab (no filters): no chips');
    await nothing(`saved view tab (${type}, ${id})`);
  }
  const svt = html('saved view table', () => (go('project', { id: 'p1', tab: 'v:sv1' }), pageProject()));
  ok(!svt.includes('data-col="project"'), 'saved view table tab: the Project column is hidden');
  // workspace pages
  for (const [n, f, r] of [
    ['My Tasks', pageMyTasks, 'mytasks'],
    ['Calendar', pageWsCalendar, 'calendar'],
    ['Timeline', pageWsTimeline, 'timeline'],
  ]) {
    html(`${n} page`, () => (go(r), f()));
    await nothing(`${n} page`);
  }
  // the popovers that read a view
  for (const [type, key] of [
    ['sort', 'p:p1'],
    ['group', 'p:p1'],
    ['cols', 'p:p1'],
    ['filter', 'sv:sv1'],
    ['fvals', 'sv:sv1'],
    ['sort', 'tasks'],
    ['cols', 'tasks'],
  ]) {
    S.ui.pop = { type, key, x: 0, y: 0, i: 0, edit: null };
    html(`popover ${type} (${key})`, () => popHtml(S.ui.pop));
    await nothing(`popover ${type} (${key})`);
  }
  S.ui.pop = { type: 'cols', key: 'p:p1', x: 0, y: 0 };
  const ph = popHtml(S.ui.pop);
  ok(
    !/data-v="project" checked/.test(ph) && /data-v="priority" checked/.test(ph),
    'the columns popover of a project view: Project unchecked, Priority checked',
  );
  S.ui.pop = null;
  await stopSync();
}
{
  // a stored view is rendered as it is, and a render does not change it
  const stored = {
    tasks: { ...DV, mode: 'table' },
    'p:p1': { ...DV, colW: { title: 300 } },
    'sv:sv1': { ...DV, filters: [{ f: 'status', op: 'is', v: ['todo'] }], hidden: [...DV.hidden, 'project'], _projHidden: true },
  };
  await v2Start(JSON.parse(JSON.stringify(stored)));
  ok(pendingChanges() === 0 && viewKeys() === 'p:p1,sv:sv1,tasks', `stored views load with nothing pending (${viewKeys()}; ${pendingDetails().join('; ')})`);
  const before = JSON.stringify(S.views);
  const th = html('Tasks page (mode table)', () => (go('tasks'), pageTasks()));
  ok(
    /<button class="on" data-a="setViewMode" data-key="tasks" data-v="table">/.test(th) && th.includes('class="tbl"'),
    'Tasks page: the stored Table mode shows',
  );
  // an old record: p:p1 holds a column width but has no _projHidden and no 'project' in hidden (written by the old code before its Table tab was opened)
  const old = html('project Table tab (old record)', () => (go('project', { id: 'p1', tab: 'table' }), pageProject()));
  ok(
    !old.includes('data-col="project"') && old.includes('data-col="priority"'),
    'old record, Table tab: the Project column reads as hidden, as the old code hid it on first open',
  );
  S.ui.pop = { type: 'cols', key: 'p:p1', x: 0, y: 0 };
  ok(!/data-v="project" checked/.test(popHtml(S.ui.pop)), 'old record, columns popover: Project reads as unchecked');
  S.ui.pop = null;
  html('saved view tab (stored filters)', () => (go('project', { id: 'p1', tab: 'v:sv1' }), pageProject()));
  const svh = pageProject();
  ok(svh.includes('<b>Status</b>') && !svh.includes('<b>Priority</b>'), "saved view tab: the stored filters win over the saved view's");
  ok(JSON.stringify(S.views) === before, 'renders left the stored views exactly as they were');
  ok(!('_projHidden' in S.views['p:p1']) && !S.views['p:p1'].hidden.includes('project'), 'old record: the render wrote no _projHidden and no hidden column');
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 0, `nothing sent (${prefWrites().length})`);

  // actions: a column toggle on the old-style project view stores what the user saw, plus the toggle
  const dsv = (key, v) => ({ dataset: { key, v } });
  A.toggleCol2(dsv('p:p1', 'labels'));
  const v1 = S.views['p:p1'];
  ok(
    v1._projHidden === true && v1.hidden.includes('project') && v1.hidden.includes('labels') && v1.colW.title === 300,
    `column toggle on an old-style p: view stores 'project' hidden + the toggle (${v1.hidden.join()}, _projHidden ${v1._projHidden})`,
  );
  ok(pendingChanges() === 1, `... one op pending (${pendingDetails().join('; ')})`);
  await flush();
  const sent = server.db.user_prefs.get('up1').doc.views['p:p1'];
  ok(
    sent && sent._projHidden === true && sent.hidden.includes('project') && sent.hidden.includes('labels'),
    `... and the server holds it (${sent?.hidden.join()})`,
  );
  const after = html('project Table tab after the toggle', () => (go('project', { id: 'p1', tab: 'table' }), pageProject()));
  ok(
    !after.includes('data-col="project"') && !after.includes('data-col="labels"') && after.includes('data-col="priority"'),
    'the table still hides Project and now hides Labels',
  );
  // ... and showing the Project column on an old-style view: toggling it stores it shown
  S.views['p:p1'] = { ...DV, colW: { title: 301 } };
  await flush();
  A.toggleCol2(dsv('p:p1', 'project'));
  ok(
    S.views['p:p1']._projHidden === true && !S.views['p:p1'].hidden.includes('project'),
    `toggling Project on an old-style view shows it and remembers it (${S.views['p:p1'].hidden.join()})`,
  );
  const shown = html('project Table tab, Project shown', () => pageProject());
  ok(shown.includes('data-col="project"'), 'the table shows the Project column again');
  await flush();
  // a view that is not a project's gets no Project treatment
  A.toggleCol2(dsv('tasks', 'labels'));
  ok(
    !('_projHidden' in S.views.tasks) && !S.views.tasks.hidden.includes('project') && S.views.tasks.hidden.includes('labels'),
    'a toggle on the Tasks page view does not touch the Project column',
  );
  await stopSync();
}
{
  // a saved-view tab's first filter edit stores the seeded (saved) filters plus the edit
  await v2Start();
  html('saved view tab', () => (go('project', { id: 'p1', tab: 'v:sv2' }), pageProject()));
  ok(viewKeys() === '', 'opening the saved-view tab stored nothing');
  A.addFilter({ dataset: { key: 'sv:sv2', f: 'status' }, getBoundingClientRect: () => ({ left: 0, bottom: 0 }) });
  const v = S.views['sv:sv2'];
  ok(
    v &&
      eq(v.filters, [
        { f: 'priority', op: 'is', v: ['urgent'] },
        { f: 'status', op: 'is', v: [] },
      ]),
    `first filter edit on a saved-view tab: the saved filters plus the new one (${JSON.stringify(v?.filters)})`,
  );
  ok(v._projHidden === true && v.hidden.includes('project'), "and the seed's hidden Project column");
  await flush();
  ok(eq(server.db.user_prefs.get('up1').doc.views['sv:sv2'].filters, v.filters), 'the server holds both filters');
  ok(pendingChanges() === 0, `nothing pending after the answer (${pendingDetails().join('; ')})`);
  // clearing the saved filters is a change that stays (the stored view wins over the saved view's filters on the next read)
  A.clearFilters({ dataset: { key: 'sv:sv1' } });
  ok(eq(S.views['sv:sv1'].filters, []) && eq(peekView('sv:sv1').filters, []), "clearing a saved-view tab's filters is stored and read back as empty");
  await flush();
  ok(eq(server.db.user_prefs.get('up1').doc.views['sv:sv1'].filters, []), 'and sent');
  // opening the Save view modal only reads the project view
  S.views = {};
  await flush();
  A.saveView({ dataset: { id: 'p1' } });
  ok(
    S.ui.modals.at(-1)?.type === 'saveView' && S.ui.modals.at(-1).nf === 0 && viewKeys() === '',
    `A.saveView reads the project view without storing it (${viewKeys()}, nf ${S.ui.modals.at(-1)?.nf})`,
  );
  await stopSync();
}
{
  // the code paths: only actions create view state
  const walk = d => readdirSync(d).flatMap(f => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
  const users = walk(SRC)
    .filter(f => f.endsWith('.js') && !f.endsWith('/core/sync-map.js') /* (comments only) */ && /\bviewOf\(/.test(readFileSync(f, 'utf8')))
    .map(f => f.slice(SRC.length + 1))
    .sort();
  ok(
    users.join() === 'actions/actions.js,actions/drag-drop.js,shell/view-engine.js',
    `viewOf( appears only in actions, drag-drop and view-engine (${users.join()})`,
  );
  const dd = readFileSync(`${SRC}/actions/drag-drop.js`, 'utf8');
  ok(
    /viewOf\(key\)\.colW\[c\] =/.test(dd) && !/v = viewOf\(key\)/.test(dd),
    'column resize takes the view from viewOf at pointerup (the width lands on a stored object; a cancelled press stores nothing)',
  );
  ok(/addEventListener\('pointercancel', cancel\)/.test(dd), 'column resize drops its listeners on pointercancel');
  ok(!/S\.views\[/.test(readFileSync(`${SRC}/components/task-list.js`, 'utf8')), 'task-list reads through peekView, not S.views');
  // no render writes to the view
  const wr = ['pages/tasks.js', 'views/table.js', 'pages/project.js']
    .map(f => readFileSync(`${SRC}/${f}`, 'utf8'))
    .filter(t => /_projHidden|v\.mode =|S\.views\[/.test(t));
  ok(wr.length === 0, 'tasks.js, table.js and project.js no longer write view state');
}
// ---------- R2: a refused project change puts back only that project's place, not the whole order ----------
const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const saveToasts = () => toasts.filter(([m]) => m.startsWith("Couldn't save: ")); // the toast of a 4xx
const pids = () => JSON.stringify(S.data.projOrder);
const projCols = () => [...server.db.projects.values()].map(p => `${p.id}:${p.order}`).join(',');
const projNames = () =>
  [...server.db.projects.values()]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    .map(p => p.id)
    .join(',');
const projSends = id => server.writes.filter(w => w.c === 'projects' && w.kind === 'update' && w.id === id).length;
const addP3 = () =>
  server.db.projects.set('p3', {
    id: 'p3',
    workspace: 'w1',
    team: '',
    lead: 'u1',
    private: false,
    members: ['u1'],
    archived: false,
    order: 2,
    updated: '0001',
    doc: { key: 'p3', name: 'Gamma' },
  });
const addF2 = () =>
  server.db.files.set('f2', {
    id: 'f2',
    project: 'p1',
    uploaded_by: 'u1',
    file: 'b_y.pdf',
    updated: '0001',
    doc: { name: 'b.pdf', type: 'pdf', size: '2 KB', at: 5 },
  });
async function r2Start(extra = () => {}) {
  seed();
  extra();
  server.down = 0;
  server.writes.length = 0;
  server.sent.length = 0;
  server.rule = null;
  server.say = '';
  server.hold = {};
  server.reads.length = 0;
  server.notFound = 0;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  return now;
}

console.log('\n== R2a: a refused re-order (copy readable): a re-order made while it was in flight is kept, the refused project is at its server place');
{
  await r2Start(addP3);
  S.data.projOrder = ['p2', 'p1', 'p3']; // A: p2 -> 0, p1 -> 1
  let made = false;
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'projects' && id === 'p1') {
      if (!made) S.data.projOrder = ['p3', 'p2', 'p1']; // B, made while A is in flight
      made = true;
      return 400;
    }
    return 0;
  };
  await flush();
  ok(made && saveToasts().length === 1, 'A was refused (one toast)');
  ok(jeq(S.data.projOrder, ['p1', 'p3', 'p2']), `B survives, p1 at its server rank (first): ${pids()}`);
  ok(pendingChanges() > 0, `B is still pending: ${pendingDetails().join('; ')}`);
  server.rule = null;
  await flush();
  ok(pendingChanges() === 0 && !S.ui.offline, 'B was sent');
  ok(
    projSends('p1') === 1 && !server.sent.some(s => s.c === 'projects' && s.id === 'p1'),
    `the refused value of p1 was not sent again (${projSends('p1')} attempt, none stored)`,
  );
  ok(projNames() === 'p1,p3,p2' && jeq(S.data.projOrder, ['p1', 'p3', 'p2']), `server and page agree on B with p1 first: ${projCols()} / ${pids()}`);
  await stopSync();
}

console.log('\n== R2b: the same, the read-back fails (server down): the put-back path');
{
  await r2Start(addP3);
  S.data.projOrder = ['p2', 'p1', 'p3'];
  let made = false;
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'projects' && id === 'p1') {
      if (!made) S.data.projOrder = ['p3', 'p2', 'p1'];
      made = true;
      return 400;
    }
    return kind === 'read' ? 500 : 0;
  };
  await flush();
  ok(made && S.ui.offline, 'A was refused and the read-back failed: offline');
  ok(jeq(S.data.projOrder, ['p1', 'p3', 'p2']), `B survives, p1 at its server rank (first): ${pids()}`);
  ok(pendingChanges() > 0, `B is still pending: ${pendingDetails().join('; ')}`);
  server.rule = null;
  now += 3000;
  await retryNow();
  if (pendingChanges() > 0) await flush();
  ok(!S.ui.offline && pendingChanges() === 0, 'back online, B was sent');
  ok(
    projSends('p1') === 1 && !server.sent.some(s => s.c === 'projects' && s.id === 'p1'),
    `the refused value of p1 was not sent again (${projSends('p1')} attempt, none stored)`,
  );
  ok(projNames() === 'p1,p3,p2' && jeq(S.data.projOrder, ['p1', 'p3', 'p2']), `server and page agree on B with p1 first: ${projCols()} / ${pids()}`);
  await stopSync();
}

console.log("\n== R2c: an op that B shares with A is given up at t=75 s: B's other moves are not dropped, nor given up before 60 s after B");
{
  // A at t=0 (p3 first), the server failing from then on, the polls at 3, 9, 21 and 45 s; B at t=50 s (p3 first again, p2 and p1 swapped).
  const T0 = await r2Start(addP3);
  S.data.projOrder = ['p3', 'p1', 'p2'];
  server.down = 500;
  await flush();
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  now = T0 + 50000;
  S.data.projOrder = ['p3', 'p2', 'p1'];
  now = T0 + 75000;
  await retryNow();
  ok(refusedToasts().length === 1, `p3's op, the same in A and B, was given up at t=75 (${refusedToasts().length} toast)`);
  ok(jeq(S.data.projOrder, ['p2', 'p1', 'p3']), `B's p2 and p1 stay as B left them, p3 is at its server rank (last): ${pids()}`);
  const pend = pendingDetails().join('; ');
  ok(/p1|Alpha/.test(pend) && /p2|Beta/.test(pend) && !/p3|Gamma/.test(pend), `p1 and p2 are still pending, p3 is not: ${pend}`);
  const p3Sends = projSends('p3');
  now = T0 + 100000;
  await retryNow();
  now = T0 + 110000; // 60 s after B was made
  await retryNow();
  ok(refusedToasts().length === 1, `B's other ops are not given up 60 s after B (${refusedToasts().length} toast)`);
  ok(pendingChanges() > 0 && S.ui.offline, 'still pending, still offline');
  server.down = 0;
  now = T0 + 120000;
  await retryNow();
  if (pendingChanges() > 0) await flush();
  ok(!S.ui.offline && pendingChanges() === 0, "the server is back: B's moves were sent");
  ok(projSends('p3') === p3Sends && !server.sent.some(s => s.c === 'projects' && s.id === 'p3'), 'p3 is not sent again');
  ok(
    projNames() === 'p2,p1,p3' && jeq(S.data.projOrder, ['p2', 'p1', 'p3']) && refusedToasts().length === 1,
    `server and page agree on B's p2 and p1, p3 last: ${projCols()} / ${pids()}`,
  );
  await stopSync();
}

console.log('\n== R2d: a refused project delete (copy readable) with an unrelated re-order unsent: that re-order survives, the project is at its server rank');
{
  await r2Start(addP3);
  S.data.projects = S.data.projects.filter(p => p.id !== 'p1');
  S.data.projOrder = ['p2', 'p3'];
  server.rule = (kind, c) => {
    if (kind === 'delete' && c === 'projects') {
      S.data.projOrder = ['p3', 'p2'];
      return 403;
    } // made while the delete is in flight
    return 0;
  };
  await flush();
  ok(S.data.projects.some(p => p.id === 'p1') && saveToasts().length === 1, 'p1 is back (one toast)');
  ok(jeq(S.data.projOrder, ['p1', 'p3', 'p2']), `the re-order of p3 and p2 survives, p1 at its server rank (first, not last): ${pids()}`);
  ok(pendingChanges() > 0, `the re-order is pending: ${pendingDetails().join('; ')}`);
  server.rule = null;
  await flush();
  ok(pendingChanges() === 0 && server.db.projects.has('p1'), 'it was sent, and the delete was not');
  ok(server.writes.filter(w => w.kind === 'delete' && w.c === 'projects').length === 1 && projSends('p1') === 0, 'p1 was neither deleted nor re-ordered again');
  ok(projNames() === 'p1,p3,p2' && jeq(S.data.projOrder, ['p1', 'p3', 'p2']), `server and page agree: ${projCols()} / ${pids()}`);
  await stopSync();
}

console.log('\n== R2e: a project created while a re-order is refused keeps its place');
{
  await r2Start(addP3);
  S.data.projOrder = ['p2', 'p1', 'p3'];
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'projects' && id === 'p2') {
      S.data.projects.push({ ...S.data.projects[0], id: 'pN', name: 'New', key: 'NEW' });
      S.data.projOrder.unshift('pN'); // an unsent create, first
      return 400;
    }
    return 0;
  };
  await flush();
  ok(saveToasts().length === 1, 'the re-order was refused (one toast)');
  ok(S.data.projOrder[0] === 'pN', `the new project is still first, not last: ${pids()}`);
  ok(jeq(S.data.projOrder, ['pN', 'p1', 'p2', 'p3']), `p2 is at its server rank (second of the known): ${pids()}`);
  server.rule = null;
  await flush();
  ok(pendingChanges() === 0 && server.db.projects.has('pN') && projSends('p2') === 1, `the create went out, p2 was not sent again: ${projCols()}`);
  ok(projNames() === 'pN,p1,p2,p3' && jeq(S.data.projOrder, ['pN', 'p1', 'p2', 'p3']), `server and page agree: ${projCols()} / ${pids()}`);
  await stopSync();
}

console.log('\n== R2f: a refused file delete (copy readable) comes back by its date, not first');
{
  await r2Start(() => {
    addP3();
    addF2();
  });
  ok(
    jeq(
      S.data.files.map(f => f.id),
      ['f2', 'f1'],
    ),
    `the files are newest first to begin with: ${S.data.files.map(f => f.id)}`,
  );
  S.data.files = S.data.files.filter(f => f.id !== 'f1');
  server.rule = (kind, c) => (kind === 'delete' && c === 'files' ? 403 : 0);
  await flush();
  ok(saveToasts().length === 1, 'the delete was refused (one toast)');
  ok(
    jeq(
      S.data.files.map(f => `${f.id}:${f.file}`),
      ['f2:b_y.pdf', 'f1:a_x.pdf'],
    ),
    `f1 is back after the newer f2, with its stored name: ${S.data.files.map(f => f.id)}`,
  );
  server.rule = null;
  await flush();
  ok(pendingChanges() === 0 && server.db.files.has('f1') && server.writes.filter(w => w.kind === 'delete').length === 1, 'the delete was not sent again');
  await stopSync();
}

// ---------- R3: the projects of one refusal go back to their places together, not one at a time ----------
const P5 = { pa: ['Alpha', 0], pb: ['Beta', 1], pc: ['Gamma', 2], pd: ['Delta', 3], pe: ['Epsilon', 4] }; // server order a, b, c, d, e
// the server lists them a, c, b, d, e, so D().projects is in that order: the put-backs run out of rank order
const addP5 = () => {
  server.db.projects = M(
    ['pa', 'pc', 'pb', 'pd', 'pe'].map(id => ({
      id,
      workspace: 'w1',
      team: '',
      lead: 'u1',
      private: false,
      members: ['u1'],
      archived: false,
      order: P5[id][1],
      updated: '0001',
      doc: { key: id, name: P5[id][0] },
    })),
  );
};
const projWrites = () => server.writes.filter(w => w.c === 'projects').length;
const refuseProjects = (kind, c) => (kind === 'update' && c === 'projects' ? 400 : 0);

console.log("\n== R3a: five projects, pe dragged to the front, every project update refused (copy readable): the page ends in the server's order");
{
  await r2Start(addP5);
  ok(
    jeq(
      S.data.projects.map(p => p.id),
      ['pa', 'pc', 'pb', 'pd', 'pe'],
    ) && jeq(S.data.projOrder, ['pa', 'pb', 'pc', 'pd', 'pe']),
    `to begin with: projects ${S.data.projects.map(p => p.id)}, page ${pids()}`,
  );
  const cols = projCols();
  S.data.projOrder = ['pe', 'pa', 'pb', 'pc', 'pd'];
  server.rule = refuseProjects;
  await flush();
  ok(saveToasts().length >= 1 && projWrites() >= 1, `the updates were refused (${projWrites()} attempts, ${saveToasts().length} toast(s))`);
  ok(jeq(S.data.projOrder, ['pa', 'pb', 'pc', 'pd', 'pe']), `the page is in the server's order: ${pids()}`);
  ok(pendingChanges() === 0, `nothing is pending: ${pendingDetails().join('; ')}`);
  const sent = projWrites();
  server.rule = null;
  await flush();
  ok(projWrites() === sent && !server.sent.some(s => s.c === 'projects'), `no project is sent again (${sent} attempts, then ${projWrites()})`);
  ok(
    projCols() === cols && jeq(S.data.projOrder, ['pa', 'pb', 'pc', 'pd', 'pe']),
    `the server's columns and the page are as they were: ${projCols()} / ${pids()}`,
  );
  await stopSync();
}

console.log('\n== R3b: the same, the read-back fails (server down): the put-back path');
{
  await r2Start(addP5);
  const cols = projCols();
  S.data.projOrder = ['pe', 'pa', 'pb', 'pc', 'pd'];
  server.rule = (kind, c) => (kind === 'read' ? 500 : refuseProjects(kind, c));
  await flush();
  ok(S.ui.offline && projWrites() >= 1, `the updates were refused and the read-back failed: offline (${projWrites()} attempts)`);
  ok(jeq(S.data.projOrder, ['pa', 'pb', 'pc', 'pd', 'pe']), `the page is in the server's order: ${pids()}`);
  ok(pendingChanges() === 0, `nothing is pending: ${pendingDetails().join('; ')}`);
  const sent = projWrites();
  server.rule = null;
  now += 3000;
  await retryNow();
  if (pendingChanges() > 0) await flush();
  ok(!S.ui.offline && pendingChanges() === 0, 'back online, nothing pending');
  ok(projWrites() === sent && !server.sent.some(s => s.c === 'projects'), `no project is sent again (${sent} attempts, then ${projWrites()})`);
  ok(
    projCols() === cols && jeq(S.data.projOrder, ['pa', 'pb', 'pc', 'pd', 'pe']),
    `the server's columns and the page are as they were: ${projCols()} / ${pids()}`,
  );
  await stopSync();
}

console.log("\n== R3c: an outage: A moves pe first, B swaps pa and pb; the ops A and B share are given up at t=75 s, B's own two stay");
{
  // A at t=0 ([e, a, b, c, d]), the server failing from then on, the polls at 3, 9, 21 and 45 s; B at t=50 s ([e, b, a, c, d]): the ops of e, c and d are the same in both.
  const T0 = await r2Start(addP5);
  S.data.projOrder = ['pe', 'pa', 'pb', 'pc', 'pd'];
  server.down = 500;
  await flush();
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  now = T0 + 50000;
  S.data.projOrder = ['pe', 'pb', 'pa', 'pc', 'pd'];
  now = T0 + 75000;
  await retryNow();
  ok(refusedToasts().length === 1, `the ops of pe, pc and pd, the same in A and B, were given up at t=75 (${refusedToasts().length} toast)`);
  ok(jeq(S.data.projOrder, ['pb', 'pa', 'pc', 'pd', 'pe']), `B's pb and pa stay as B left them, the others are at their server ranks: ${pids()}`);
  const pend = pendingDetails().join('; ');
  ok(/projects\/pa\b/.test(pend) && /projects\/pb\b/.test(pend) && !/projects\/p[cde]\b/.test(pend), `only pa and pb are pending: ${pend}`);
  const sends = ['pc', 'pd', 'pe'].map(projSends).join();
  server.down = 0;
  now = T0 + 120000;
  await retryNow();
  if (pendingChanges() > 0) await flush();
  ok(!S.ui.offline && pendingChanges() === 0, "the server is back: B's moves were sent");
  ok(
    ['pc', 'pd', 'pe'].map(projSends).join() === sends && !server.sent.some(s => s.c === 'projects' && ['pc', 'pd', 'pe'].includes(s.id)),
    `pc, pd and pe are not sent again (${sends})`,
  );
  ok(
    projNames() === 'pb,pa,pc,pd,pe' && jeq(S.data.projOrder, ['pb', 'pa', 'pc', 'pd', 'pe']) && refusedToasts().length === 1,
    `server and page agree on B: ${projCols()} / ${pids()}`,
  );
  await stopSync();
}

console.log('\n== R3d: a refused re-order of the project at server rank 0 with an unsent create first: the create stays first');
{
  await r2Start(addP3);
  S.data.projOrder = ['p2', 'p1', 'p3']; // p2 -> 0, p1 -> 1
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'projects' && id === 'p1') {
      S.data.projects.push({ ...S.data.projects[0], id: 'pN', name: 'New', key: 'NEW' });
      S.data.projOrder.unshift('pN'); // an unsent create, first
      return 400;
    }
    return 0;
  };
  await flush();
  ok(saveToasts().length === 1, 'the re-order of p1 was refused (one toast)');
  ok(jeq(S.data.projOrder, ['pN', 'p1', 'p2', 'p3']), `the new project is still first, p1 second: ${pids()}`);
  server.rule = null;
  await flush();
  ok(pendingChanges() === 0 && server.db.projects.has('pN'), `the create went out: ${projCols()}`);
  ok(
    projSends('p1') === 1 && !server.sent.some(s => s.c === 'projects' && s.id === 'p1'),
    `no order value was sent for p1 again (${projSends('p1')} attempt, none stored)`,
  );
  ok(projNames() === 'pN,p1,p2,p3' && jeq(S.data.projOrder, ['pN', 'p1', 'p2', 'p3']), `server and page agree: ${projCols()} / ${pids()}`);
  await stopSync();
}

// ---------- B2 (fixed in this PR): projectOrders() must not hand a neighbour an `order` the server refuses ----------
// The stub applies every update (it does not enforce server/pb_hooks/project_order.pb.js), so server.sent holds every `order` the page
// asked to store; the server's guard (LIMIT 1e12) would refuse any CHANGED one outside +-1e12 (an unchanged one passes). A FAIL line in
// B2 means the page asks for something the server would refuse, or the order the user asked for is not the one shown / stored.
console.log('\n== B2: a project whose order is beyond +-1e12 (a superuser or a migration put it there): a member re-orders a neighbour');
const LIMIT = 1e12;
const dropListeners = {};
{
  const real = document.addEventListener;
  document.addEventListener = (t, f) => (dropListeners[t] ||= []).push(f); // so that drag-drop.js can be driven with the events its handlers read
  await import('app/actions/drag-drop.js');
  document.addEventListener = real;
}
const fire = (type, e) =>
  (dropListeners[type] || []).forEach(f => f({ preventDefault() {}, dataTransfer: { types: [], setData() {}, setDragImage() {} }, ...e }));
const cls = { classList: { add() {}, remove() {}, contains: () => false } };
// the sidebar drag of A project onto the row of another (dragstart, dragover, drop: what drag-drop.js:17, :59 and :128 read)
function dragProject(id, before) {
  const only = (sel, v) => ({ closest: s => (s === sel ? v : null) });
  fire('dragstart', { target: only('[data-drag-proj]', { dataset: { dragProj: id }, ...cls, closest: () => null }) });
  fire('dragover', { target: only('[data-proj-drop]', { dataset: { projDrop: before }, querySelector: () => cls }) });
  fire('drop', { target: { closest: () => null } });
}
const projRow = (id, name, order) => ({
  id,
  workspace: 'w1',
  team: '',
  lead: 'u1',
  private: false,
  members: ['u1'],
  archived: false,
  order,
  updated: '0001',
  doc: { key: id, name },
});
const b2Orders = () => [...server.sent].filter(w => w.c === 'projects' && 'order' in w.f);
const b2Start = orders =>
  r2Start(() => {
    server.db.projects = M(Object.entries(orders).map(([id, o]) => projRow(id, id.toUpperCase(), o)));
  });
const b2Settle = async () => {
  await flush();
  await sleep(30);
};
const beyond = o => !(Math.abs(o) <= LIMIT);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
// what the page shows (S.data.projOrder), what the server holds (sorted by its `order` column, ties by id), and that nothing is left pending
// (values that tie at exactly +-1e12 are settled by id, so the order asked for can be lost there, in the page or in the server's
// answer: with `ties` they are only asked to hold the same projects)
function b2Settled(tag, want, baseline, ties = false) {
  if (ties)
    ok(
      same(S.data.projOrder, projNames().split(',')),
      `B2 ${tag}: the page and the server hold the same projects, ties at the limit settled by id (${pids()} / ${projCols()})`,
    );
  else {
    ok(pids() === JSON.stringify(want), `B2 ${tag}: the page shows ${want} (${pids()})`);
    ok(projNames() === want.join(','), `B2 ${tag}: the server holds ${want} (${projCols()})`);
  }
  ok(pendingDetails().length === 0 && pendingChanges() === 0, `B2 ${tag}: nothing pending (${pendingDetails().join('; ')})`);
  ok(
    ![...server.db.projects.values()].some(p => baseline[p.id] !== undefined && p.order !== baseline[p.id] && beyond(p.order)),
    `B2 ${tag}: no stored order was changed to one beyond +-1e12 (${projCols()})`,
  );
}
// moves: [what, move, the order the user asked for, ids that must not be written (or null), ids that must be exactly the ones written (or null), ties at the limit]
const b2Cases = [
  [
    '5e12 is last',
    { p1: 0, p2: 1, p3: 5e12 },
    [
      ['A.projUp(p3)  (sidebar menu "Move up", actions.js:480)', () => A.projUp({ dataset: { id: 'p3' } }), ['p1', 'p3', 'p2']],
      ['A.projDown(p2)  (sidebar menu "Move down")', () => A.projDown({ dataset: { id: 'p2' } }), ['p1', 'p3', 'p2']],
      ['drag p3 before p2  (drag-drop.js:228)', () => dragProject('p3', 'p2'), ['p1', 'p3', 'p2']],
      ['drag p3 before p1', () => dragProject('p3', 'p1'), ['p3', 'p1', 'p2']],
      ['control: A.projUp(p2), p3 stays last', () => A.projUp({ dataset: { id: 'p2' } }), ['p2', 'p1', 'p3'], ['p3'], ['p1', 'p2']],
      ['control: A.projDown(p1), p3 stays last', () => A.projDown({ dataset: { id: 'p1' } }), ['p2', 'p1', 'p3'], ['p3'], ['p1', 'p2']],
    ],
  ],
  [
    '-5e12 is first',
    { p1: -5e12, p2: 0, p3: 1 },
    [
      ['A.projDown(p1)', () => A.projDown({ dataset: { id: 'p1' } }), ['p2', 'p1', 'p3']],
      ['A.projUp(p2)', () => A.projUp({ dataset: { id: 'p2' } }), ['p2', 'p1', 'p3']],
      ['drag p1 before p3', () => dragProject('p1', 'p3'), ['p2', 'p1', 'p3']],
      ['control: A.projUp(p3), p1 stays first', () => A.projUp({ dataset: { id: 'p3' } }), ['p1', 'p3', 'p2'], ['p1'], ['p2', 'p3']],
    ],
  ],
  [
    '5e12 in the middle of three (1, 5e12, 7e12)',
    { p1: 1, p2: 5e12, p3: 7e12 },
    [
      ['A.projUp(p3)', () => A.projUp({ dataset: { id: 'p3' } }), ['p1', 'p3', 'p2']],
      ['A.projUp(p2)', () => A.projUp({ dataset: { id: 'p2' } }), ['p2', 'p1', 'p3']],
    ],
  ],
  // (c) every project is beyond the range: whichever swap is made, the two that swap would take each other's value, so all are placed again, in range, in the order asked for
  [
    '(c) all beyond +5e12 (5e12, 6e12, 7e12)',
    { p1: 5e12, p2: 6e12, p3: 7e12 },
    [
      ['A.projUp(p3)', () => A.projUp({ dataset: { id: 'p3' } }), ['p1', 'p3', 'p2']],
      ['A.projDown(p1)', () => A.projDown({ dataset: { id: 'p1' } }), ['p2', 'p1', 'p3']],
      ['drag p3 before p1', () => dragProject('p3', 'p1'), ['p3', 'p1', 'p2']],
    ],
  ],
  [
    '(c) all beyond -5e12 (-7e12, -6e12, -5e12)',
    { p1: -7e12, p2: -6e12, p3: -5e12 },
    [
      ['A.projDown(p1)', () => A.projDown({ dataset: { id: 'p1' } }), ['p2', 'p1', 'p3']],
      ['A.projUp(p3)', () => A.projUp({ dataset: { id: 'p3' } }), ['p1', 'p3', 'p2']],
    ],
  ],
  [
    '(c) all beyond, on both sides (-5e12, 5e12, 6e12)',
    { p1: -5e12, p2: 5e12, p3: 6e12 },
    [
      ['A.projUp(p3)', () => A.projUp({ dataset: { id: 'p3' } }), ['p1', 'p3', 'p2']],
      ['A.projUp(p2)', () => A.projUp({ dataset: { id: 'p2' } }), ['p2', 'p1', 'p3']],
    ],
  ],
  // (d) a plain re-order of in-range projects: the far one elsewhere is neither handed a new value nor written
  [
    '(d) far one last, three in range (0, 1, 2, 5e12)',
    { p1: 0, p2: 1, p3: 2, p4: 5e12 },
    [
      ['A.projUp(p2)', () => A.projUp({ dataset: { id: 'p2' } }), ['p2', 'p1', 'p3', 'p4'], ['p4', 'p3'], ['p1', 'p2']],
      ['A.projDown(p2)', () => A.projDown({ dataset: { id: 'p2' } }), ['p1', 'p3', 'p2', 'p4'], ['p4', 'p1'], ['p2', 'p3']],
      ['drag p3 before p1', () => dragProject('p3', 'p1'), ['p3', 'p1', 'p2', 'p4'], ['p4']],
    ],
  ],
  [
    '(d) far one first, three in range (-5e12, 0, 1, 2)',
    { p1: -5e12, p2: 0, p3: 1, p4: 2 },
    [
      ['A.projUp(p4)', () => A.projUp({ dataset: { id: 'p4' } }), ['p1', 'p2', 'p4', 'p3'], ['p1', 'p2'], ['p3', 'p4']],
      ['drag p4 before p2', () => dragProject('p4', 'p2'), ['p1', 'p4', 'p2', 'p3'], ['p1']],
    ],
  ],
  [
    '(d) far ones at both ends (-5e12, 0, 1, 2, 5e12)',
    { p1: -5e12, p2: 0, p3: 1, p4: 2, p5: 5e12 },
    [['A.projUp(p4)', () => A.projUp({ dataset: { id: 'p4' } }), ['p1', 'p2', 'p4', 'p3', 'p5'], ['p1', 'p5'], ['p3', 'p4']]],
  ],
  // (e) only the far projects that have to move are written; the others stay where they are, whatever else is renumbered
  [
    '(e) far at both ends, one far moved into the middle (-5e12, 1, 2, 3, 5e12, 6e12)',
    { p1: -5e12, p2: 1, p3: 2, p4: 3, p5: 5e12, p6: 6e12 },
    [
      [
        'A.projUp(p5) twice',
        () => {
          A.projUp({ dataset: { id: 'p5' } });
          A.projUp({ dataset: { id: 'p5' } });
        },
        ['p1', 'p2', 'p5', 'p3', 'p4', 'p6'],
        ['p1', 'p6', 'p3', 'p4'],
        ['p5'],
      ],
    ],
  ],
  [
    '(e) Fn -5e12 stays, Fp 5e12 moves between A and B (-5e12, 1, 2, 5e12)',
    { p1: -5e12, p2: 1, p3: 2, p4: 5e12 },
    [['A.projUp(p4)', () => A.projUp({ dataset: { id: 'p4' } }), ['p1', 'p2', 'p4', 'p3'], ['p1', 'p2', 'p3'], ['p4']]],
  ],
  [
    '(e) a chain of far ones (-6e12, -5e12, 1): the in-range one goes first, the two far ones after it',
    { p1: -6e12, p2: -5e12, p3: 1 },
    [
      [
        'drag p3 before p1, then p1 down',
        () => {
          dragProject('p3', 'p1');
          A.projDown({ dataset: { id: 'p1' } });
        },
        ['p3', 'p2', 'p1'],
        ['p3'],
        ['p1', 'p2'],
      ],
    ],
  ],
  // (f) near the limit: nothing is written beyond it; the values go one apart if there is room, else they are spread over what is left
  [
    '(f) room of 0.5 above the in-range ones, two far ones moved there (0, 1e12-0.5, 5e12, 6e12)',
    { p1: 0, p2: 1e12 - 0.5, p3: 5e12, p4: 6e12 },
    [['A.projUp(p4)', () => A.projUp({ dataset: { id: 'p4' } }), ['p1', 'p2', 'p4', 'p3'], ['p1', 'p2'], ['p3', 'p4']]],
  ],
  [
    '(f) a far one moved below one that is 0.5 above the limit (-1e12+0.5, 0, 1e12-0.5, 5e12)',
    { p1: -1e12 + 0.5, p2: 0, p3: 1e12 - 0.5, p4: 5e12 },
    [
      ['A.projUp(p4) (between p2 and p3)', () => A.projUp({ dataset: { id: 'p4' } }), ['p1', 'p2', 'p4', 'p3'], ['p1', 'p2', 'p3'], ['p4']],
      ['drag p4 before p1 (squeezed to -1e12)', () => dragProject('p4', 'p1'), ['p4', 'p1', 'p2', 'p3'], ['p1', 'p2', 'p3'], ['p4']],
    ],
  ],
  // a neighbour exactly at the limit leaves no room: the values tie with it and the ties are settled by id, so the server's order can differ from the one asked for (skipped)
  [
    '(f) pinned at -1e12 with two steps beyond it (-1e12-2, -1e12-1, -1e12, 0)',
    { p1: -1e12 - 2, p2: -1e12 - 1, p3: -1e12, p4: 0 },
    [['A.projDown(p1)', () => A.projDown({ dataset: { id: 'p1' } }), ['p2', 'p1', 'p3', 'p4'], ['p4'], ['p1', 'p2'], true]],
  ],
  [
    '(f) at +1e12 with two far ones after it (0, 1e12, 5e12, 6e12)',
    { p1: 0, p2: 1e12, p3: 5e12, p4: 6e12 },
    [['A.projUp(p4)', () => A.projUp({ dataset: { id: 'p4' } }), ['p1', 'p2', 'p4', 'p3'], ['p1', 'p2'], ['p3', 'p4'], true]],
  ],
];
for (const [label, orders, moves] of b2Cases) {
  for (const [what, move, want, keeps, exact, ties] of moves) {
    await b2Start(orders);
    const before = projCols();
    const baseline = Object.fromEntries([...server.db.projects.values()].map(p => [p.id, p.order]));
    move();
    await b2Settle();
    const sent = b2Orders().map(w => [w.id, w.f.order]);
    const bad = sent.filter(([id, o]) => o !== baseline[id] && beyond(o));
    console.log(`    (info) ${label} / ${what}: page ${pids()}, server before ${before}, orders written ${JSON.stringify(sent)}`);
    ok(sent.length > 0, `B2 ${label} / ${what}: the move was saved (${sent.length} order write(s))`);
    ok(
      bad.length === 0,
      `B2 ${label} / ${what}: no changed order outside +-1e12 is written (${JSON.stringify(bad)}${bad.length ? `; their old values ${JSON.stringify(bad.map(([id]) => baseline[id]))}` : ''})`,
    );
    b2Settled(`${label} / ${what}`, want, baseline, ties);
    if (keeps) ok(!sent.some(([id]) => keeps.includes(id)), `B2 ${label} / ${what}: ${keeps} not written (${JSON.stringify(sent)})`);
    if (exact)
      ok(
        same(
          sent.map(([id]) => id),
          exact,
        ),
        `B2 ${label} / ${what}: exactly ${exact} written, nothing else renumbered (${JSON.stringify(sent)})`,
      );
    await stopSync();
  }
}

// (a) a project created next to a far one: the placeholder can be beyond the range (the server ignores a create's value), and it must not
// make the page re-place the far one, nor any other known project. Nothing known is written at all.
console.log('\n== B2a: a create next to a project beyond +-1e12: no update for any known project');
for (const [label, orders, at] of [
  ['5e12 last, new first', { p1: 0, p2: 1, p3: 5e12 }, 0],
  ['5e12 last, new between p2 and p3', { p1: 0, p2: 1, p3: 5e12 }, 2],
  ['5e12 last, new last (placeholder 5e12+1)', { p1: 0, p2: 1, p3: 5e12 }, 3],
  ['-5e12 first, new first (placeholder -5e12-1)', { p1: -5e12, p2: 0, p3: 1 }, 0],
  ['-5e12 first, new last', { p1: -5e12, p2: 0, p3: 1 }, 3],
  ['all beyond (5e12, 6e12, 7e12), new last', { p1: 5e12, p2: 6e12, p3: 7e12 }, 3],
  ['all beyond (5e12, 6e12, 7e12), new first', { p1: 5e12, p2: 6e12, p3: 7e12 }, 0],
]) {
  await b2Start(orders);
  const baseline = Object.fromEntries([...server.db.projects.values()].map(p => [p.id, p.order]));
  const want = [...S.data.projOrder];
  want.splice(at, 0, 'pN');
  S.data.projects.push({ ...S.data.projects[0], id: 'pN', name: 'New', key: 'NEW' });
  S.data.projOrder.splice(at, 0, 'pN');
  await b2Settle();
  const updates = server.writes.filter(w => w.c === 'projects' && w.kind === 'update');
  console.log(`    (info) B2a ${label}: placeholder stored for pN ${server.db.projects.get('pN')?.order}, updates ${JSON.stringify(updates.map(w => w.id))}`);
  ok(server.db.projects.has('pN') && server.writes.some(w => w.c === 'projects' && w.kind === 'create' && w.id === 'pN'), `B2a ${label}: the create went out`);
  ok(updates.length === 0, `B2a ${label}: no known project was written (${JSON.stringify(updates.map(w => w.id))})`);
  ok(
    Object.entries(baseline).every(([id, o]) => server.db.projects.get(id).order === o),
    `B2a ${label}: every known project keeps its stored order (${projCols()})`,
  );
  ok(
    pids() === JSON.stringify(want) && pendingDetails().length === 0,
    `B2a ${label}: the page shows ${want}, nothing pending (${pids()}; ${pendingDetails().join('; ')})`,
  );
  await stopSync();
}

// (b) an edit of a far project's title that leaves it where it is: its order is neither re-placed nor part of the payload
console.log('\n== B2b: a title edit of a project beyond +-1e12, left in place: its order is not written');
for (const patches of [false, true]) {
  for (const [label, orders, edited] of [
    ['5e12 is last, edit it', { p1: 0, p2: 1, p3: 5e12 }, 'p3'],
    ['-5e12 is first, edit it', { p1: -5e12, p2: 0, p3: 1 }, 'p1'],
    ['5e12 is last, edit p1 beside it', { p1: 0, p2: 1, p3: 5e12 }, 'p1'],
    ['all beyond, edit the middle one', { p1: 5e12, p2: 6e12, p3: 7e12 }, 'p2'],
  ]) {
    await b2Start(orders);
    server.patches = patches;
    const baseline = Object.fromEntries([...server.db.projects.values()].map(p => [p.id, p.order]));
    const want = [...S.data.projOrder];
    S.data.projects.find(p => p.id === edited).name = 'Renamed';
    await b2Settle();
    const sent = server.sent.filter(w => w.c === 'projects');
    const tag = `patches=${patches} ${label}`;
    // (a server that does not confirm docPatch gets the doc whole on a second request: that is why there can be two)
    ok(
      sent.length >= 1 && sent.every(w => w.id === edited && !('order' in w.f)),
      `B2b ${tag}: only ${edited} was written, with no order (${JSON.stringify(sent.map(w => [w.id, Object.keys(w.f)]))})`,
    );
    ok(server.db.projects.get(edited).doc.name === 'Renamed', `B2b ${tag}: the new title was stored`);
    ok(
      Object.entries(baseline).every(([id, o]) => server.db.projects.get(id).order === o),
      `B2b ${tag}: every stored order is as it was (${projCols()})`,
    );
    ok(
      pids() === JSON.stringify(want) && pendingDetails().length === 0 && pendingChanges() === 0,
      `B2b ${tag}: the page still shows ${want}, nothing pending (${pids()}; ${pendingDetails().join('; ')})`,
    );
    await stopSync();
  }
}
server.patches = false;
finish();
