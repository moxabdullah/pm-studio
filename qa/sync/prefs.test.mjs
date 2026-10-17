import { server } from './stub-pb.mjs';
import { ok, known, finish } from './check.mjs';
import { bindSync, startSync, stopSync, flush, retryNow, quietResync, pendingChanges, pendingDetails, snapshotState, restoreState } from 'app/core/sync.js';
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
console.log('\n== P8: home, defaultTab and timeFmt take only the options of their selects; a name Object.prototype has is never a settings key');
{
  const OPTS = { home: ['home', 'mytasks', 'inbox'], defaultTab: ['board', 'list', 'table', 'overview', 'timeline'], timeFmt: ['12', '24'] };
  ok(
    Object.entries(OPTS).every(([k, o]) => o.includes(DEFAULTS[k])),
    "each default is one of its setting's options",
  );
  ok(eq(prefsOf({ prefs: DEFAULTS }), DEFAULTS), 'the defaults themselves are kept');
  for (const [k, o] of Object.entries(OPTS)) for (const v of o) ok(prefsOf({ prefs: { [k]: v } })[k] === v, `${k} ${JSON.stringify(v)} is kept`);
  ok(
    eq(prefsOf({ prefs: { home: 'inbox', defaultTab: 'list', timeFmt: '24' } }), { ...DEFAULTS, home: 'inbox', defaultTab: 'list', timeFmt: '24' }),
    'home inbox, defaultTab list and timeFmt 24 are accepted together',
  );
  for (const [k, v, want] of [
    ['home', 'constructor', 'home'],
    ['home', '__proto__', 'home'],
    ['home', 'toString', 'home'],
    ['home', 'zzz', 'home'],
    ['home', 'project', 'home'],
    ['home', '', 'home'],
    ['home', 'Inbox', 'home'],
    ['home', 5, 'home'],
    ['defaultTab', 'zzz', 'board'],
    ['defaultTab', 'constructor', 'board'],
    ['defaultTab', 'calendar', 'board'],
    ['defaultTab', 'Board', 'board'],
    ['defaultTab', '', 'board'],
    ['timeFmt', '13', '12'],
    ['timeFmt', '24h', '12'],
    ['timeFmt', '', '12'],
    ['timeFmt', 24, '12'],
  ])
    ok(prefsOf({ prefs: { [k]: v } })[k] === want, `${k} ${JSON.stringify(v)} reads as ${JSON.stringify(want)}`);
  ok(
    eq(prefsOf({ prefs: { home: 'zzz', defaultTab: 'zzz', timeFmt: '13', theme: 'dark' } }), { ...DEFAULTS, theme: 'dark' }),
    'a refused option falls back on its own, the rest of the record is kept',
  );
  const p = prefsOf({ prefs: { toString: 'x', constructor: 'x', hasOwnProperty: 'x', valueOf: true, isPrototypeOf: 1, toLocaleString: 'x', futureKey: 'x' } });
  ok(
    ['toString', 'constructor', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'toLocaleString'].every(k => !Object.hasOwn(p, k)),
    'keys Object.prototype has are dropped',
  );
  ok(
    typeof p.toString === 'function' && p.constructor === Object && typeof p.hasOwnProperty === 'function',
    'and the methods of the settings object are still its own',
  );
  ok(p.futureKey === 'x' && Object.keys(p).length === 18 + 1, `an unknown simple key is still kept (${Object.keys(p).length} keys)`);
}
{
  await thinStart();
  server.emit(
    'user_prefs',
    'update',
    prefsRec(thinDoc({ home: 'constructor', defaultTab: 'zzz', timeFmt: '13', toString: 'x', constructor: 'x', futureKey: 'x' }), '0002'),
  );
  ok(
    S.prefs.home === 'home' && S.prefs.defaultTab === 'board' && S.prefs.timeFmt === '12',
    `a live record with home constructor, defaultTab zzz, timeFmt 13: the page reads ${S.prefs.home}, ${S.prefs.defaultTab}, ${S.prefs.timeFmt}`,
  );
  ok(
    typeof S.prefs.toString === 'function' && !Object.hasOwn(S.prefs, 'toString') && S.prefs.constructor === Object && !Object.hasOwn(S.prefs, 'constructor'),
    'S.prefs keeps its methods',
  );
  ok(S.prefs.futureKey === 'x', 'an unknown simple key is kept');
  await sleep(50);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 0, `nothing was sent (${prefWrites().length})`);
  server.emit('user_prefs', 'update', prefsRec(thinDoc({ home: 'inbox', defaultTab: 'list', timeFmt: '24', futureKey: 'x' }), '0003'));
  ok(
    S.prefs.home === 'inbox' && S.prefs.defaultTab === 'list' && S.prefs.timeFmt === '24',
    `a later record with home inbox, defaultTab list, timeFmt 24: the page reads ${S.prefs.home}, ${S.prefs.defaultTab}, ${S.prefs.timeFmt}`,
  );
  await sleep(50);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(prefWrites().length === 0, `nothing was sent (${prefWrites().length})`);
  await stopSync();
}
{
  // a record that arrives while the user's own change is waiting: theirs is read, mine is sent whole, and none of it is a refused name
  await thinStart();
  S.prefs.timeFmt = '24';
  server.emit('user_prefs', 'update', prefsRec(thinDoc({ home: 'zzz', toString: 'x' }), '0002'));
  ok(S.prefs.timeFmt === '24' && S.prefs.home === 'home' && typeof S.prefs.toString === 'function', 'my unsent timeFmt survives a record with refused values');
  await flush();
  const w = prefWrites();
  ok(w.length === 1 && eq(w[0].f.docPatch.prefs, { ...DEFAULTS, timeFmt: '24' }), `one PATCH with the full prefs, timeFmt 24, no refused key (${w.length})`);
  ok(pendingChanges() === 0, `the echo clears the op (${pendingDetails().join('; ')})`);
  await stopSync();
}
{
  // a top-level doc key named like an Object.prototype member: dropped on read, so the record never looks changed
  const doc = fromRecord('user_prefs', {
    id: 'up1',
    user: 'u1',
    updated: '0001',
    doc: JSON.parse('{"toString":"x","constructor":{"a":1},"valueOf":1,"__proto__":{"b":2},"later":"x"}'),
  });
  ok(
    ['toString', 'constructor', 'valueOf', '__proto__'].every(k => !Object.hasOwn(doc, k)) && doc.later === 'x',
    'top-level keys Object.prototype has are dropped from the record, an unknown one is kept',
  );
  await thinStart(thinDoc({}, JSON.parse('{"toString":"x","constructor":{"a":1},"__proto__":{"b":2}}')));
  await sleep(50);
  ok(pendingChanges() === 0, `a record holding them leaves nothing pending (${pendingDetails().join('; ')})`);
  S.prefs.theme = 'dark';
  await flush();
  const w = prefWrites();
  ok(
    w.length === 1 &&
      !(w[0].f.docUnset || []).includes('toString') &&
      !Object.hasOwn(w[0].f.docPatch || {}, 'toString') &&
      Object.keys(w[0].f.docPatch || {}).join() === 'prefs',
    `a later save sends one PATCH of prefs alone (${w.length}: ${JSON.stringify(w[0]?.f.docUnset)} ${Object.keys(w[0]?.f.docPatch || {})})`,
  );
  await sleep(50);
  ok(pendingChanges() === 0, `and its echo clears the op (${pendingDetails().join('; ')})`);
  server.emit('user_prefs', 'update', prefsRec(thinDoc({ theme: 'dark' }, JSON.parse('{"hasOwnProperty":"x"}')), '0009'));
  await sleep(50);
  ok(pendingChanges() === 0, `a live record adding one leaves nothing pending (${pendingDetails().join('; ')})`);
  await stopSync();
}

// ---------- B1 (checked, did not reproduce): stray pending favs / ws on the user's settings record ----------
// Each line asserts that the case leaves nothing pending and writes nothing on its own, and passes: the suspected bug is not there. A
// FAIL line in B1 would mean it is. B1v (below) is different: it pins down a known behaviour that is tracked and not fixed here.
console.log('\n== B1: can the settings record leave a favourite or a workspace this tab does not have pending, with no action of the user?');
const prefAttempts = () => server.writes.filter(w => w.c === 'user_prefs').length; // refused ones too
const lone = () => JSON.stringify(pendingDetails());
// Looks at the page right now and 250 ms on (the page's own save() waits 150 ms, then flushes by itself).
// normalizing: the known behaviour of B1v, one write of the favs that the page makes on its own (pending until its save() runs)
async function b1Look(tag, what, w0, normalizing = false) {
  const first = lone();
  await sleep(250);
  const later = lone();
  const sent = prefAttempts() - w0;
  const saved = sent
    ? JSON.stringify(
        prefWrites()
          .slice(-sent)
          .map(w => Object.keys(w.f.docPatch || {}).concat(w.f.doc ? ['doc(whole)'] : [])),
      )
    : '';
  ok(first === (normalizing ? '["update user_prefs/up1 doc.favs"]' : '[]'), `${tag} ${what}: pending at once ${first}`);
  ok(later === '[]', `${tag} ${what}: pending 250 ms later ${later}`);
  ok(
    normalizing ? sent === 1 && saved.includes('favs') : sent === 0,
    `${tag} ${what}: user_prefs writes the page made on its own (${sent}${sent ? `; what was stored: ${saved}` : ''})`,
  );
}
const faved = (list, id) => !!S.data[list].find(x => x.id === id)?.fav;
const storedDoc = () => server.db.user_prefs.get('up1').doc;
for (const patches of [true, false]) {
  const tag = `patches=${patches}`;
  // (a) signing in with a record whose favs name records that are not loaded (pX1, tX1: not in the seed)
  await thinStart(thinDoc({}, { favs: { projects: ['p1', 'pX1'], tasks: ['t2', 'tX1'] } }));
  server.patches = patches;
  ok(faved('projects', 'p1') && faved('tasks', 't2'), `B1a ${tag}: the loaded ones are flagged (p1 ${faved('projects', 'p1')}, t2 ${faved('tasks', 't2')})`);
  await b1Look(tag, 'B1a sign-in with favs [p1,pX1] / [t2,tX1]', 0);
  S.prefs.theme = 'dark'; // a real save later: the unloaded ids must still be the record's
  await flush();
  await sleep(50);
  ok(
    JSON.stringify(storedDoc().favs) === JSON.stringify({ projects: ['p1', 'pX1'], tasks: ['t2', 'tX1'] }) && pendingChanges() === 0,
    `B1a ${tag}: after a later theme save the stored favs are ${JSON.stringify(storedDoc().favs)}, pending ${lone()}`,
  );
  await stopSync();

  // (b) a live update adding an unloaded favourite
  await thinStart(thinDoc({}, { favs: { projects: ['p1'], tasks: [] } }));
  server.patches = patches;
  let w0 = prefAttempts();
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { favs: { projects: ['p1', 'pX1'], tasks: ['tX1'] } }), '0002'));
  await b1Look(tag, 'B1b live update adds pX1 and tX1', w0);
  w0 = prefAttempts();
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { favs: { projects: ['p1', 'pX1', 'pX2'], tasks: [] } }), '0003'));
  await b1Look(tag, 'B1b a second live update adds pX2 and drops tX1', w0);
  ok(faved('projects', 'p1'), `B1b ${tag}: p1 is still flagged`);
  await stopSync();

  // (c) a record whose ws is a workspace that is not loaded (wX): at sign-in, and via a live update
  await thinStart(thinDoc({}, { ws: 'wX' }));
  server.patches = patches;
  ok(S.data.ws.id === 'w1', `B1c ${tag}: signed in with ws wX, the page is in ${S.data.ws.id}`);
  await b1Look(tag, 'B1c1 sign-in with ws wX', 0);
  S.prefs.theme = 'dark'; // a real save later (no live update in between): what does the record keep as its ws?
  await flush();
  await sleep(50);
  console.log(`    (info) B1c1 ${tag}: after a later theme save the server holds ws ${JSON.stringify(storedDoc().ws)}, pending ${lone()}`);
  await stopSync();
  await thinStart(thinDoc({}, { ws: 'wX' }));
  server.patches = patches;
  w0 = prefAttempts();
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { ws: 'wX', collapsed: true }), '0002')); // the record again, another tab changed something else
  await b1Look(tag, 'B1c1b sign-in with ws wX, then a live update of that record (still ws wX, collapsed changed)', w0);
  S.prefs.theme = 'dark';
  await flush();
  await sleep(50);
  console.log(`    (info) B1c1b ${tag}: after a later theme save the server holds ws ${JSON.stringify(storedDoc().ws)}, pending ${lone()}`);
  await stopSync();
  await thinStart(thinDoc());
  server.patches = patches;
  w0 = prefAttempts();
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { ws: 'wX' }), '0002'));
  ok(S.data.ws.id === 'w1', `B1c ${tag}: the live record names wX, the page stays in ${S.data.ws.id}`);
  await b1Look(tag, 'B1c2 live update names ws wX', w0);
  w0 = prefAttempts();
  server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { ws: 'w1' }), '0003')); // and back
  await b1Look(tag, 'B1c2b a live update names w1 again', w0);
  await stopSync();

  // (d) the user favourites a loaded record (a real save), the echo comes back carrying an extra unloaded id
  await thinStart(thinDoc({}, { favs: { projects: ['pX1'], tasks: [] } }));
  server.patches = patches;
  w0 = prefAttempts();
  S.data.tasks.find(t => t.id === 't1').fav = true;
  await flush();
  await sleep(50);
  const sentFavs = prefWrites().map(w => JSON.stringify(w.f.docPatch?.favs ?? w.f.doc?.favs));
  console.log(`    (info) B1d ${tag}: ${prefAttempts() - w0} attempt(s); favs sent: ${sentFavs.join(' ; ')}; pending ${lone()}`);
  ok(
    pendingChanges() === 0 && sentFavs.every(f => f.includes('"t1"') && f.includes('pX1')),
    `B1d ${tag}: the real save went out with t1 and the unloaded pX1, nothing pending afterwards`,
  );
  w0 = prefAttempts();
  const echoed = JSON.parse(JSON.stringify(storedDoc()));
  echoed.favs.projects = ['pX1', 'pY1'];
  echoed.favs.tasks = ['t1', 'tY1'];
  server.emit('user_prefs', 'update', prefsRec(echoed, '9999')); // its echo, with ids another tab added meanwhile
  ok(faved('tasks', 't1'), `B1d ${tag}: t1 is still flagged after the echo`);
  await b1Look(tag, 'B1d the echo carries extra unloaded pY1 and tY1', w0);
  await stopSync();

  // (d2) the same, but the echo reaches the page before the server's answer to the save does (the stream is not ordered against the answer)
  await thinStart(thinDoc({}, { favs: { projects: ['pX1'], tasks: [] } }));
  server.patches = patches;
  w0 = prefAttempts();
  server.rule = (kind, c) => {
    if (kind === 'update' && c === 'user_prefs' && !server.rule.done) {
      server.rule.done = true;
      server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { favs: { projects: ['pX1', 'pY1'], tasks: ['t1', 'tY1'] } }), '9999'));
    }
    return 0;
  };
  S.data.tasks.find(t => t.id === 't1').fav = true;
  await flush();
  await sleep(50);
  server.rule = null;
  console.log(`    (info) B1d2 ${tag}: ${prefAttempts() - w0} attempt(s) for the user's save`);
  await b1Look(tag, 'B1d2 the echo (extra pY1, tY1) lands while the save is in flight', prefAttempts());
  await stopSync();

  // (e) the user's favourite is refused (400) and the server's copy is read back: it holds an unloaded favourite and an unloaded workspace
  await thinStart(thinDoc({}, { favs: { projects: ['pX1'], tasks: [] }, ws: 'wX' }));
  server.patches = patches;
  S.data.tasks.find(t => t.id === 't1').fav = true;
  server.rule = (kind, c) => (kind === 'update' && c === 'user_prefs' ? 400 : 0);
  await flush();
  await sleep(50);
  server.rule = null;
  console.log(`    (info) B1e ${tag}: t1 flagged after the refusal ${faved('tasks', 't1')}, ${prefAttempts()} attempt(s), page in ${S.data.ws.id}`);
  await b1Look(tag, 'B1e a refused favourite, read back with pX1 and ws wX', prefAttempts());
  await stopSync();

  // Variants that are not the claim: a record whose favs are not in the order / form the page writes (the page sorts and de-duplicates).
  // KNOWN BEHAVIOUR, tracked and not fixed here: a LIVE record like that makes the page send one normalizing PATCH of favs (pending at
  // once, sent by its own save() within 150 ms); the lines assert exactly that. Signing in with such a record sends nothing.
  for (const [what, favs] of [
    ['unsorted loaded ids [p2,p1]', { projects: ['p2', 'p1'], tasks: [] }],
    ['duplicate [p1,p1]', { projects: ['p1', 'p1'], tasks: [] }],
    ['unsorted unloaded [pX2,pX1]', { projects: ['pX2', 'pX1'], tasks: [] }],
  ]) {
    await thinStart(thinDoc());
    server.patches = patches;
    w0 = prefAttempts();
    server.emit('user_prefs', 'update', prefsRec(thinDoc({}, { favs }), '0002'));
    await b1Look(tag, `B1v live update with favs ${what}`, w0, true);
    await stopSync();
    await thinStart(thinDoc({}, { favs }));
    server.patches = patches;
    await b1Look(tag, `B1v sign-in with favs ${what}`, 0);
    await stopSync();
  }
}
// ---------- K1: a setting changed back while its update is in flight ----------
// KNOWN on main, the same bug as K1 in msgs.test.mjs, for the settings record: the answer to an update is merged against the baseline from
// before the send (settle -> applyRecord -> applyPrefsRecord -> mergePrefs), so `collapsed` set and set back while the PATCH is out takes
// the answer's value. A later PR fixes it; the checks report KNOWN until then and ok after. The second round changes another setting
// (the density) instead, which main handles.
const INFLIGHT_WHY = "an update's own answer is merged against the pre-send baseline (settle -> applyPrefsRecord -> mergePrefs)";
for (const [what, back, bug] of [
  ['then back to false', true, true],
  ['then the density goes to compact', false, false],
]) {
  console.log(`\n== K1: S.ui.collapsed goes to true, ${what} while the update is in flight`);
  await thinStart();
  S.ui.collapsed = true;
  let inFlight = 0;
  server.rule = (kind, c) => {
    if (kind === 'update' && c === 'user_prefs' && !inFlight++) {
      if (back) S.ui.collapsed = false;
      else S.prefs.density = 'compact';
    }
    return 0;
  };
  await flush();
  server.rule = null;
  const mine = () => (back ? S.ui.collapsed === false : S.prefs.density === 'compact' && S.ui.collapsed === true);
  const doc = () => server.db.user_prefs.get('up1').doc;
  const stored = () => (back ? doc().collapsed === false : doc().prefs.density === 'compact');
  ok(
    inFlight === 1 && prefWrites().length >= 1 && prefWrites()[0].f.docPatch?.collapsed === true,
    'the update (collapsed true) was sent, and the second edit landed while it was in flight',
  );
  ok(doc().collapsed === true, 'the server stored collapsed true');
  (bug ? known : ok)(mine(), `the page keeps the second edit (collapsed ${S.ui.collapsed}, density ${S.prefs.density})`, INFLIGHT_WHY);
  await flush();
  (bug ? known : ok)(stored(), `the second edit is sent and stored (collapsed ${doc().collapsed}, density ${doc().prefs.density})`, INFLIGHT_WHY);
  (bug ? known : ok)(mine() && pendingChanges() === 0, `the page keeps it, nothing pending (${pendingDetails().join('; ')})`, INFLIGHT_WHY);
  await stopSync();
}
// ---------- L: a live event for the settings older than the baseline ----------
// applyPrefsRecord() ignores a live event whose `updated` is older than what it knows, as applyRecord() does (a late echo of an earlier write).
const olderU = rec => String(Number(rec.updated) - 1);
const withTheme = (rec, theme, updated) => prefsRec({ ...rec.doc, prefs: { ...rec.doc.prefs, theme } }, updated);
console.log('\n== L1: settings: a live update older than the baseline is ignored');
{
  await thinStart();
  S.prefs.theme = 'dark';
  await flush();
  const rec = server.db.user_prefs.get('up1');
  ok(S.prefs.theme === 'dark' && pendingChanges() === 0 && olderU(rec) < rec.updated, `the edit is stored and the baseline is its answer (${rec.updated})`);
  server.emit('user_prefs', 'update', withTheme(rec, 'light', olderU(rec)));
  ok(S.prefs.theme === 'dark', `an older event that says light changes nothing (${S.prefs.theme})`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(
    prefWrites().length === 1 && server.db.user_prefs.get('up1').doc.prefs.theme === 'dark',
    `no second write, the server still has dark (${prefWrites().length} writes)`,
  );
  server.emit('user_prefs', 'update', withTheme(rec, 'light', String(Number(rec.updated) + 1)));
  ok(S.prefs.theme === 'light', `a newer event that says light is taken (${S.prefs.theme}): the guard is about age only`);
  await stopSync();
}

console.log('\n== L2: settings: own update answered, a newer edit sent and answered, then the older echo of the first arrives');
{
  await thinStart();
  S.prefs.theme = 'dark';
  await flush();
  const echo = { ...server.db.user_prefs.get('up1') }; // the live event of the first write, delivered late
  S.prefs.theme = 'light';
  await flush();
  const rec = server.db.user_prefs.get('up1');
  ok(
    rec.doc.prefs.theme === 'light' && echo.updated < rec.updated && prefWrites().length === 2,
    `both edits were stored, the second newer (${echo.updated} < ${rec.updated})`,
  );
  server.emit('user_prefs', 'update', echo);
  ok(S.prefs.theme === 'light', `the older echo (dark) does not undo the newer edit (${S.prefs.theme})`);
  ok(pendingChanges() === 0, `nothing pending (${pendingDetails().join('; ')})`);
  await flush();
  ok(
    prefWrites().length === 2 && server.db.user_prefs.get('up1').doc.prefs.theme === 'light',
    `nothing more is sent, the server still has light (${prefWrites().length} writes)`,
  );
  server.emit('user_prefs', 'update', rec);
  ok(S.prefs.theme === 'light' && pendingChanges() === 0, 'the echo of the second write changes nothing');
  await stopSync();
}

console.log('\n== L3: settings: the same, with the newer edit still in flight when the older echo arrives');
{
  await thinStart();
  S.prefs.theme = 'dark';
  await flush();
  const echo = { ...server.db.user_prefs.get('up1') };
  S.prefs.theme = 'light';
  let inFlight = 0;
  server.rule = (kind, c) => {
    if (kind === 'update' && c === 'user_prefs' && !inFlight++) server.emit('user_prefs', 'update', echo);
    return 0;
  };
  await flush();
  server.rule = null;
  ok(inFlight === 1 && S.prefs.theme === 'light', `the echo that came while the second edit was out left it alone (${S.prefs.theme})`);
  await flush();
  ok(
    server.db.user_prefs.get('up1').doc.prefs.theme === 'light' && pendingChanges() === 0 && prefWrites().length === 2,
    `stored light, nothing pending (${pendingDetails().join('; ')})`,
  );
  await stopSync();
}
server.patches = false;
finish();
