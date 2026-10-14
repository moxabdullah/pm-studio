# server

[PocketBase](https://pocketbase.io) is the one program that serves both the API and the built app.

| Path                           | What it is                                                                                | In git |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| `pocketbase`, `pocketbase.exe` | the pinned binary, fetched by `scripts/get-pocketbase.sh` or `scripts/get-pocketbase.ps1` | no     |
| `pb_migrations/`               | JS migrations: every collection, field, index and access rule                             | yes    |
| `pb_hooks/`                    | server hooks, one concern per file (see the comment at the top of each)                   | yes    |
| `pb_public/`                   | the built app, from `npm run build:server`                                                | no     |
| `pb_data/`                     | the database and uploaded files. **This is the folder to back up.**                       | no     |

## Everyday commands

```bash
scripts/get-pocketbase.sh   # once (scripts\get-pocketbase.ps1 on Windows); re-run only after bumping the pinned version
npm run server              # http://127.0.0.1:8090, dashboard at /_/ ; extra flags go after --, e.g. -- --http=127.0.0.1:8091
npm run seed:dev -- --dev-database   # demo users and data, into an empty local dev database only; the flag is required
npm run build:server        # build the app into pb_public so PocketBase serves it
```

## Changing the schema

- Add a new migration file with a later timestamp. Never edit one that has been applied anywhere.
- Editing a collection in the dashboard while `npm run server` runs writes a migration file into `pb_migrations/` for you. Commit it. Pass `--automigrate=false` to turn that off, for example on a production server.
- `server/pocketbase migrate create name` writes an empty migration here, and `migrate down 1` reverts the last one. Both default to the `pb_migrations/` and `pb_data/` next to the binary, which is what `npm run server` uses. If you set `PB_DIR`, pass `--dir=$PB_DIR --migrationsDir=server/pb_migrations` to `migrate down`: with `--dir` alone it looks for migrations next to `$PB_DIR` and offers to revert a built-in one.
- Access rules and the reasoning behind them are written at the top of `pb_migrations/1791849600_init_schema.js`.
- `pb_hooks/project_order.pb.js`: a project created by a signed-in user (not a superuser) gets an `order` one below the lowest of all projects, whatever the client sent, so the server decides where a new project goes. An update by a signed-in user may only set `order` to a finite number between -1e12 and 1e12 (400 otherwise), so one extreme value cannot make every later create tie; a superuser's value is kept.
- `pb_migrations/1791849604_activity_workspace.js` adds `activity.workspace` and fills it in for existing rows. An existing install applies it on the next `serve`; no other step.
- New accounts are created by an admin in the dashboard. `pb_hooks/users_defaults.pb.js` gives them the `member` role and a public email; email addresses are case-insensitive (`1791849601_users_email_nocase.js`).
- PocketBase is pinned in the two `get-pocketbase` scripts. Upgrading is a deliberate change: bump the version and the checksums together, then run the migrations and the checks you care about against a copy of `pb_data`.
