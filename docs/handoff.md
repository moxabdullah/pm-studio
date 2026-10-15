# Handoff — workspace templates PR open for review; follow-ups #8–#16 merged (2026-10-15)

## Goal

Work through the follow-ups left after PRs #1–#3, one PR per theme, each branched from `main` unless it builds on an open PR. PRs #4–#7 are merged.

**Session of 2026-10-15 (templates): replace the hard-coded project templates** (the user: "no use for me"). Their answers (binding):

- Scope: **templates only**, one PR. Custom stages, fields and labels (the rest of the old Phase 3 line) are a later theme (Next 9).
- Who manages: **admins and managers**; members use templates.
- What a template copies: task title, status (Backlog stays, the rest become To do), priority, estimate, description, dates as days from the project start, subtasks, labels. Not assignees.
- The six built-ins are **deleted**; "Blank project" stays as the no-template choice (the `'blank'` sentinel, not a record).
- Per workspace.

Progress:

- Branch `feat/workspace-templates` (worktree `wt/templates` in the 14ce156e scratchpad), commits 376f875 (feature), 4be72ad (review fixes), 136c514 (byte-size check, `aria-describedby`), plus this handoff. PR opened for review, **not merged** (the user hasn't said to merge): `gh pr list --head feat/workspace-templates`. PR body: `pr-templates.md` in the 14ce156e scratchpad.
- Checks: lint/format/build; server rules on scratch PocketBase (member writes refused, workspace move 404, name 81 chars 400, doc over 2 MB 400, cascade, migrate down/up); sync round trip a fixed point at 300×50; logic/UI/security reviews (all P2s fixed, P3s tracked in the PR body); browser QA 15/15 on 376f875 and 12/12 on 4be72ad (`qa-templates/`, `qa-templates/r2/` in the 14ce156e scratchpad). 136c514 is not browser-tested. cubic not yet checked.
- After merge: back up `pb_data`, `npm run build:server`, restart :8090 (applies 1791849606).

**Session of 2026-10-14 (afternoon): the user asked to complete ALL of Next 1–8.** Their answers (binding):

- New name: **"PM Space"** (Next 6). Package `pm-space`; seed/dev emails on a reserved domain.
- Permission toggles (`permCreate`, `permPublic`): **hide them** (keep their `DEFAULT_PREFS` entries).
- `showDoneBoard`, `spell`, `timeFmt`: **wire them up** (client-side).
- **Merge each PR myself once clean** (cubic P0–P1 fixed, reviewers clear at P0–P2, QA passes), then branch the next from the new `main`.
- Logo: the drawn "gr8r" wordmark (`LOGO_D` in `src/core/icons.js`, `public/favicon.svg`, `src/assets/logo.svg`) is replaced by a **simple text mark**: "PM Space" in the app font for the wordmark, a white "PM" monogram on the black tile for favicon/app icon.
- Old keys: **rename outright**, no legacy string anywhere (`gr8r.auth` → new key, so everyone signs in again once; the `gr8r.v2` cleanup goes; the stored `settings.meta.appName` is overwritten by a migration even if customised). Say this in the PR body.

PR plan (branches; worktrees under this session's scratchpad `wt/`): `fix/files-nested-buttons` (Next 5), `fix/pref-value-checks` (Next 1 + the `toString` bullet), `fix/view-state-pending` (Next 2), `fix/sync-messages` (Next 3 + PR #5 toast gaps), `feat/server-order-activity-ws` (Next 4), `feat/settings-wire-up` (Next 7), then `fix/stray-pending-favs-ws`, `fix/prefs-merge-per-key`, `fix/refusal-putbacks` (Next 8), and last `chore/rename-pm-space` (Next 6; it renames `window.__gr8r`, so update the QA kit then).

Progress (update after each step):

- **Local server (2026-10-15):** `server/pocketbase serve` runs detached on 127.0.0.1:8090 with the production flags of `docs/deploy.md` §3.3, serving `npm run build:server` output from a17eb0d (restarted 05:25 after #16; 1791849605 applied, backup first: `/root/backups/pm-studio/pb_data.2026-10-15-before-605-rename`); log `server/pocketbase.log` (git-ignored). The real DB is EMPTY: no superuser, no users, no data. First admin per deploy.md §6 (installer link: `grep pbinstall server/pocketbase.log`, valid 30 min from 04:22; or `server/pocketbase superuser upsert EMAIL PASS --dir=server/pb_data`). Never `seed:dev` here. Stop: `pkill -f '^server/pocketbase serve'` (keep the `^`: without it the pattern also matches the Bash tool's own shell and kills it). After any pull: `npm run build:server`, restart it.
- #8 `fix/files-nested-buttons` (Next 5): **merged** as 9ede460.
- #10 `feat/settings-wire-up` (Next 7): **merged** as 797e277.
- #9 `fix/pref-value-checks` (Next 1 + `toString`): **merged**. Follow-up found: `DEFAULT_PREFS.tz` is `(GMT-07:00) Pacific Time` but the select offers `(GMT-08:00)`.
- #13 `fix/view-state-pending` (Next 2): **merged**; `main` is 65c50a9 (build clean, views harness 501/501 on it).
- #11 `fix/sync-messages` (Next 3 + PR #5 gaps): **merged** as 07090a0 (QA re-run on 5961fe4 4/4, `qa-out/msgs11/r2-*`; cubic clean). Builder commit c4d4bbd keeps a Sonnet 5.5 trailer because Sonnet wrote it.
- #12 `feat/server-order-activity-ws` (Next 4): **merged 2026-10-15 as 55861c6** (user allowed merges). 1791849604 is now applied to the real `server/pb_data` (2026-10-15; backup first: `/root/backups/pm-studio/pb_data.2026-10-15-before-migrate-up`). Other deployments still need it (a restart applies it). cubic thread replies were blocked by the classifier ("External System Writes"); drafts in the old session scratchpad `thread-replies.md`.
- #14 `fix/prefs-record-merge` (Next 8): **merged 2026-10-15 as 0395d96** (head 60bce4d = 7114f50 + main 55861c6; harnesses 578/357/346, 0 FAIL). Logic review: no P0–P2; its P3s are in the PR body as tracked (the main one: the "own workspace deleted → fallback is not the user's choice" rule only works if the other tab's record arrived before the deletion; also clicking the current workspace isn't noticed as a choice, a delete of the prefs record keeps `st.wsWanted`, and the saved-ws-not-loaded-at-install case is remembered after the first echo). Held-PATCH overwrite tracked (server-side).
- #15 `fix/refusal-putbacks` (Next 8): **merged 2026-10-15 as 35065b8** (head 6dd7589: refused projects go back to their server places together; QA 32/0 + multi 22/0, cubic clean). The QA line for the PR body was not added (classifier); text in the old session scratchpad `pr15-qa-line.md`. Tracked in the body: stuck path unjournaled; attachment edit lands after a refused file delete; Undo resets whole order; refusals in separate rounds can shift an earlier put-back.
- #16 `chore/rename-pm-space` (Next 6): **merged 2026-10-15 as a17eb0d** (user: "Merge it", so the `gr8r.auth` leftover stays, option (a); cubic's three rename-conflict threads are left open for the user) — https://github.com/moxabdullah/pm-studio/pull/16, head 3c381ae on main 35065b8 (worktree `wt/rename-pm-space` in the 23fdd914 scratchpad). Commits: rename b95ec36; seed address on `example.net` e2057d4; deploy guide help for installs under the earlier names + restore chained with `&&` 12e8c18; new `docs/preview.png` 714fa72 (QA capture, 2880x1800); Settings workspace-URL prefix = `location.host` 719d9af; cubic's deploy.md:622 fix 3c381ae.
  - QA: rename scenario 57/58 (the one FAIL is pre-existing, see Next 8), wire10 33/33 with the kit's handle reads changed to `(window.__pmspace || window.__gr8r)` in `kit/`, `kit-base/`, `kit-pref/`, and the 4790e61c `pref-check.mjs`; wsurl 3/3. Migration smoke: main + custom appName → only 605 runs, name becomes "PM Space"; fresh install too. Reviews (logic/UI/docs+security): no P0–P1; P2s fixed except the old `gr8r.auth` leftover (user's decision; PR body asks them to confirm).
  - cubic: 4 P2s. deploy.md:622 fixed and replied to (resolving the thread was refused by the classifier; the user resolves it). The other three (keep the `gr8r.v2` cleanup, clear `gr8r.auth`, restore migration 600's value) conflict with the rename decision; replied in each thread and left open for the user.
  - Post-merge done: `pb_data` backed up, `npm run build:server`, :8090 restarted; `/` serves `<title>PM Space</title>`.
- Harness copies: one per PR line, each `test.mjs` holds absolute `src` paths into a worktree (`sed` them to reuse). For `main`: `wt/hc-harness-views` (501), `wt/hc-harness-pref` (357), `wt/hc-harness-msgs` (346, M1 + M1f). `wt/hp-views` adds Q1 (#14) and `server.stamp()` in its stub; `wt/hr-*` flip the file-delete scenario and add R1 (#15).

This session's scratchpad (kits and harness copied here): `/tmp/claude-0/-root-workspace-projects-pm-studio/23fdd914-d276-439a-b190-d68b95d8d6a8/scratchpad/` — `kit/` (scenario kit; now also `rename-scenario.mjs` and `wsurl-scenario.mjs`), `kit-base/`, `kit-pref/`, `harness/` (307/307 on 0d1ef0b). PR #16 QA output and PR body: `/tmp/claude-0/-root-workspace-projects-pm-studio/1ef68d54-e986-4cfb-8de1-73baa61f8f94/scratchpad/` (`qa/rename`, `qa/wire10`, `qa/wsurl2`, `pr-rename.md`).

## Done

- **PR #7 merged** into `main` as 0d1ef0b with the user's OK: https://github.com/moxabdullah/pm-studio/pull/7 (branch `fix/missing-pref-defaults`, commit 42809e8, only `src/core/sync-map.js`; no migrations). cubic: "No issues found in 1 file", 0 review threads.
  - **Fix:** `DEFAULT_PREFS` gains `timeFmt: '12'`, `spell: true`, `defaultTab: 'board'`, `showDoneBoard: true`, `permCreate: true`, `permPublic: false`, `confirmDel: true`. Each one is what its readers already take an unset value for (`|| 'board'`, `|| '12'`, `!== false`, `!!P.permPublic`). `prefOk()` is unchanged: a key with a default needs the default's type. The comment on `DEFAULT_PREFS` states the rule (see Decisions).
  - **Before/after (browser):** with a record holding `defaultTab: 5`, `main` shows "Something went wrong." on every project opened through the default tab (`tab.startsWith is not a function`, project.js:39). The fix opens on Board, with no errors and nothing pending. On a thin record, the seven controls show the old unset values, and toggling "Allow public share links" sends one PATCH 200 with all 18 keys and leaves nothing pending.
  - **Harness:** 307/307 on the fix. On `main`, the new P7 group fails 20 of 25: a refused `spell`/`permPublic`/`defaultTab` change stays pending and is sent on every flush.
  - **Outage kit on the fix, two runs:** steps 1–4, 4b, 5b, 6, 8 and 9 pass in both, and the give-up toast is exact with no "(and N more)". Step 7 failed in run 1 on one stale-title sample (known noise). Steps 5 and 7 failed in run 2: the sampler caught the edit mid-render at 0.04 s and took it for the revert. The final states were right in both runs. No `main` baseline run this time.
  - **Reviews (logic, security):** nothing at P0–P2. Their P3s are in the PR's gaps and in Next below.
  - **Behaviour change (in the PR body):** a record holding one of the seven with the wrong type (`permPublic: 1`) now reads as the default. The app has only ever written booleans and strings there.
- **PR #6 merged** as d99d300: a settings record without some keys reads as the page's defaults (`cleanPrefs()` returns `{ ...DEFAULT_PREFS, ...accepted entries }`; `prefOk()` shared with `applyUserPrefs`; `DEFAULT_PREFS` in `sync-map.js`).
- **PR #5 merged** as 9400ba7 (after a minute of 5xxs, go online only on evidence from that try). **PR #4 merged** as b29c549 (offline saves: `savedToast()`, `data-live`). **PR #3 merged** as 0162231. Migrations are unchanged since PR #2 (1791849600–1791849603 applied to `server/pb_data`, no backup; back up `server/pb_data/data.db` before the next schema change).
- **The scout's map of `save()` sites** (39 handlers outside sync.js; only the upload at actions.js:1081 is guarded): inline editing actions.js:1227, :1237, subtasks.js:60; prefs/theme/colours actions.js:238, 280, 285, 292, 2233–2252, 2282; saved views actions.js:1420–1448; view state actions.js:1310–1407; notifications actions.js:1989–2012; workspace actions.js:2067; Undo `restore()` actions.js:178; project order actions.js:480, drag-drop.js:229, :259; recent searches palette.js:172. (Line numbers as of b29c549.)

## Next (follow-ups, roughly in order of value)

1. **Free-string settings that pick a page.** Self-only (a user's own record), no XSS (both are escaped or compared only).
   - `home` is not checked against `ROUTE_NAMES` (`src/main.js:89`, `go(S.prefs.home)` actions.js:2450). `renderPage` indexes a plain object literal (`layout.js:44–67`), so `home: "constructor"` renders "[object Object]" and `"__proto__"` shows the failed state. Validate like the hash path, or build the table with `lookup()`.
   - `defaultTab` (and `timeFmt`) take any string. `defaultTab: "zzz"` shows the not-found body inside every project opened through the default tab. The settings dropdown then shows "Board" (no option matches), and picking Board does nothing (`pick(i)` returns when `selectedIndex === i`, src/ui/select.js:101), so the user has to pick another tab first. Fix: allow only the `PTABS` keys and `'12'|'24'`, either in `prefOk()` (duplicated list, like `VIEW_FIELDS`) or at the readers (links.js already has `TABS`).
2. **Opening a project leaves `update user_prefs doc.views` pending** until the next save. `viewOf()` creates the per-project view state without `save()`. Found by QA on PR #7, on `main` and the fix alike with a clean record: `pendingDetails()` shows it within seconds of opening a project, with no PATCH for 25 s or more. Consequences: a user who only browsed has `hasUnsaved()` true (sign-out warning), and an edit made during an outage would give up with "(and 1 more)". Same class as PR #6. Decide whether a default view state counts as a change at all, or save it when it is created.
3. **Wording:**
   - The sign-out warning says "can't be reached" even when the server answers with errors.
   - One 404 per give-up: the read-back of an activity record whose create was refused (`adoptServerTruth`). Still there on PR #7 (kit step 9).
4. **Server-side data.** The server should allocate project `order`, and `activity` needs a `workspace` relation. Both need migrations, so back up `pb_data` first.
5. **Nested buttons.** `.fcard` in `src/views/files.js:55` has the same nested-button problem the drawer tile had.
6. **Remove every mention of gr8r studio.**
   - Known spots: the seed emails `@gr8rstudio.com` in `src/data/seed.js`; the dev credentials in `scripts/seed-dev.js:34-35`; `window.__gr8r` (the QA kit reads it, so update the kit too); the package name `gr8r-studio`.
   - Search the whole repo for `gr8r`, case-insensitive, before calling it done.
7. **The permission toggles enforce nothing** (security review on PR #7). No code reads `permCreate` or `permPublic`. They are per-user settings any user can flip, not workspace permissions; `A.newProject` has no check, and the server's `projects` create rule lets any signed-in user create. A real guard has to be server-side and workspace-level, not a `user_prefs` key. `showDoneBoard`, `spell` and `timeFmt` also have no reader outside the settings page. Ask the user whether to wire them up or hide them.
8. **Smaller gaps** (low value; each pre-existing):
   - (PR #16 QA) The sign-in card's "Sign in to <workspace>" subtitle (`<p class="sub">`, src/pages/auth.js) is never shown: the sidebar's global `.sub { …; display:none }` in src/styles/shell.css also matches it. Both date from the initial commit. Scope the sidebar rule.
   - (PR #16 P3s, in its body) The "PM" monogram is live text fitted with `textLength`, so the favicon (no web font) is squeezed in wide fallback fonts; outline the two glyphs as paths. The sign-in card's 30px wordmark sits above a same-weight heading. The 10px palette wordmark has tight letter-spacing. Linux `pb_data` is world-readable under the default umask, and on Windows `C:\pm-space` inherits Authenticated Users: Modify (deploy guide).
   - (PR #14) The stray-pending class remains for `favs` and `ws`: after an echo the baseline can hold a favourite of an unloaded record or an unloaded workspace id, so a `doc.favs`/`doc.ws` update waits for the next save. Also for an unknown settings key that a live record drops: `applyUserPrefs` never deletes from `S.prefs`.
   - (PR #14) `prefs` is one merge unit in `merge3`: an unsent change to one setting overwrites another tab's change to a different setting. Related: once a user saves any setting, the record holds all 18 values, so a later change to a default reaches only users who never saved.
   - Unknown settings keys such as `toString` are accepted and shadow the method on `S.prefs` (nothing calls it today). Refusing unknown keys or a null-prototype `S.prefs` would close it.
   - (PR #15) From PR #3: a refused project reorder is not put back, although the toast says "discarded"; a refused file delete reappears only on the next reload; a force-applied put-back isn't journaled, so Undo within about 60 s could re-send the refused value.
   - From PR #12 (cubic P2, tracked): a project whose `order` a superuser or migration left outside ±1e12 blocks a member's reorder around it: `projectOrders()` hands that value to another project, and the update guard refuses it (400).
   - (PR #11, merged) From PR #5: show the lost change in the reconnect toast when the reload was also refused (`recover()`, the `if (refused) … else if (refusals…)` order), and the two red toasts if "Try again" is clicked on the give-up try.
   - (Templates PR, P3s in its body) Offline "Try again" after the project/template went away does nothing silently (`templates.js` `still`); an offline retry can replace a same-name template saved meanwhile without asking; a hand-picked icon equal to a template's counts as template-set (`pickIcon`); `loadAll` is one `Promise.all`, so a new client against a server without 1791849606 fails its first load.
9. **Rest of Phase 3: custom stages, fields and labels** (`docs/phase-1-backend.md:14`). Statuses are a fixed list used by the board, timeline, filters and `sync-map.js` view validation; labels are the `LABELS` constant (`core/constants.js`), not data. A multi-PR theme: ask the user how Sam Engineering's stages differ before designing.

## Decisions (still binding)

- **Every setting the page writes needs a `DEFAULT_PREFS` entry, equal to what its readers take an unset value for** (PR #7). Without one, any simple value gets in, and a refused change to it can't be put back. Check every reader (`|| x`, `!== false`, `!!`) before choosing.
- **A settings key the record lacks, or holds with a value `prefOk()` refuses, reads as its `DEFAULT_PREFS` value** (PR #6). `cleanPrefs()` and `applyUserPrefs()` share `prefOk()`; the store must be able to hold exactly what `cleanPrefs()` yields, or a stray pending update comes back. `DEFAULT_PREFS` lives in `sync-map.js`. Keep the dev seed thin: it is the fixture for an older record.
- **Going online after a minute of 5xxs needs evidence from that try** (PR #5): a list read that landed, or a change the server stored or refused with a 4xx. The stream registering is not evidence.
- **Offline edits: keep queuing, honest UI** (PR #4).
  - Form edits through `mutate()` are refused offline.
  - Inline editing, view state, preferences, saved views, project order, read state and Undo call `save()` themselves; they are kept and sent on reconnect.
  - Any toast on those paths must not say "saved" while offline; use `savedToast()`.
  - Don't make the editors read-only offline.
- **`data-live` marks a text field that saves to the store on every keystroke.** `remoteRender()` leaves it to the store, so a put-back can reach it. Add `data-live` to any new keystroke-saving textarea or input; not to form fields that commit on submit or blur.
- **Give-up timing works by stepping streaks, not by sending.** On a 5xx from a failed recovery, `stepSick()` counts a failure for every change already in a `sick` streak. Sending in `recover()`'s catch was rejected (stale baseline; in `wholeDoc` mode it would overwrite other users' doc keys). Merge-before-send stays a rule.
- **A failure streak belongs to one version of an op** (`sigOf`): an edit is never discarded sooner than 60 s after it was made; an unchanged op gives up at 75 s.
- **`putBack()` comes in as a live change from what was sent**, not as a forced overwrite. Don't route it through `applyRecord(..., true)`. It only reverts updates of collection records; deletes, creates and settings stay on `baseline()` (reasons in the comment above `putBack()`).
- **Give-up toast** says "discarded", not "undone". `user_prefs` is counted in "(and N more)" on purpose.
- **View validation is duplicated on purpose.** `sync-map.js` cannot import app modules, so `VIEW_FIELDS` and `VIEW_GROUPS` copy `FIELDS` and the `groupTasks()` cases. Change both sides together.
- **`sortTasks` uses `Object.hasOwn`.**
- **Retry keys.** Field edits take `latestFields(kind, id, [fields])` before `mutate` and AND it into `still`; form submits keep one `latest(form)` key per input; deletes are not keyed; keys expire 10 min after their last attempt.
- **The retry pattern.** Look the record up by id inside `fn` and pass `still: () => !!task(id)`. Never compare records by identity. Templates: `A.promoteSub` and `A.archiveTask`.
- **Accepted design.** A successful retry on a "Create more" form resets the live form. Label, dependency and drag `order` values are computed at click time.
- **`server/README.md` migrate paths are correct.** cubic flagged them twice, and both flags were invalid.
- **Stopping rule for cubic.** Fix any P0 or P1. Track P2 and P3 edge cases as follow-ups instead of starting another round.
- **Templates are readable by every signed-in user**, whatever project they came from; saving a private project warns about it. Their size caps (300 tasks, 50 subtasks each) are in `constants.js` and copied on purpose in `normalize.js`: change both together, or a template is cut on read and stays pending for ever. `templateTasks()` must write exactly the shape `normalize.js` yields.

## Gotchas

- Force-pushing is refused by the auto-mode classifier. To bring a PR branch up to date, merge `main` into it in a separate worktree and push that as a fast-forward (`git push origin <local>:<pr-branch>`).

- `npm run seed:dev -- --dev-database`: the flag is required, and so is the `--`. In a worktree it looks for `server/pocketbase` inside the worktree: symlink the main checkout's binary (git-ignored) and remove it afterwards.
- Migration 1791849606 was edited in place before the first push. A scratch database migrated from 376f875 keeps the old rule and caps; QA templates on a fresh database.
- Scratch PocketBase servers go on 8095 and up; :8090 is the real server.
- `docs/handoff.md` is tracked, and CI runs `npm run format:check` on it: run `npx prettier --write docs/handoff.md` before committing it.
- `git push` over HTTPS: `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.
- `gh pr create --body-file` works. `gh pr edit` fails; use `gh api -X PATCH repos/moxabdullah/pm-studio/pulls/N -F body=@file`.
- To merge: `gh api -X PUT repos/moxabdullah/pm-studio/pulls/N/merge -f sha=<full sha> -f merge_method=merge`.
- Pushing: plain `git push` fails here (no credential helper); use `git -c credential.helper= -c credential.helper='!gh auth git-credential' push …`. Force-pushes are blocked: merge `main` into a PR branch instead of rebasing.
- cubic: the check run on the head commit says how many issues it found (`gh api repos/.../commits/<sha>/check-runs`, name contains "cubic"); it takes about 4 min. It usually auto-resolves its threads on a re-review, but on PR #4 it didn't (resolve by hand with the GraphQL `resolveReviewThread` mutation; check with `reviewThreads { isResolved }`).
- `jq` is not installed; use `node -e` (or `gh --jq`) to read JSON.
- `server/pocketbase migrate up` against the real `pb_data` may be refused by the auto-mode classifier. Read `_migrations` with a read-only sqlite connection instead.
- **Browser QA kit** (all in session scratchpads; it goes when they do, unless moved into the repo):
  - Base kit: `/tmp/claude-0/-root-workspace-projects-pm-studio/c65476ff-0cb4-46aa-9823-2974d81ec98a/scratchpad/qa/kit/`. `run.sh <checkout> <out-dir>`; fresh seeded PocketBase (:8092), fault proxy :8091 (`/__fault?mode=ok|5xx|down`), vite :5179; about 5 min. `EXPECT=main|fix|fix2` selects the expectations (`EXPECT=fix2 AFTER_GIVEUP_S=120` is the current one). `PB_PORT`/`PROXY_PORT`/`VITE_PORT` move the ports, so two runs can go in parallel on separate worktrees.
  - The kit's 250 ms sampler is flaky on steps 5 and 7: one stale-title sample right after the revert, or catching the edit mid-render at ~0.04 s and taking it for the revert. Read the step's samples before calling it a regression.
  - Scenario kit (runs any scenario file via `SCENARIO=<file>`): `/tmp/claude-0/-root-workspace-projects-pm-studio/ff7b9355-b66d-4c81-8c1f-a1b0c7494714/scratchpad/qa-fix/kit/`. Scenarios: `focus-scenario.mjs`, `fix2-scenario.mjs`, `prefs-scenario.mjs` (PR #6).
  - PR #7 runs: `/tmp/claude-0/-root-workspace-projects-pm-studio/4790e61c-33ab-4f7d-8bbe-ff647500ff53/scratchpad/qa/` (`kit-pref/pref-check.mjs`: writes a bad value into the user's own record through the page's `pb` client, opens a project, checks the seven controls; outputs in `out/A-main`, `A-fix`, `B-fix`, `C-fix`, `C-fix-rerun`, `CTL-*`). PR #6 runs: `…/2c56e069-791e-4457-af01-ab53ca3f0c5c/scratchpad/`. PR #5 runs and `analyze.mjs`: `…/7f521f41-889b-4177-bfbf-830c516cafd3/scratchpad/qa-flap/`.
  - Run it against a worktree, never the repo: `git worktree add --detach <path> <sha>`, plus `git diff -- src | git -C <path> apply` for uncommitted work. Remove the worktree afterwards.
  - The kit's give-up detection accepts any `role="alert"` toast; match the toast to the record name.
  - After a 5xx outage, reconnecting waits for the 15–30 s poll. Don't read that as a regression.
  - `window.__pmspace.sync.pendingDetails()` (`window.__gr8r` before PR #16) lists the pending ops (`update user_prefs/<id> doc.prefs`) — the quickest way to see a stray op in the browser.
- **Node harness for sync.js:** newest copy `/tmp/claude-0/-root-workspace-projects-pm-studio/4790e61c-33ab-4f7d-8bbe-ff647500ff53/scratchpad/harness/` (307 checks: F1–F10 from PR #5, P1–P6 from PR #6, P7 from PR #7; it expects the 18 defaults). From that scratchpad: `node harness/build.mjs $PWD/harness && node harness/test.bundle.mjs` (exit code 0 = all ok; count `^    ok  ` / `^    FAIL`). Its stub PocketBase only applies `docPatch` and answers `X-Doc-Patch: yes` when `server.patches = true` (on only in the P groups; without it `wholeDoc` flips and a thin-echo bug cannot show). `server.emit(coll, action, rec)` sends live events. `server.sent` records only updates that were stored; `server.writes` records every attempt, refused ones too (P7's `prefTries()` counts those). Imports are absolute paths into the repo, so it runs against whatever the repo has checked out; to run against another checkout, copy it and `sed` the `src` path.
- Resuming a finished subagent with SendMessage is unreliable. Start a fresh agent with a self-contained brief. A qa agent may hand back before its background run ends; wait for the run's log line `exit=N` with a background `until grep` job.
- QA agents miscount: one reported "17 keys" in a PATCH that carried 18. Check key counts and pass/fail totals in the result files yourself before quoting them.
