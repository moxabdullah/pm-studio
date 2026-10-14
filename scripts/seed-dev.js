/* npm run seed:dev: creates demo users and pushes the current seed() data into a local PocketBase, so the app can be tried
   with realistic content. Start the server first (npm run server) and run this against a fresh database.

   It must never touch anything but a throwaway local database. Guarantees:
   - It does nothing unless you pass --dev-database ("npm run seed:dev -- --dev-database"): you vouch that this is a dev database.
     An empty database is not proof of that, because a brand-new production database is empty too.
   - It only talks to 127.0.0.1, localhost or ::1 (PB_URL, default http://127.0.0.1:8090). Any other host is refused before a request is made.
   - It refuses to run if any collection it writes to already has records (only if it is a throwaway dev database: delete server/pb_data and restart the server to reseed).
   - The dev superuser is created with the local PocketBase binary, straight into the local data directory (PB_DIR, default
     server/pb_data), so its password exists nowhere else. That only happens after the database has been checked and found empty;
     the check itself signs in with a throwaway superuser that is deleted again.
   - The accounts it creates share one well-known password, which is printed at the end. Never expose this database to a network.

   Every payload comes from toRecord() in src/core/sync-map.js, so seeded records have exactly the shape the app syncs. */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import * as constants from '../src/core/constants.js';
import { COLLECTIONS, USER_PREFS, buildUserPrefs, toFormData, toRecord, toRecords } from '../src/core/sync-map.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const bin = path.join(root, 'server', windows ? 'pocketbase.exe' : 'pocketbase');
const dataDir = process.env.PB_DIR ? path.resolve(process.env.PB_DIR) : path.join(root, 'server', 'pb_data');
const shownDir = path.relative(root, dataDir).startsWith('..') ? dataDir : path.relative(root, dataDir);

const OPT_IN = '--dev-database';
// every collection the seed writes to, parents first
const WRITTEN = [...COLLECTIONS.map(c => c.coll), USER_PREFS];

const SUPERUSER = { email: 'dev@pmspace.local', password: 'pmspace-dev-superuser' };
const USER_PASSWORD = 'pmspace-dev-1234';
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mOISr/xnxLMMGrAqAGjBgwXAwDi/ZgfvjB42gAAAABJRU5ErkJggg==',
  'base64',
);

/* ---------- safety ---------- */
function localOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PB_URL is not a URL: ${raw}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!/^https?:$/.test(url.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`refusing to seed ${raw}. Only 127.0.0.1, localhost and ::1 are allowed: this script creates accounts with a known password.`);
  }
  return url.origin;
}

function pocketbaseCli(args) {
  const run = spawnSync(bin, [...args, `--dir=${dataDir}`], { encoding: 'utf8' });
  if (run.error || run.status !== 0) throw new Error(`"pocketbase ${args.slice(0, 2).join(' ')}" failed: ${run.error?.message || run.stderr || run.stdout}`);
}

async function signIn(origin, account) {
  const pb = new PocketBase(origin);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(account.email, account.password);
  } catch (err) {
    if (err.status === 0) throw new Error(`cannot reach PocketBase at ${origin}. Start it with "npm run server".`);
    throw new Error(
      `could not sign in to ${origin} as a superuser created in ${shownDir}. The server there does not use that data directory: ` +
        `start it with "npm run server", or set PB_DIR to the directory it runs with.`,
    );
  }
  return pb;
}

async function requireServer(origin) {
  try {
    await fetch(`${origin}/api/health`);
  } catch {
    throw new Error(`cannot reach PocketBase at ${origin}. Start it with "npm run server".`);
  }
}

/* A throwaway superuser looks at the database before the dev superuser (with a known password) is allowed into it. */
// The password starts with a letter: base64url can start with "-", which the PocketBase CLI would read as a flag.
const newProbe = () => ({ email: `seed-probe-${randomBytes(4).toString('hex')}@pmspace.local`, password: 'p' + randomBytes(18).toString('base64url') });

function dropProbe(probe) {
  try {
    pocketbaseCli(['superuser', 'delete', probe.email]);
  } catch {
    // PocketBase won't delete the only superuser. What's left has a random password nobody knows.
  }
}

/* Returns why the database must not be seeded, or '' when every collection the seed writes to is empty. */
async function whyNotEmpty(origin, probe) {
  const pb = await signIn(origin, probe);
  const counts = await Promise.all(
    WRITTEN.map(coll =>
      pb
        .collection(coll)
        .getList(1, 1)
        .then(page => [coll, page.totalItems])
        .catch(err => {
          if (err.status === 404) throw new Error(`the ${coll} collection is missing. Is the server running with this repo's migrations ("npm run server")?`);
          throw err;
        }),
    ),
  );
  const used = counts.filter(([, total]) => total);
  if (!used.length) return '';
  const found = used.map(([coll, total]) => `${total} ${coll}`).join(', ');
  return `the database already has ${found}. If it is a throwaway dev database, seed a fresh one: stop the server, delete ${shownDir}, start it again. Never do that to real data.`;
}

/* ---------- seed data ---------- */
async function loadSeed() {
  // utils.js reads the DOM when it is imported; seed() itself does not need one.
  globalThis.document ??= { querySelectorAll: () => [] };
  globalThis.navigator ??= { platform: process.platform, userAgent: 'node' };
  const { seed } = await import('../src/data/seed.js');
  return seed();
}

/* Valid PocketBase ids are 15 characters of [a-z0-9]. 'seed' + the old id, right-aligned and zero-padded, keeps them readable and
   unique (padding on the right would make t1 and t10 collide). Activity ids are random in seed(), so they are numbered instead. */
function newId(space, old, index) {
  if (space === 'activity') return 'seeda' + String(index + 1).padStart(10, '0');
  const text = String(old);
  return 'seed' + (/^[a-z0-9]{1,11}$/.test(text) ? text.padStart(11, '0') : createHash('sha1').update(text).digest('hex').slice(0, 11));
}

/* Rewrites every reference by field, never by searching for strings: task labels like 'design' look like team ids. */
function remap(seedData) {
  const d = structuredClone(seedData);
  d.teams ??= (constants.TEAMS_SEED || []).map(t => ({ ...t }));
  const spaces = {
    users: d.members,
    workspaces: d.workspaces,
    teams: d.teams,
    projects: d.projects,
    tasks: d.tasks,
    comments: d.comments,
    activity: d.activity,
    notifs: d.notifs,
    files: d.files,
    events: d.events,
    views: d.savedViews,
  };
  const ids = Object.fromEntries(Object.entries(spaces).map(([space, list]) => [space, new Map(list.map((x, i) => [x.id, newId(space, x.id, i)]))]));
  const ref = (space, old) => {
    if (old == null || old === '') return old;
    const id = ids[space].get(old);
    if (!id) throw new Error(`the seed data refers to ${space} "${old}", which does not exist`);
    return id;
  };
  const refs = (space, list) => (list || []).map(old => ref(space, old));
  const has = (obj, key) => obj[key] !== undefined;
  const firstWorkspace = d.workspaces[0].id;

  d.members.forEach(m => {
    m.id = ref('users', m.id);
    if (m.team) m.team = ref('teams', m.team);
  });
  d.workspaces.forEach(w => (w.id = ref('workspaces', w.id)));
  d.teams.forEach(t => {
    t.id = ref('teams', t.id);
    t.workspace = ref('workspaces', t.workspace || firstWorkspace);
  });
  d.projects.forEach(p => {
    p.id = ref('projects', p.id);
    p.workspace = ref('workspaces', p.workspace || firstWorkspace);
    p.team = ref('teams', p.team);
    p.lead = ref('users', p.lead);
    p.members = refs('users', p.members);
  });
  d.tasks.forEach(t => {
    // attachments mirror the files collection: the same name on the same task (files still carry their old ids at this point)
    t.attachments = (t.attachments || []).map(a => {
      const file = d.files.find(f => f.name === a.name && f.task === t.id);
      if (!file) console.warn(`seed:dev: attachment "${a.name}" of task ${t.id} has no matching file, so its id is left as it is`);
      return { ...a, id: file ? ref('files', file.id) : a.id, by: ref('users', a.by) };
    });
    t.deps = refs('tasks', t.deps);
    t.id = ref('tasks', t.id);
    t.project = ref('projects', t.project);
    t.assignee = ref('users', t.assignee);
  });
  d.comments.forEach(c => {
    c.id = ref('comments', c.id);
    c.task = ref('tasks', c.task);
    c.by = ref('users', c.by);
    c.re = Object.fromEntries(Object.entries(c.re || {}).map(([emoji, who]) => [emoji, refs('users', who)]));
  });
  d.activity.forEach(a => {
    a.id = ref('activity', a.id);
    a.by = ref('users', a.by);
    a.task = ref('tasks', a.task);
    a.project = ref('projects', a.project);
    a.workspace = ref('workspaces', a.workspace);
  });
  d.notifs.forEach(n => {
    n.id = ref('notifs', n.id);
    n.by = ref('users', n.by);
    if (has(n, 'task')) n.task = ref('tasks', n.task);
    if (has(n, 'project')) n.project = ref('projects', n.project);
  });
  d.files.forEach(f => {
    f.id = ref('files', f.id);
    f.project = ref('projects', f.project);
    f.by = ref('users', f.by);
    if (has(f, 'task')) f.task = ref('tasks', f.task);
  });
  d.events.forEach(e => {
    e.id = ref('events', e.id);
    e.project = ref('projects', e.project);
  });
  d.savedViews.forEach(v => {
    v.id = ref('views', v.id);
    v.project = ref('projects', v.project);
    // filter values hold member ids ('none' = unassigned) and project ids; every other field's values are plain vocabulary
    v.filters = (v.filters || []).map(f => {
      if (f.f === 'assignee') return { ...f, v: (f.v || []).map(x => (x === 'none' ? x : ref('users', x))) };
      if (f.f === 'project') return { ...f, v: refs('projects', f.v) };
      return f;
    });
  });
  d.projOrder = refs('projects', d.projOrder);
  d.me = ref('users', d.me);
  // the current workspace: by id when the seed has one, otherwise the workspace of the same name
  const current = d.workspaces.find(w => w.id === ids.workspaces.get(d.ws?.id)) || d.workspaces.find(w => w.name === d.ws?.name) || d.workspaces[0];
  d.ws = { ...d.ws, id: current.id };
  return d;
}

/* ---------- creating records ---------- */
function describe(err) {
  const fields = err?.response?.data && Object.keys(err.response.data).length ? ` ${JSON.stringify(err.response.data)}` : '';
  return `${err?.response?.message || err?.message || err}${fields}`;
}

async function insert(pb, coll, payload) {
  try {
    await pb.collection(coll).create(payload);
  } catch (err) {
    throw new Error(`could not create ${coll} ${payload instanceof FormData ? payload.get('id') : payload.id}: ${describe(err)}`);
  }
}

/* Every seeded file gets a small real upload, so downloads work: a tiny valid PNG for images, a line of text for the rest. */
function fileForm(payload, file) {
  const content =
    file.type === 'img'
      ? new Blob([PLACEHOLDER_PNG], { type: 'image/png' })
      : new Blob([`Placeholder for "${file.name}".\nCreated by npm run seed:dev.\n`], { type: 'text/plain' });
  return toFormData(payload, content, file.name);
}

async function main() {
  if (!process.argv.includes(OPT_IN)) {
    throw new Error(
      `this fills the database with demo accounts that share a published password, so it needs your word that the database is a throwaway one. ` +
        `Run: npm run seed:dev -- ${OPT_IN}`,
    );
  }
  const origin = localOrigin(process.env.PB_URL || 'http://127.0.0.1:8090');
  if (!fs.existsSync(bin)) {
    throw new Error(
      `PocketBase is not installed (${path.relative(root, bin)} is missing). Run ${windows ? 'scripts\\get-pocketbase.ps1' : 'scripts/get-pocketbase.sh'} first.`,
    );
  }

  await requireServer(origin);
  const probe = newProbe();
  pocketbaseCli(['superuser', 'upsert', probe.email, probe.password]);
  let reason;
  try {
    reason = await whyNotEmpty(origin, probe);
  } catch (err) {
    dropProbe(probe);
    throw err;
  }
  if (reason) {
    dropProbe(probe);
    throw new Error(`refusing to seed: ${reason}`);
  }

  pocketbaseCli(['superuser', 'upsert', SUPERUSER.email, SUPERUSER.password]);
  dropProbe(probe);
  const pb = await signIn(origin, SUPERUSER);

  const data = remap(await loadSeed());
  const created = {};
  for (const { key, coll } of COLLECTIONS) {
    const payloads = toRecords(key, data);
    for (const [i, payload] of payloads.entries()) {
      const obj = data[key][i];
      if (key === 'members') {
        await insert(pb, coll, {
          ...payload,
          email: obj.email,
          emailVisibility: true,
          verified: true,
          password: USER_PASSWORD,
          passwordConfirm: USER_PASSWORD,
        });
      } else {
        await insert(pb, coll, key === 'files' ? fileForm(payload, obj) : payload);
      }
    }
    created[coll] = payloads.length;
  }

  // what is personal to the seed user: favourites, notification settings, recent searches, current workspace
  const prefs = buildUserPrefs({ data, prefs: {}, views: {}, ui: { collapsed: false } }, 'seed' + 'prefs'.padStart(11, '0'));
  await insert(pb, 'user_prefs', toRecord('user_prefs', prefs, { me: data.me }));
  created.user_prefs = 1;

  for (const [coll, count] of Object.entries(created)) {
    const found = (await pb.collection(coll).getList(1, 1)).totalItems;
    if (found !== count) throw new Error(`${coll}: created ${count} but the server reports ${found}`);
  }

  console.log('\nSeeded the dev database:');
  for (const [coll, count] of Object.entries(created)) console.log(`  ${String(count).padStart(3)}  ${coll}`);
  console.log(`\nDashboard   ${origin}/_/`);
  console.log(`Superuser   ${SUPERUSER.email}  /  ${SUPERUSER.password}`);
  console.log('\nApp users (they share one password):');
  const width = Math.max(...data.members.map(m => m.email.length));
  for (const m of data.members) {
    console.log(
      `  ${m.email.padEnd(width)}  ${USER_PASSWORD}  ${toRecord('members', m).role.padEnd(7)}  ${m.name}${m.id === data.me ? ' (the seed user)' : ''}`,
    );
  }
}

main().catch(err => {
  console.error(`seed:dev: ${describe(err)}`);
  process.exit(1);
});
