# server

[PocketBase](https://pocketbase.io) is the one program that serves both the API and the built app.

| Path                           | What it is                                                                                | In git |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| `pocketbase`, `pocketbase.exe` | the pinned binary, fetched by `scripts/get-pocketbase.sh` or `scripts/get-pocketbase.ps1` | no     |
| `pb_migrations/`               | JS migrations: every collection, field, index and access rule                             | yes    |
| `pb_hooks/`                    | server hooks, one concern per file (see the comment at the top of each)                   | yes    |
| `pb_public/`                   | the built app, from `npm run build:server`                                                | no     |
| `pb_data/`                     | the database and uploaded files. **This folder is the backup.**                           | no     |

## Everyday commands

```bash
scripts/get-pocketbase.sh   # once (scripts\get-pocketbase.ps1 on Windows); re-run only after bumping the pinned version
npm run server              # http://127.0.0.1:8090, dashboard at /_/ ; extra flags go after --, e.g. -- --http=127.0.0.1:8091
npm run seed:dev            # demo users and data, into an empty local database only
npm run build:server        # build the app into pb_public so PocketBase serves it
```

## Changing the schema

- Add a new migration file with a later timestamp. Never edit one that has been applied anywhere.
- Editing a collection in the dashboard while `npm run server` runs writes a migration file into `pb_migrations/` for you. Commit it. Pass `--automigrate=false` to turn that off, for example on a production server.
- `server/pocketbase migrate create name` writes an empty migration here, and `migrate down 1` reverts the last one.
- Access rules and the reasoning behind them are written at the top of `pb_migrations/1791849600_init_schema.js`.
- New accounts are created by an admin in the dashboard. `pb_hooks/users_defaults.pb.js` gives them the `member` role and a public email; email addresses are case-insensitive (`1791849601_users_email_nocase.js`).
- PocketBase is pinned in the two `get-pocketbase` scripts. Upgrading is a deliberate change: bump the version and the checksums together, then run the migrations and the checks you care about against a copy of `pb_data`.
