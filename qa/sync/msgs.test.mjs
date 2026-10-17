import { server } from './stub-pb.mjs';
import { ok, known, finish } from './check.mjs';
import { bindSync, startSync, stopSync, flush, retryNow, quietResync, pendingChanges, pendingDetails, snapshotState, restoreState } from 'app/core/sync.js';
import * as SY from 'app/core/sync.js';
import { S, resetStore } from 'app/core/store.js';
import { fromRecord, stableStringify } from 'app/core/sync-map.js';

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

// ---------- M1: what the user is told when sync goes wrong ----------
const activityRead = () => server.reads.filter(r => r.c === 'activity');
const start1 = async () => {
  seed();
  server.down = 0;
  server.writes.length = 0;
  server.rule = null;
  server.say = '';
  server.hold = {};
  server.reads.length = 0;
  server.notFound = 0;
  toasts.length = 0;
  now = Date.now();
  await startSync();
  return now;
};
const errToasts = () => toasts.filter(([, o]) => o.kind === 'err');
console.log('\n== M1a: a give-up of an edit and its activity create reads the activity back without a 404; the local row goes');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
    act();
  });
  ok(
    S.data.activity.some(a => a.id === 'a1'),
    'the activity row is on screen before the give-up',
  );
  server.down = 0;
  server.reads.length = 0;
  server.notFound = 0;
  server.rule = (kind, c, id) => (kind === 'stream' || (kind === 'read' && !id) || kind === 'create' || kind === 'update' ? 500 : 0); // lists and writes fail, a read of one record works
  now = T0 + 75000;
  toasts.length = 0;
  await retryNow();
  ok(refusedToasts().length === 1, `given up (${said()})`);
  ok(
    activityRead().length === 1 && activityRead()[0].via === 'getList' && activityRead()[0].id === 'a1',
    `the activity was read back with a list read: ${JSON.stringify(activityRead())}`,
  );
  ok(server.reads.every(r => r.via === 'getList') && server.notFound === 0, `no getOne, no 404 (${server.reads.length} read(s), ${server.notFound} 404)`);
  ok(!S.data.activity.some(a => a.id === 'a1'), 'the local activity row is removed');
  ok(task('t1').title === 'Fix login' && pendingChanges() === 0, `the title is back, nothing pending (${pendingDetails().join('; ')})`);
  await stopSync();
}
console.log('\n== M1a2: a refused activity create (online page) is read back without a 404, and the row goes');
{
  await start1();
  act();
  server.rule = (kind, c) => (kind === 'create' && c === 'activity' ? 400 : 0);
  await flush();
  ok(activityRead().length === 1 && activityRead()[0].via === 'getList' && server.notFound === 0, `list read, no 404: ${JSON.stringify(server.reads)}`);
  ok(!S.data.activity.some(a => a.id === 'a1') && pendingChanges() === 0 && !S.ui.offline, 'row removed, nothing pending, still online');
  await stopSync();
}
console.log('\n== M1f: a give-up whose read-back fails too: the reload after reconnect asks with a list read, no 404, and the row goes');
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
    act();
  });
  server.down = 0;
  server.reads.length = 0;
  server.notFound = 0;
  server.rule = kind => (kind === 'stream' || kind === 'read' || kind === 'create' || kind === 'update' ? 500 : 0); // everything fails, the read-back too
  now = T0 + 75000;
  toasts.length = 0;
  await retryNow();
  ok(refusedToasts().length === 1 && S.ui.offline, `given up, still offline (${said()})`);
  ok(
    S.data.activity.some(a => a.id === 'a1'),
    'the activity row stays until the server can say',
  );
  server.rule = null;
  server.reads.length = 0;
  server.notFound = 0;
  now += 30000;
  await retryNow();
  ok(!S.ui.offline, 'back online');
  ok(
    activityRead().length === 1 && activityRead()[0].via === 'getList' && server.notFound === 0,
    `the reload asked with a list read, no 404: ${JSON.stringify(server.reads)}`,
  );
  ok(!S.data.activity.some(a => a.id === 'a1') && pendingChanges() === 0, `the row is gone, nothing pending (${pendingDetails().join('; ')})`);
  await stopSync();
}
console.log('\n== M1b: a refused create that landed in an earlier try is adopted, not removed');
{
  await start1();
  act();
  server.db.activity.set('a1', { id: 'a1', project: 'p1', task: 't1', by: 'u1', updated: '0005', doc: { text: 'the server copy', at: 1 } });
  server.rule = (kind, c) => (kind === 'create' && c === 'activity' ? 400 : 0);
  await flush();
  const a = S.data.activity.find(x => x.id === 'a1');
  ok(activityRead().length === 1 && activityRead()[0].via === 'getList' && server.notFound === 0, `list read, no 404: ${JSON.stringify(server.reads)}`);
  ok(a && a.text === 'the server copy', `the server's copy is on screen: ${JSON.stringify(a)}`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  server.rule = null;
  await flush();
  ok(
    server.db.activity.get('a1').doc.text === 'the server copy' && S.data.activity.find(x => x.id === 'a1')?.text === 'the server copy',
    'and it is not sent again',
  );
  await stopSync();
}
console.log('\n== M1c: the reload is refused and a change is refused: one toast says both');
for (const [lostToo, say] of [
  [true, ''],
  [true, 'Failed to load.'],
  [false, ''],
]) {
  await start1();
  server.say = say;
  task('t1').title = 'Renamed task';
  server.down = 500;
  await flush();
  ok(S.ui.offline, 'offline');
  if (!lostToo) task('t1').title = 'Fix login'; // the edit is taken back: nothing is refused
  server.down = 0;
  server.rule = (kind, c, id) => (kind === 'read' && c === 'tasks' && !id ? 400 : kind === 'update' && c === 'tasks' ? 400 : 0); // the tasks list is refused; so is the edit; its read-back works
  now += 3000;
  toasts.length = 0;
  ok((await retryNow()) === true && !S.ui.offline, 'back online');
  const re = reconnected();
  const why = say || 'Bad value';
  const want = `Reconnected, but your data could not be reloaded: ${why}${lostToo ? `${say ? '' : '.'} Some changes couldn't be saved.` : ''}`;
  console.log(`    reconnect toast: ${JSON.stringify(re)}`);
  ok(
    re.length === 1 && re[0][0] === want && re[0][1].kind === 'err',
    `lost change ${lostToo}, message ${JSON.stringify(say)}: one red toast, ${JSON.stringify(want)}`,
  );
  await stopSync();
}
console.log('\n== M1d: "Try again" on the try that gives up: one red toast; on a try that only fails: the retry toast');
for (const down of [500, 503]) {
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  server.down = down;
  now = T0 + 50000;
  toasts.length = 0;
  await retryNow();
  const want = down === 500 ? "The server is having trouble right now. We'll keep trying." : "Still can't reach the server. We'll keep trying.";
  ok(errToasts().length === 1 && errToasts()[0][0] === want, `${down}: a try that fails says: ${said()}`);
  if (down === 500) {
    now = T0 + 75000;
    toasts.length = 0;
    ok((await retryNow()) === false && S.ui.offline, 'the try that gives up: still offline');
    console.log(`    toasts: ${JSON.stringify(errToasts().map(([m, o]) => [m, o.sticky ? 'sticky' : o.ms]))}`);
    ok(errToasts().length === 1 && refusedToasts().length === 1 && !said().includes('keep trying'), `exactly one red toast, the give-up: ${said()}`);
    now = T0 + 105000;
    toasts.length = 0;
    await retryNow();
    ok(errToasts().length === 1 && errToasts()[0][0].endsWith("We'll keep trying."), `the next try, which only fails: the retry toast again: ${said()}`);
  }
  await stopSync();
}
{
  console.log('  -- a 4xx refusal whose read-back fails: the refusal is told, not also the retry');
  await start1();
  task('t1').title = 'Renamed task';
  server.down = 500;
  await flush();
  server.down = 0;
  server.rule = (kind, c, id) => (kind === 'update' && c === 'tasks' ? 400 : kind === 'read' && id ? 500 : 0);
  now += 3000;
  toasts.length = 0;
  ok((await retryNow()) === false && S.ui.offline, 'the try refused the edit and stays offline');
  ok(errToasts().length === 1 && errToasts()[0][0] === "Couldn't save: Bad value", `one red toast, the refusal: ${said()}`);
  await stopSync();
}
console.log('\n== M1e: offlineCause() says why the page is offline');
for (const [down, want] of [
  [500, 'server'],
  [503, 'network'],
]) {
  await start1();
  ok(SY.offlineCause() === null, 'online: null');
  task('t1').title = 'Renamed task';
  server.down = down;
  await flush();
  ok(S.ui.offline && SY.offlineCause() === want, `${down}: ${SY.offlineCause()}`);
  server.down = 0;
  now += 3000;
  await retryNow();
  ok(!S.ui.offline && SY.offlineCause() === null, 'back online: null');
  await stopSync();
}
server.say = '';
server.rule = null;
server.down = 0;

// ---------- R1: a change the server refused, or that was given up on, is put back on the page at once ----------
const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const projWrites = () => server.writes.filter(w => w.c === 'projects').length;
const delWrites = () => server.writes.filter(w => w.kind === 'delete').length;
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
const filesNow = () => S.data.files.map(f => `${f.id}:${f.file}`);
async function r1Start(extra = () => {}) {
  seed();
  extra();
  server.down = 0;
  server.writes.length = 0;
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
// The edit at t=0, the server failing from then on, the polls at 3, 9, 21 and 45 s; the caller goes on from t=74 or t=75.
async function r1Outage(extra, edit) {
  const T0 = await r1Start(extra);
  edit();
  server.down = 500;
  await flush();
  for (const t of [3, 9, 21, 45]) {
    now = T0 + t * 1000;
    await retryNow();
  }
  return T0;
}
const refuseAll = kinds => (kind, c) => (kind === 'update' && kinds.includes(c) ? 400 : 0);
for (const n of [2, 3]) {
  const extra = n === 3 ? addP3 : () => {};
  const moved = n === 3 ? ['p3', 'p1', 'p2'] : ['p2', 'p1']; // (a project moved to the front shifts every one after it: all get a new `order`)
  const theirs = n === 3 ? ['p1', 'p2', 'p3'] : ['p1', 'p2'];
  const orderCols = () => [...server.db.projects.values()].map(p => `${p.id}:${p.order}`).join(',');
  console.log(`\n== R1a (${n} projects): a project re-order that was given up on goes back to the server's order, and is not sent again`);
  {
    const T0 = await r1Outage(extra, () => {
      S.data.projOrder = [...moved];
    });
    const cols = orderCols();
    ok(jeq(S.data.projOrder, moved), 'the new order is on screen during the outage');
    now = T0 + 75000;
    await retryNow();
    ok(refusedToasts().length === 1, 'given up at t=75');
    ok(jeq(S.data.projOrder, theirs), `the order is the server's: ${JSON.stringify(S.data.projOrder)}`);
    ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
    const w = projWrites();
    server.down = 0;
    now = T0 + 105000;
    toasts.length = 0;
    ok((await retryNow()) === true && !S.ui.offline, 'back online');
    await flush();
    await flush();
    ok(projWrites() === w, `no project write after the give-up (${projWrites() - w})`);
    ok(
      jeq(S.data.projOrder, theirs) && pendingChanges() === 0 && orderCols() === cols,
      `still the server's order, nothing pending, the server's columns untouched (${orderCols()})`,
    );
    await stopSync();
  }
  console.log(`\n== R1a (${n} projects): a re-order the server refused (4xx, read back) goes back to the server's order, and is not sent again`);
  {
    await r1Start(extra);
    S.data.projOrder = [...moved];
    server.rule = refuseAll(['projects']);
    await flush();
    ok(
      toasts.some(([m]) => m.startsWith("Couldn't save: ")),
      'the refusal is told',
    );
    ok(jeq(S.data.projOrder, theirs), `the order is the server's: ${JSON.stringify(S.data.projOrder)}`);
    ok(pendingChanges() === 0 && !S.ui.offline, `nothing pending, still online (${pendingDetails().join('; ')})`);
    const w = projWrites();
    server.rule = null;
    await flush();
    await flush();
    ok(projWrites() === w, `not sent again (${projWrites() - w})`);
    ok(jeq(S.data.projOrder, theirs) && pendingChanges() === 0, 'and the order stays');
    await stopSync();
  }
}
console.log('\n== R1a: a refusal of another field of a project keeps a re-order made while its request was in flight');
{
  await r1Start();
  S.data.projects.find(p => p.id === 'p1').name = 'Renamed';
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'projects' && id === 'p1') {
      S.data.projOrder = ['p2', 'p1'];
      return 400;
    } // the request was built before this
    return 0;
  };
  await flush();
  ok(S.data.projects.find(p => p.id === 'p1').name === 'Alpha', 'the rename was refused and taken back');
  ok(jeq(S.data.projOrder, ['p2', 'p1']), `the re-order made since is the user's, not taken back: ${JSON.stringify(S.data.projOrder)}`);
  server.rule = null;
  await flush();
  ok(
    jeq(S.data.projOrder, ['p2', 'p1']) && pendingChanges() === 0 && server.db.projects.get('p2').order === 0 && server.db.projects.get('p1').order === 1,
    `and it is sent now (${[...server.db.projects.values()].map(p => p.id + ':' + p.order)})`,
  );
  await stopSync();
}

console.log('\n== R1a: a project delete the server refuses (403, read back) puts the project back in its place, and sends no order for the others');
{
  await r1Start(addP3);
  const cols = [...server.db.projects.values()].map(p => `${p.id}:${p.order}`).join(',');
  S.data.projects = S.data.projects.filter(p => p.id !== 'p1');
  S.data.projOrder = ['p2', 'p3'];
  server.rule = (kind, c) => (kind === 'delete' && c === 'projects' ? 403 : 0);
  await flush();
  ok(
    S.data.projects.some(p => p.id === 'p1'),
    'the project is back',
  );
  ok(jeq(S.data.projOrder, ['p1', 'p2', 'p3']), `in its place: ${JSON.stringify(S.data.projOrder)}`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  const w = projWrites();
  server.rule = null;
  await flush();
  await flush();
  const now2 = [...server.db.projects.values()].map(p => `${p.id}:${p.order}`).join(',');
  ok(projWrites() === w && now2 === cols, `no project write, the server's order columns untouched (${projWrites() - w}; ${now2})`);
  await stopSync();
}
console.log('\n== R1b: a delete of a file that was given up on or refused puts the file back at once, with its stored name');
const delFile = () => {
  S.data.files = S.data.files.filter(f => f.id !== 'f1');
};
const WANT = ['f2:b_y.pdf', 'f1:a_x.pdf']; // newest first: back where its date puts it
{
  console.log('  -- given up after a 5xx outage');
  const T0 = await r1Outage(addF2, delFile);
  ok(jeq(filesNow(), ['f2:b_y.pdf']), 'the file is gone from the page during the outage');
  now = T0 + 74000;
  const snap = snapshotState(); // the token of something done after the delete: it holds no file
  now = T0 + 75000;
  await retryNow();
  ok(refusedToasts().length === 1, 'given up at t=75');
  ok(jeq(filesNow(), WANT), `the file is back at once, with its stored name, in its place: ${filesNow()}`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  now = T0 + 76000;
  ok(
    restoreState(snap) === true && jeq(filesNow().sort(), [...WANT].sort()) && pendingChanges() === 0,
    `an Undo of that keeps the file (journaled): ${filesNow()}`,
  );
  const w = delWrites();
  server.down = 0;
  now = T0 + 105000;
  ok((await retryNow()) === true, 'back online');
  await flush();
  ok(
    delWrites() === w && server.db.files.has('f1') && jeq(filesNow(), WANT) && pendingChanges() === 0,
    `not sent again, the file stays (${delWrites() - w} delete(s))`,
  );
  await stopSync();
}
{
  console.log('  -- refused (4xx), the record read back');
  await r1Start(addF2);
  delFile();
  server.rule = (kind, c) => (kind === 'delete' && c === 'files' ? 403 : 0);
  await flush();
  ok(jeq(filesNow().sort(), [...WANT].sort()) && pendingChanges() === 0 && !S.ui.offline, `the file is back with its name, nothing pending: ${filesNow()}`);
  const w = delWrites();
  server.rule = null;
  await flush();
  ok(delWrites() === w && server.db.files.has('f1'), 'not sent again');
  await stopSync();
}
{
  console.log('  -- refused (4xx), the read-back fails (5xx): the refusal puts the page offline');
  await r1Start(addF2);
  delFile();
  server.rule = kind => (kind === 'delete' ? 400 : 500);
  await flush();
  ok(S.ui.offline, 'offline');
  ok(jeq(filesNow(), WANT), `the file is back at once, with its stored name, in its place: ${filesNow()}`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  const w = delWrites();
  server.rule = null;
  now += 3000;
  await retryNow();
  await flush();
  ok(
    !S.ui.offline && delWrites() === w && server.db.files.has('f1') && jeq(filesNow(), WANT) && pendingChanges() === 0,
    `back online; not sent again, the file stays (${delWrites() - w} delete(s))`,
  );
  await stopSync();
}
{
  console.log('  -- the whole project was deleted and given up on: its files stay gone with it (the lists read the project)');
  const T0 = await r1Outage(addF2, () => {
    S.data.projects = S.data.projects.filter(p => p.id !== 'p1');
    S.data.projOrder = ['p2'];
    S.data.tasks = S.data.tasks.filter(t => t.project !== 'p1');
    S.data.files = [];
  });
  now = T0 + 75000;
  await retryNow();
  ok(refusedToasts().length === 1, 'given up at t=75');
  ok(
    S.data.files.every(f => S.data.projects.some(p => p.id === f.project)),
    `no file without its project on the page: ${filesNow()}`,
  );
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  server.down = 0;
  now = T0 + 105000;
  ok((await retryNow()) === true && S.data.projects.some(p => p.id === 'p1') && S.data.files.length === 2, `the reload brings it all back: ${filesNow()}`);
  await stopSync();
}

console.log('\n== R1c: Undo of something done meanwhile does not bring back a value that was refused (the put-back is in the journal)');
{
  console.log('  -- the put-back order path: a re-order given up on, the token taken while it was on screen');
  const T0 = await r1Outage(
    () => {},
    () => {
      S.data.projOrder = ['p2', 'p1'];
    },
  );
  now = T0 + 74000;
  const snap = snapshotState();
  task('t2').title = 'Another action';
  now = T0 + 75000;
  await retryNow();
  ok(refusedToasts().length === 1 && jeq(S.data.projOrder, ['p1', 'p2']), `given up, the order is the server's: ${JSON.stringify(S.data.projOrder)}`);
  now = T0 + 76000;
  ok(restoreState(snap) === true, 'undo restored');
  ok(jeq(S.data.projOrder, ['p1', 'p2']), `the refused order does not come back: ${JSON.stringify(S.data.projOrder)}`);
  ok(task('t2').title === 'Second task', 'the other action is undone');
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await stopSync();
}
{
  console.log('  -- the read-back path: a re-order refused (4xx), the token taken while it was on screen');
  await r1Start();
  S.data.projOrder = ['p2', 'p1'];
  const snap = snapshotState();
  server.rule = refuseAll(['projects']);
  await flush();
  ok(jeq(S.data.projOrder, ['p1', 'p2']), `the order is the server's: ${JSON.stringify(S.data.projOrder)}`);
  ok(restoreState(snap) === true, 'undo restored');
  ok(jeq(S.data.projOrder, ['p1', 'p2']), `the refused order does not come back: ${JSON.stringify(S.data.projOrder)}`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  const w = projWrites();
  server.rule = null;
  await flush();
  ok(projWrites() === w, `not sent again (${projWrites() - w})`);
  await stopSync();
}
{
  console.log('  -- the read-back path: an edit refused (4xx), then another action, then its Undo');
  await r1Start();
  task('t1').title = 'Renamed task';
  const snap = snapshotState(); // the action that is undone comes next: its token holds the refused title
  task('t2').title = 'Another action';
  server.rule = refuseAll(['tasks']);
  await flush();
  ok(task('t1').title === 'Fix login' && task('t2').title === 'Second task', 'both refused edits are taken back');
  ok(restoreState(snap) === true, 'undo restored');
  ok(task('t1').title === 'Fix login', `the refused title does not come back: ${task('t1').title}`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  const w = server.writes.length;
  server.rule = null;
  await flush();
  ok(server.writes.length === w && server.db.tasks.get('t1').doc.title === 'Fix login', 'nothing is sent');
  await stopSync();
}
server.rule = null;
server.down = 0;
server.say = '';

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

// ---------- B3 (documents what is intended, nothing is fixed): a try that refuses an edit and also fails the reload ----------
// By design (recover(): "one toast says both"), such a try that ends online has two red toasts: the refusal's own (refuse(), "Couldn't
// save ..."), and the reconnect one that reports the failed reload and also says that changes were lost, so that a lost change is not
// hidden by the failed reload. Any other try has at most one red toast. A FAIL line in B3 means that changed.
console.log('\n== B3: one reconnect try that refuses an edit and also fails the reload: which toasts, how many red');
const tdesc = ([m, o]) =>
  `[${o.kind || 'ok'}${o.sticky ? ' sticky' : ''}${o.key ? ` key=${o.key}` : ''}${o.replaces ? ` replaces=${o.replaces}` : ''}${o.ms ? ` ${o.ms}ms` : ''}] ${m}`;
const LOST_RE = /Some changes couldn't be saved|some changes couldn't be saved/;
// write: 'refused' (a 4xx, the edit is told at once) or 'worn' (the 5xx that went on for 75 s: given up, the sticky toast)
// list: the reload read that fails ('tasks' only, or 'all' of them); listStatus: its status; readBack: how the read of the refused record answers
async function b3Try(label, { write, list, listStatus, readBack }) {
  let T0;
  if (write === 'worn')
    T0 = await outage(() => {
      task('t1').title = 'Renamed task';
    }); // polls at 3, 9, 21, 45: the reload streak is wearing
  else {
    T0 = await start1();
    task('t1').title = 'Renamed task';
    server.down = 500;
    await flush();
  }
  server.down = 0;
  server.reads.length = 0;
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'tasks') return write === 'worn' ? 500 : 400;
    if (kind === 'read' && !id && (list === 'all' || c === 'tasks')) return listStatus;
    if (kind === 'read' && id) return readBack;
    return 0;
  };
  now = write === 'worn' ? T0 + 75000 : T0 + 3000;
  toasts.length = 0;
  const r = await retryNow();
  const reds = errToasts();
  const re = reconnected();
  console.log(`  -- ${label}: retryNow() ${r}, ${S.ui.offline ? 'still offline' : 'online'}, ${toasts.length} toast(s), ${reds.length} red`);
  for (const t of toasts) console.log(`       ${tdesc(t)}`);
  const told = refusedToasts().length > 0 || toasts.some(([m]) => m.startsWith("Couldn't save"));
  const reloadSaid = re.some(([m]) => m.includes('could not be reloaded'));
  const said = `${reds.length}: ${reds.map(([m]) => JSON.stringify(m.slice(0, 40) + '...')).join(' + ')}`;
  if (told && reloadSaid)
    ok(
      reds.length === 2 && reds.includes(re[0]),
      `B3 ${label}: two red toasts by design, the refusal's own and the one reconnect toast that says both (${said})`,
    );
  else ok(reds.length <= 1, `B3 ${label}: at most one red toast in the try (${said})`);
  if (told && reloadSaid)
    ok(
      re.every(([m]) => LOST_RE.test(m)),
      `B3 ${label}: the reconnect toast, which says the reload failed, also says changes were lost`,
    );
  await stopSync();
  return { r, reds, re, told, reloadSaid };
}
for (const readBack of [0, 400, 500]) {
  const rb = readBack ? `read-back ${readBack}` : 'read-back works';
  await b3Try(`plain 4xx edit + tasks list 400 + ${rb}`, { write: 'refused', list: 'tasks', listStatus: 400, readBack });
}
await b3Try('plain 4xx edit + every list 400 + read-back works', { write: 'refused', list: 'all', listStatus: 400, readBack: 0 });
for (const [list, name] of [
  ['tasks', 'tasks list 500'],
  ['all', 'every list 500'],
]) {
  for (const readBack of [0, 400, 500]) {
    const rb = readBack ? `read-back ${readBack}` : 'read-back works';
    await b3Try(`given-up edit at t=75 + ${name} + ${rb}`, { write: 'worn', list, listStatus: 500, readBack });
  }
}
// A 4xx edit refused while the reload is given up on after the streak (t=75): the edit is told at once, the reload is the tired kind
{
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  server.down = 0;
  server.reads.length = 0;
  server.rule = (kind, c, id) => (kind === 'update' && c === 'tasks' ? 400 : kind === 'read' && !id && c === 'tasks' ? 500 : 0);
  now = T0 + 75000;
  toasts.length = 0;
  const r = await retryNow();
  console.log(
    `  -- 4xx edit at t=75 + tasks list 500 (given up on) + read-back works: retryNow() ${r}, ${S.ui.offline ? 'still offline' : 'online'}, ${errToasts().length} red`,
  );
  for (const t of toasts) console.log(`       ${tdesc(t)}`);
  ok(
    errToasts().length === 2,
    `B3 4xx edit at t=75 + tasks list 500: two red toasts by design, the refusal's own and the one reconnect toast that says both (${errToasts().length})`,
  );
  ok(
    reconnected().length === 0 || reconnected().every(([m]) => LOST_RE.test(m)),
    'B3 4xx edit at t=75 + tasks list 500: the reconnect toast says changes were lost',
  );
  await stopSync();
}

// "Try again" (retryNow(): the offline toast of goOffline(), the one of mutate()) while a try that gives up is already running:
// the second caller shares that try (recover() is exclusive) and compares toldRefusals with what it was when that try started, not
// when it was clicked, so the give-up toast that is up already counts: there is one red toast for the give-up (fixed in this PR).
// A "Try again" on the next try, once this one has ended, is a try of its own: it says so (the "never" case below, and M1d).
console.log('\n== B3d: "Try again" clicked while the try that gives up is running (after its toast, during the read-back)');
for (const clickAt of ['during the read-back', 'never']) {
  const T0 = await outage(() => {
    task('t1').title = 'Renamed task';
  });
  server.down = 0;
  server.reads.length = 0;
  let second = null;
  server.rule = (kind, c, id) => {
    if (kind === 'read' && id && clickAt !== 'never' && !second) second = retryNow(); // the user presses "Try again": the give-up toast is up already
    return kind === 'stream' || kind === 'read' || kind === 'create' || kind === 'update' ? 500 : 0; // everything fails, the read-back too (as M1f)
  };
  now = T0 + 75000;
  toasts.length = 0;
  const r1 = await retryNow();
  const r2 = second ? await second : null;
  console.log(`  -- Try again ${clickAt}: first call ${r1}, second call ${r2}, ${S.ui.offline ? 'still offline' : 'online'}`);
  for (const t of toasts) console.log(`       ${tdesc(t)}`);
  ok(refusedToasts().length === 1, `B3d ${clickAt}: the give-up is told once (${refusedToasts().length})`);
  ok(
    errToasts().length === 1,
    `B3d ${clickAt}: one red toast for the give-up, no second one from "Try again" (${errToasts().length}: ${errToasts()
      .map(([m]) => JSON.stringify(m.slice(0, 45)))
      .join(' + ')})`,
  );
  // the next try, clicked once that one has ended: nothing is refused in it, the server still fails, so it says so
  toasts.length = 0;
  now += 21000;
  const r3 = await retryNow();
  ok(
    r3 === false && errToasts().length === 1 && /having trouble/.test(errToasts()[0][0]),
    `B3d ${clickAt}: a "Try again" on the next try still says the server is having trouble (${r3}, ${errToasts().length}: ${errToasts()
      .map(([m]) => JSON.stringify(m.slice(0, 45)))
      .join(' + ')})`,
  );
  await stopSync();
}
// ---------- K1: a field changed back while its update is in flight ----------
// KNOWN on main: settle() merges an update's own answer against the baseline from before the send (applyRecord -> merge3). A field the user
// changed and then changed back while the request was out looks untouched against that baseline, so the answer's value wins and the second
// value is lost. A later PR fixes it; the checks report KNOWN until then and ok after. (`server.rule` runs when the update is sent, after the
// diff was built: the edit lands while the request is in flight, as in C2.) The second round changes the field to a third value instead,
// which main handles: it shows that the setup works and that only the change back is lost.
const INFLIGHT_WHY = "an update's own answer is merged against the pre-send baseline (settle -> applyRecord -> merge3)";
for (const [what, second, bug] of [
  ['then back to its old value', 'todo', true],
  ['then to a third value', 'review', false],
]) {
  console.log(`\n== K1: a task's status goes to done, ${what} (${second}) while the update is in flight`);
  await start1();
  server.sent.length = 0;
  task('t1').status = 'done';
  let inFlight = 0;
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'tasks' && id === 't1' && !inFlight++) task('t1').status = second;
    return 0;
  };
  await flush();
  server.rule = null;
  ok(
    inFlight === 1 && server.sent.some(w => w.c === 'tasks' && w.id === 't1' && w.f.status === 'done'),
    'the update (status done) was sent, and the second edit landed while it was in flight',
  );
  ok(server.db.tasks.get('t1').status === 'done', 'the server stored done');
  (bug ? known : ok)(task('t1').status === second, `the page shows the second value, ${second} (${task('t1').status})`, INFLIGHT_WHY);
  await flush();
  (bug ? known : ok)(
    server.db.tasks.get('t1').status === second,
    `the second value, ${second}, is sent and stored (${server.db.tasks.get('t1').status})`,
    INFLIGHT_WHY,
  );
  (bug ? known : ok)(
    task('t1').status === second && pendingChanges() === 0,
    `the page keeps ${second}, nothing pending (${task('t1').status}; ${pendingDetails().join('; ')})`,
    INFLIGHT_WHY,
  );
  await stopSync();
}
// ---------- L: live events older than the baseline, and news of a record this tab deleted ----------
// applyRecord() ignores a live event whose `updated` is older than what it knows ("a late echo of an earlier write"), and one for a record that
// this tab deleted a moment ago (wasDeleted(): the delete's answer removed the baseline, so the event would look like a new record).
const older = rec => String(Number(rec.updated) - 1);
const newer = rec => String(Number(rec.updated) + 1);
const taskWrites = () => server.sent.filter(w => w.c === 'tasks');
console.log('\n== L1: a live update of a task that is older than the baseline is ignored');
{
  server.subs = {};
  server.patches = false;
  await start1();
  server.sent.length = 0;
  task('t1').status = 'progress';
  await flush();
  const rec = server.db.tasks.get('t1');
  ok(
    task('t1').status === 'progress' && pendingChanges() === 0 && older(rec) < rec.updated,
    `the edit is stored and the baseline is its answer (${rec.updated})`,
  );
  server.emit('tasks', 'update', { ...rec, status: 'review', updated: older(rec) });
  ok(task('t1').status === 'progress', `an older event that says review changes nothing (${task('t1').status})`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(
    taskWrites().length === 1 && server.db.tasks.get('t1').status === 'progress',
    `no second write, the server still has progress (${taskWrites().length} writes)`,
  );
  server.emit('tasks', 'update', { ...rec, status: 'review', updated: newer(rec) });
  ok(task('t1').status === 'review', `a newer event that says review is taken (${task('t1').status}): the guard is about age only`);
  await stopSync();
}

console.log('\n== L2: own update answered, a newer edit sent and answered, then the older echo of the first arrives');
{
  server.subs = {};
  await start1();
  server.sent.length = 0;
  task('t1').status = 'progress';
  await flush();
  const echo = { ...server.db.tasks.get('t1') }; // the live event of the first write, delivered late
  task('t1').status = 'review';
  await flush();
  const rec = server.db.tasks.get('t1');
  ok(
    rec.status === 'review' && echo.updated < rec.updated && taskWrites().length === 2,
    `both edits were stored, the second newer (${echo.updated} < ${rec.updated})`,
  );
  server.emit('tasks', 'update', echo);
  ok(task('t1').status === 'review', `the older echo (progress) does not undo the newer edit (${task('t1').status})`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(
    taskWrites().length === 2 && server.db.tasks.get('t1').status === 'review',
    `nothing more is sent, the server still has review (${taskWrites().length} writes)`,
  );
  server.emit('tasks', 'update', rec);
  ok(task('t1').status === 'review' && pendingChanges() === 0, 'the echo of the second write changes nothing');
  await stopSync();
}

console.log('\n== L3: the same, with the newer edit still in flight when the older echo arrives');
{
  server.subs = {};
  await start1();
  server.sent.length = 0;
  task('t1').status = 'progress';
  await flush();
  const echo = { ...server.db.tasks.get('t1') };
  task('t1').status = 'review';
  let inFlight = 0;
  server.rule = (kind, c, id) => {
    if (kind === 'update' && c === 'tasks' && id === 't1' && !inFlight++) server.emit('tasks', 'update', echo);
    return 0;
  };
  await flush();
  server.rule = null;
  ok(inFlight === 1 && task('t1').status === 'review', `the echo that came while the second edit was out left it alone (${task('t1').status})`);
  await flush();
  ok(
    server.db.tasks.get('t1').status === 'review' && pendingChanges() === 0 && taskWrites().length === 2,
    `stored review, nothing pending (${pendingDetails().join('; ')})`,
  );
  await stopSync();
}

console.log('\n== L4: a live update or echo of a task whose delete was answered does not bring it back');
{
  server.subs = {};
  await start1();
  server.sent.length = 0;
  const before = { ...server.db.tasks.get('t2') };
  S.data.tasks = S.data.tasks.filter(t => t.id !== 't2');
  await flush();
  ok(!server.db.tasks.has('t2') && !task('t2') && pendingChanges() === 0, 'the delete was answered');
  server.emit('tasks', 'update', before); // the event of an earlier write, late
  ok(!task('t2'), 'the echo of the record as it was does not bring it back');
  server.emit('tasks', 'update', { ...before, status: 'progress', updated: newer(before) });
  ok(!task('t2'), 'nor does a newer update of it');
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(!task('t2') && !server.db.tasks.has('t2') && server.writes.filter(w => w.kind === 'create').length === 0, 'no create is sent for it');
  await stopSync();
}

console.log('\n== L5: the same while the delete is still in flight');
{
  server.subs = {};
  await start1();
  server.sent.length = 0;
  const before = { ...server.db.tasks.get('t2') };
  S.data.tasks = S.data.tasks.filter(t => t.id !== 't2');
  let inFlight = 0;
  server.rule = (kind, c, id) => {
    if (kind === 'delete' && c === 'tasks' && id === 't2' && !inFlight++) {
      server.emit('tasks', 'update', before);
      server.emit('tasks', 'update', { ...before, status: 'progress', updated: newer(before) });
    }
    return 0;
  };
  await flush();
  server.rule = null;
  ok(inFlight === 1 && !task('t2'), 'events for it while the delete is out do not bring it back');
  server.emit('tasks', 'update', { ...before, status: 'review', updated: String(Number(newer(before)) + 1) }); // and after its answer
  ok(
    !task('t2') && pendingChanges() === 0 && !server.db.tasks.has('t2'),
    `gone from the page and the server, nothing pending (${pendingDetails().join('; ')})`,
  );
  await stopSync();
}
server.patches = false;
finish();
