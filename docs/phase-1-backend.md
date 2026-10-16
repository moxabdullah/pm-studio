# Phase 1: PocketBase backend

Turn PM Space from a single-browser demo into a shared app that about 20 Sam Engineering staff use from one company server.

## Goal

- Everyone signs in with a real account.
- Everyone sees the same projects, tasks, comments and files, and sees changes appear live.
- One server program (PocketBase) serves both the app and the data, so IT runs one thing and backs up one folder.

## Not in this phase

- Department roles and permission rules beyond "signed in" and "private projects": Phase 2.
- Sam Engineering stages, fields and labels: Phase 3. Its first part, project stages, is in: each workspace keeps its own stage sets, see `stage_sets` below, and a project's stage, stage set, health and stage history are keys in its `doc`. Task labels are in too: each workspace keeps its list of them in one `workspace_lists` record, see below. So are the project fields (Settings > Project fields): the definitions are `doc.fields` of the same record, next to `doc.labels`, and a project keeps its values as top-level keys of its own `doc`, `f_<field id>`: one key per field that has a value (a field with no value has no key), so that two people editing different fields of a project do not overwrite each other. (Templates were built ahead of it: each workspace keeps its own, see `templates` below.)
- Service contracts, SLA tickets and timers: Phase 4.
- Microsoft 365 sign-in. This phase only checks that it is possible; see the spike below.

## How the app works today

- All state lives in one in-memory object, `S.data` (`src/core/store.js:35`), built from `seed()` (`src/data/seed.js`).
- Every write goes through `save()` (`src/core/store.js:86`), which stores the whole object in `localStorage`. Most UI writes reach it through `mutate()` (`src/ui/toast.js:29`), which saves and then calls `render()`.
- Login is a mock: `doLogin` (`src/actions/actions.js:2084`) accepts anything.
- Workspaces only change the header name (`A.switchWs`, `src/actions/actions.js:1740`). Projects have no workspace field.
- IDs come from `uid()` (`src/core/utils.js:11`), for example `t4k2j9a`.

## Approach: a sync layer behind `save()`

Don't rewrite the 2,300 lines of actions. Keep `S.data` as the in-memory model and put the server behind it:

1. **Load.** After login, fetch every collection the user can read and build `S.data` in the same shape as `seed()` returns. Keep a snapshot of what was loaded.
2. **Save.** `save()` keeps its 150 ms debounce. It then diffs each collection against the snapshot, sends creates, updates and deletes to PocketBase, and updates the snapshot.
3. **Live updates.** Subscribe to every collection. When a change arrives that this tab didn't make, patch `S.data` and the snapshot, then call `render()`.
4. **Conflicts.** Last write wins per record. That's acceptable for 20 users.

All of this lives in a new module, `src/core/sync.js`. `store.js` calls into it, and nothing else in the app needs to know about the server.

### Record shape

Each collection gets a few real columns that PocketBase needs for filtering and permission rules, plus one `doc` JSON field holding the rest of the app object as-is. This keeps the mapping small and stops new UI fields from breaking sync.

| Collection        | Real columns                                                                                                    | In `doc`                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `users` (auth)    | email, name, title, color, status, role (`admin`, `manager`, `member`); role is stored now, enforced in Phase 2 | tz, other profile fields                                                               |
| `workspaces`      | name, color                                                                                                     | brand flags                                                                            |
| `teams`           | workspace, name                                                                                                 | icon, colour, description                                                              |
| `projects`        | workspace, team, lead, private, members (relation to users), archived, order                                    | key, name, icon, stage, stageSet, health, stageHistory, dates, everything else         |
| `tasks`           | project, status, assignee, archived                                                                             | title, priority, due, labels, est, subtasks, deps, recur, etc.                         |
| `comments`        | task, author                                                                                                    | body, reactions                                                                        |
| `activity`        | project, task, workspace, by                                                                                    | verb, extra                                                                            |
| `notifs`          | recipient                                                                                                       | everything else                                                                        |
| `files`           | project, uploaded_by, file (real upload)                                                                        | display name, type                                                                     |
| `events`          | project                                                                                                         | title, date, time                                                                      |
| `saved_views`     | project, owner                                                                                                  | name, type, filters                                                                    |
| `templates`       | workspace, name                                                                                                 | description, icon, colour, tasks (title, status, dates, ...)                           |
| `stage_sets`      | workspace, name                                                                                                 | stages (id, name, colour key, finished), in order                                      |
| `workspace_lists` | workspace (unique)                                                                                              | labels (id, name, colour key); fields (id, name, type, inTable, options); all in order |
| `user_prefs`      | user (unique)                                                                                                   | prefs, views, collapsed, notifPrefs, recentSearches                                    |

**IDs.** Change `uid()` to produce 15-character lowercase IDs that PocketBase accepts, and send them as the record `id` on create. The app can then keep creating objects synchronously, exactly as it does now. Store an optional prefix such as `t` in `doc` if anything depends on it.

**`D().me`** becomes the signed-in user's ID. `members` is the `users` list.

### Server rules for this phase

- Every collection requires a signed-in user, with no anonymous access.
- `projects`, `tasks`, `comments`, `files`, `events` and `activity`: if a project is private, only its members (and users with `role = admin`) can list, view or change it or anything belonging to it. This replaces the browser-only check in `canSee` (`src/core/store.js:109`).
- `notifs` and `user_prefs`: users can only see and change their own.
- `users`: everyone can view names. Only an admin can create users or change their role. There is no public sign-up; admins create accounts in the PocketBase dashboard.

## App changes

- **Login page** (`src/pages/auth.js`, `doLogin`): email and password via the PocketBase JS SDK, a real error message on failure, and remember-me through the SDK's auth store. Add log out. Hide sign-up, 2FA and the onboarding wizard.
- **Remove or hide demo-only screens:** sessions, invoices, billing and plan badges, and "Delete workspace resets demo data".
- **Workspaces:** projects get a workspace field. Switching workspace changes which projects the sidebar and pages show. Creating a workspace is admin-only.
- **Files:** upload real files to the `files` collection and download them through PocketBase file URLs. Keep the existing list and grid UI.
- **Offline:** if PocketBase is unreachable or a save fails, set `S.ui.offline` and show the existing "couldn't be saved" toast with retry. When the connection returns, reload the data.
  - Form edits (through `mutate()`) are refused while offline with that toast. Inline editing (a description, a subtask's note), view settings (sort, group, filters, columns), preferences, saved views, the project order, read state and Undo keep working: the change stays in the page and is sent once the connection is back, merged with the server's copy first. Closing the tab with unsent changes asks first. Their toasts never say "saved" while offline.
- **Dev seed:** `npm run seed:dev -- --dev-database` creates demo users and pushes the current `seed()` data so we can test with realistic content. It must never run against production.

## Server layout

```
server/
  pocketbase            # pinned binary, not committed; fetched by a script
  pb_migrations/        # JS migrations that define every collection and rule
  pb_hooks/             # empty for now; Phase 4 adds SLA cron here
  pb_public/            # built app (vite build output copied here)
  pb_data/              # database and uploads; gitignored; THIS is the backup
```

- Pin the PocketBase version (currently v0.40.x) in a script such as `scripts/get-pocketbase.sh` (plus a `.ps1` for a Windows server). Upgrades are a deliberate change, never automatic.
- `npm run server` runs PocketBase locally. The Vite dev server proxies `/api` to it.
- `npm run build:server` builds the app into `server/pb_public`.
- Write `docs/deploy.md` covering: install as a service (systemd or Windows service), HTTPS, creating the first admin, adding users, a nightly backup of `pb_data`, restoring from backup, and upgrading.

## Spike: Microsoft 365 sign-in (half a day, report only)

Confirm whether PocketBase's OAuth2 providers include Microsoft/Entra for the pinned version, and list exactly what IT must register in Entra (app registration, redirect URL). Don't build it yet. Write the findings into `docs/deploy.md`.

## Done when

- [ ] Two browsers signed in as different users see each other's task, comment and status changes within about 2 seconds, without reloading.
- [ ] Reloading the page keeps every change, and the browser no longer stores app data in `localStorage` beyond the auth token.
- [ ] A request to the API without signing in is rejected for every collection (checked with `curl`).
- [ ] A user who isn't a member of a private project gets no records for it from the API, not just a hidden UI.
- [ ] Uploading a file in one browser lets another user download it.
- [ ] Stopping PocketBase shows the offline toast, and restarting it recovers without losing edits made before the outage.
- [ ] `npm run lint`, the format check and `npm run build` pass.
- [ ] `docs/deploy.md` exists, and a fresh machine can follow it to a running server.

## Risks

- **Pre-1.0 PocketBase.** Breaking changes between versions. Mitigation: pin the version and keep migrations in git.
- **Live updates while editing.** A remote change arriving while someone is typing in the task drawer must not wipe their text. `S.ui.drafts` and `render()` focus handling must survive a remote patch; test this explicitly.
- **Whole-collection diffing.** Fine at this scale (hundreds to low thousands of tasks). If it slows down, diff only the collections touched since the last save.
- **Repo license.** Upstream still has no license; a request to the maintainers is pending.
