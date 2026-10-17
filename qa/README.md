# qa/

Browser suites and scenarios for PM Space. Each run starts a throwaway PocketBase from a checkout, seeds it with
`npm run seed:dev -- --dev-database`, starts vite against it, runs the suite, and stops everything again (also on a failure and on
Ctrl+C). Nothing here touches the real server on :8090 or its `server/pb_data`.

Limits of that guarantee: a second Ctrl+C while the first is still stopping things does not stop them any faster and can leave
PocketBase or vite running (check `ss -ltnp` for the ports below and stop what is left). A run only stops processes it started
itself; a stranger on one of its ports makes the run refuse to start (or fail), it is never killed. `PM_OUT` must not be the
checkout's `server/` folder (the run refuses it), and a `pb_data` that already exists in the output folder is never reused or
deleted: remove it by hand or pick another folder. For a short time while seeding, the throwaway database has the dev seed's superuser with its published
password (on 127.0.0.1 only); the run deletes it and creates a random-password one right after the seed. The qa package needs Node 20 or later (`engines` in `qa/package.json`),
because the pinned Playwright does; the app itself still builds on Node 18.

A run executes the checkout's own seed script, vite config and pb_hooks with your environment, and Chromium runs without its
sandbox. Only point `PM_SRC` or `compare --a/--b` at code you trust, not at an unreviewed branch from someone else.

```
cd qa
npm install                      # once: playwright 1.64.1 (its Chromium is chromium-1248, from ~/.cache/ms-playwright)
npm run ui -- rt                 # one suite
npm run ui -- r2b r2c            # several, one fresh database each
npm run ui -- all                # every suite (about 25 minutes)
npm run compare -- rt sb --a <checkout> --b <checkout>   # the same suites on two checkouts, per check id
npm run scenario -- giveup       # outage scenario (see below)
npm run sync                     # the sync tests in qa/sync/
```

The checkout under test is `PM_SRC` (default: the repository this `qa/` folder is in). A bare `git worktree` has no PocketBase
binary and no `node_modules`: the runner links `server/pocketbase` (git-ignored) and builds `node_modules` out of per-package links
(a link to the whole folder would put vite's cache into the other checkout) from the repository that holds `qa/`.

## Environment

| Variable                               | Default                      | Meaning                                                                                      |
| -------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `PM_SRC`                               | the repo holding `qa/`       | checkout to test: its migrations, hooks, seed script and vite config are used                |
| `PM_PB_BIN`                            | `<PM_SRC>/server/pocketbase` | PocketBase binary                                                                            |
| `PB_PORT` / `VITE_PORT` / `PROXY_PORT` | 8095 / 5180 / 8091           | the runner refuses to start (exit 3) if one is taken, and never signals a stranger's process |
| `PM_OUT`                               | `qa/out/<suite>-<timestamp>` | output folder; with several suites it is the parent of one folder per suite                  |
| `PM_SUITE_TIMEOUT_S`                   | 1500                         | per script                                                                                   |

Port 8090 is refused. The suites themselves read `PM_BASE`, `PM_PB`, `PM_OUT`, `PM_SU_EMAIL`, `PM_SU_PASSWORD`, which the runner sets.
Run a suite file by hand only with those set.

## Seed

No copied database. `seed:dev` makes the workspaces, projects, tasks and the users (`hello@example.com` is the seed user; all
seeded users share the published password `pmspace-dev-1234`, which exists only in throwaway databases). The script also creates
a superuser with a published password: the runner deletes it right away and creates `qa@pmspace.local` with a random password that
is passed to the suite through the environment and never written to a file (the seed log has that line replaced).
`qa/lib/fixtures.mjs` has what a few suites add through the API (the settings field list).

## Output and counts

Every suite appends one JSON line per check to `<out>/results.jsonl`; the runner counts from that file (lines marked `note` are not
checks; an id that repeats counts again as `id#2`). It also keeps `<script>.out.txt` (console), `pocketbase.log`, `vite.log`,
`seed.log`, screenshots. A run whose check count differs from a complete run's is flagged as a PROBLEM (a suite catches its own
errors and exits 0). Exit code: 0 everything passed, 1 a failure or problem, 2 usage, 3 ports in use.

A check that fails because of a real bug on `main` is listed in `ui/known.mjs` (check id -> reason). It is reported as KNOWN, never
counted as a pass, and does not fail the run. When the bug is fixed the runner says so: delete the entry.

## Suites (`npm run ui -- <name>`)

| Suite      | Covers                                                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdbase`   | project form: half-typed target date, Edit writes only what changed, two sessions                                                                                                                                    |
| `pd`       | the same, longer, plus a project with no target date                                                                                                                                                                 |
| `r2b`      | projects table, overview Details, project form, field values                                                                                                                                                         |
| `r2c`      | fields editor: focus after Delete and Type, copy and confirms, live announcement, name checked at write time                                                                                                         |
| `r3a`      | change detection on the Edit form, half-typed values never saved as a clear, errors in place, live-update backstop                                                                                                   |
| `r3b`      | projects table says when columns are hidden (edge fade, tab stop only while it scrolls)                                                                                                                              |
| `r3c`      | fields editor (read-only Type, remove-options confirm), overview field rows, tiny numbers                                                                                                                            |
| `sA`       | settings fields editor against the server and a second session                                                                                                                                                       |
| `pf`       | drag highlight, focus return from Details picks, phone sidebar out of the Tab order, palette. `PF_ONLY=R` (or `T`, `U`, `3`) runs one section                                                                        |
| `pipeline` | project pipeline board: real-mouse drags across a wide board, scroll retention, keyboard, picker, Escape, file drop, phone and landscape. Five scripts, each on a fresh database. `ONLY=a,b` limits `new-checks`     |
| `rt`       | rail tooltips and a11y (ids `RT*`, `A*`, `R2*`, `R3*`). `RT_ONLY=R2` runs one group (comma list allowed)                                                                                                             |
| `sb`       | collapsed sidebar rail: accessible names, expanded sidebar and phone drawer unchanged, tooltip, keyboard focus. If a folder named `sb-main` (an earlier run) is next to `PM_OUT`, N2, N3 and P1 are compared with it |

`npm run ui -- pipeline:r3-checks` runs one script of a suite (`pipeline` has five: `p2a p2b strict new-checks r3-checks`). Runs with `RT_ONLY`, `PF_ONLY`, `ONLY` (pipeline) or one script skip the check-count test.

The rail tooltip stand-in page that was used to design `src/ui/tooltip.js` is not kept: `rt` drives the real app and its real DOM.

## Comparing two checkouts

`npm run compare -- <suite>... --a <checkout> --b <checkout>` runs the suites on A, then on B (each with its own PocketBase and
vite, one after the other), and prints per suite both pass counts and every id that differs (`DIFF`) or failed on both
(`BOTH-FAIL`). Output is in `qa/out/compare-<timestamp>/{a,b}/<suite>`.

## Scenarios (`npm run scenario -- <name>`)

PocketBase, a fault proxy in front of it (`scenarios/proxy.mjs`: `GET /__fault?mode=ok|5xx|down`; every request and every mode
switch goes to `proxy.log.jsonl`), and vite whose `/api` proxy points at the fault proxy. The scenario drives the browser and flips
the proxy. Defaults are `EXPECT=fix2` and `AFTER_GIVEUP_S=120`.

| Name     | Covers                                                                                                                                                                                                                                              | Time    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `giveup` | rename a task, 5xx for `FAULT_S` (150) s, a second edit under the fault; the give-up toast (text, `role="alert"`), the title reverting, reconnect, sign-out. `EXPECT=main\|fix\|fix2` picks the expectations. Steps are counted from `summary.json` | ~7 min  |
| `net`    | a network failure must never give up (`NET_MODE=abort\|proxy`, `NET_DOWN_S`)                                                                                                                                                                        | ~4 min  |
| `focus`  | focus and caret in the description (A) and the subtask note (B) after a refused change (`EDITORS=A,B`); observations in `result.json`, no pass or fail                                                                                              | ~10 min |
| `fix2`   | C4 typing in the note while remote changes arrive, C5 offline toast wording; `result.json`                                                                                                                                                          | ~3 min  |
| `prefs`  | is a `user_prefs` update pending from page load, and does a PATCH 200 clear it; `result.json`                                                                                                                                                       | ~1 min  |

Other knobs: `GIVEUP_MAX_S` (200), `RECONNECT_MAX_S` (180), `QA_PHASE=smoke` (stop after the first step), `LATER_TYPE_S`, `GIVEUP_BY=store` (focus).

## Gotchas

- Playwright's `dragTo` scrolls with the button held, so a drag can start from the wrong card. The pipeline scripts scroll the card
  into view first and move the mouse in steps (`page.mouse.move(..., { steps })`); do the same in a new drag check.
- vite may listen on `::1` only: the browser uses `http://localhost:<port>`, not `127.0.0.1`.
- The first load of a new vite pre-bundles dependencies and may reload the page; the runner opens the app once before the suites.
- `scenario`: the 250 ms state sampler is coarse. In `giveup`, the drawer and the board row follow the store's revert by up to
  about 0.35 s, so step 7 only counts a "title lost again" sample from 1.25 s after the revert (the bound step 5 uses); step 5 can
  still miss by one sample. Reconnecting after a 5xx outage waits for the sync engine's 15 to 30 s poll, so "reconnect" times vary
  by that much.
- Long suites: run them in the background and wait for the exit (`npm run ui -- all > log 2>&1 &`). Do not pipe a suite into `tail -0`.
- Suites that check the fixed behaviour of a feature fail on a checkout without it (that is their job); use `compare` to see which.
