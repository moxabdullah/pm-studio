# Deploying PM Space

This guide takes a fresh Linux or Windows server to a running PM Space: install, run as a service, HTTPS, accounts, nightly backups, restore and upgrades. It assumes you can administer a server. It does not assume you know PocketBase or Node.js.

An install set up with an earlier version of this guide keeps its own names: the install folder, the service, the user, and the files named after them (unit file, WinSW files, proxy config, cron file, scheduled task). Use yours wherever a command here says `pm-space` or `pmspace`. On Linux, `grep -l 'pocketbase serve' /etc/systemd/system/*.service` finds your unit file, and its `User=` and `WorkingDirectory=` lines give the user and the folder. Section 10.1 says what the update to PM Space changes on such a server.

> **How this guide was checked.** PocketBase's own commands and flags, the superuser and first-start flow, scheduled backups, both restore methods, the Caddy and nginx configs and the Microsoft 365 behaviour were run against the official PocketBase v0.40.5 binary on Ubuntu 24.04. A dry run in a clean copy of the repository (download script, `npm ci`, `npm run build:server`, start with the flags of section 3.3, create the superuser and the first admin, the `401` check, the live-update stream) worked on Linux. The systemd unit was syntax-checked with `systemd-analyze verify` but not started under a live systemd. The Windows steps follow the WinSW v2.12.0 documentation and were not run on a Windows machine. Anything that was not run anywhere is marked _untested_.

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Install](#3-install)
4. [Run as a service](#4-run-as-a-service)
5. [HTTPS](#5-https)
6. [First admin](#6-first-admin)
7. [Adding users](#7-adding-users)
8. [Nightly backup](#8-nightly-backup)
9. [Restoring from backup](#9-restoring-from-backup)
10. [Upgrading](#10-upgrading)
11. [Troubleshooting](#11-troubleshooting)
12. [Spike: Microsoft 365 sign-in](#12-spike-microsoft-365-sign-in)

## 1. Overview

One program, [PocketBase](https://pocketbase.io), does the whole job. It is a single file with an embedded SQLite database. It serves:

- the web app (the built files in `server/pb_public`),
- the API at `/api/`,
- live updates at `/api/realtime` (Server-Sent Events),
- file uploads and downloads,
- an admin dashboard at `/_/`.

```
staff browsers ──HTTPS :443──▶ reverse proxy ──HTTP 127.0.0.1:8090──▶ PocketBase ──▶ server/pb_data
                               (your certificate)                      (app + API + dashboard)
```

**One folder to back up: `server/pb_data`.** It holds the database (`data.db`), the request log (`auxiliary.db`), uploaded files (`storage/`), every setting you change in the dashboard (including the backup schedule and, later, the Microsoft client secret), and the `backups/` folder. Everything else can be rebuilt from git.

**Ports**

| Port | Listener                        | Reachable from                  |
| ---- | ------------------------------- | ------------------------------- |
| 8090 | PocketBase (plain HTTP)         | this machine only (`127.0.0.1`) |
| 443  | reverse proxy (HTTPS)           | staff networks                  |
| 80   | reverse proxy (redirect to 443) | staff networks, optional        |

Never expose 8090. With PocketBase's built-in Let's Encrypt mode (section 5.2) PocketBase itself listens on 80 and 443 and there is no proxy.

**What is in git and what is not**

| In git (`git clone` gives you this)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not in git (created on the server)                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| App source (`src/`, `index.html`, `vite.config.js`)                                                                                                                                                                                                                                                                                                                                                                                                                                  | `server/pocketbase` (`server/pocketbase.exe` on Windows): the PocketBase program, fetched by the script |
| `server/pb_migrations/`: JS files that define every collection and API rule. They are applied automatically when the server starts.                                                                                                                                                                                                                                                                                                                                                  | `server/pb_public/`: the built app (`npm run build:server`)                                             |
| `server/pb_hooks/`: six small hooks. They answer record requests without a sign-in with `401`, give new accounts their defaults (role `member`, email visible to colleagues), make browsers re-check the app page after an update, merge each save into the stored record field by field (so two people editing one task don't undo each other), name each download after the file's display name, and put a project a user creates first in the list (the server picks its `order`) | `server/pb_data/`: database, uploads, settings, logs, backups. **This is what you back up.**            |
| `scripts/` (fetch PocketBase, dev helpers) and `docs/`                                                                                                                                                                                                                                                                                                                                                                                                                               | `node_modules/`                                                                                         |

**Two kinds of account.** A PocketBase **superuser** is for IT: it signs in to the dashboard at `/_/`, bypasses every API rule and manages the server. **App users** are the staff. They live in the `users` collection, sign in to the app itself, and have a `role` of `admin`, `manager` or `member`. There is no public sign-up: an admin creates every account in the dashboard (section 7).

## 2. Requirements

| Need     | Details                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS       | Linux (x86-64 or ARM64) with systemd, or 64-bit Windows 10 / Windows Server 2016 or newer (the minimum for programs built with current Go, which PocketBase is: <https://go.dev/doc/go1.20#windows>).                                                                                                                                                                           |
| Sizing   | A small VM is plenty for about 20 users: 1 to 2 CPU cores and 2 GB RAM (the build is the heaviest step).                                                                                                                                                                                                                                                                        |
| Node.js  | **22** (the version in `.nvmrc`; `package.json` allows 18 or newer). Only needed to _build_ the app. The running server does not use Node. Install it from [nodejs.org](https://nodejs.org).                                                                                                                                                                                    |
| Git      | To clone the repository and pull updates.                                                                                                                                                                                                                                                                                                                                       |
| Tools    | `curl` or `wget`, and `unzip` (or `bsdtar` or `python3`) for the PocketBase download script on Linux. The script says what is missing.                                                                                                                                                                                                                                          |
| Network  | Outbound HTTPS to `github.com` and the host it redirects release downloads to (`release-assets.githubusercontent.com` when this was written), for the PocketBase download, and to the npm registry (`registry.npmjs.org`) for `npm ci`. Inbound 443 from staff networks. Staff browsers also fetch fonts from Google Fonts; without them the app falls back to the system font. |
| Disk     | About 120 MB for the code, `node_modules` (about 75 MB) and the 32 MB PocketBase program. `pb_data` grows with uploads. Each backup zip is about the size of `pb_data`, and PocketBase wants free space of about 2× `pb_data` while it makes one (`core/backup_create.go:33-34`).                                                                                               |
| DNS, TLS | A DNS name for the server (this guide uses `studio.example.com`) and, for section 5.1, a certificate for that name from your internal CA that staff browsers already trust.                                                                                                                                                                                                     |

If the server cannot reach the npm registry, build on another machine and copy the result across: `rsync -a --delete server/pb_public/ admin@server:/opt/pm-space/server/pb_public/` (_untested_).

## 3. Install

Replace these placeholders everywhere they appear:

| Placeholder            | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| `REPO_URL`             | the git URL of this repository                     |
| `/opt/pm-space`        | install folder on Linux (`C:\pm-space` on Windows) |
| `studio.example.com`   | the name staff will type                           |
| `it-admin@example.com` | the email of the IT superuser                      |

### 3.1 Linux

Your own account owns the code. The `pmspace` service account can read it and can write only to `server/pb_data`, so a bug in the service cannot change the program.

```bash
# a service account with no login
sudo useradd --system --home-dir /opt/pm-space --shell /usr/sbin/nologin pmspace

# get the code
umask 022                                  # make sure the service account can read what you create
sudo mkdir -p /opt/pm-space
sudo chown "$USER": /opt/pm-space
git clone REPO_URL /opt/pm-space
cd /opt/pm-space

# PocketBase (the version pinned in the script): downloaded from GitHub, SHA-256 checked, extracted to server/pocketbase
scripts/get-pocketbase.sh

# build the app into server/pb_public
npm ci
npm run build:server

# the only folder the service account may write to
mkdir server/pb_data
sudo chown pmspace:pmspace server/pb_data
sudo chmod 700 server/pb_data              # without this the database and uploads are readable by every local user
```

Check that the folder is closed: `sudo -u nobody ls /opt/pm-space/server/pb_data` must fail with "Permission denied".

### 3.2 Windows

In an elevated PowerShell, with [Git for Windows](https://git-scm.com/download/win) and [Node.js 22](https://nodejs.org) installed (_untested_):

```powershell
git clone REPO_URL C:\pm-space
icacls C:\pm-space /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-19:(OI)(CI)RX"
cd C:\pm-space
powershell -ExecutionPolicy Bypass -File scripts\get-pocketbase.ps1   # downloads and checks server\pocketbase.exe
npm ci
npm run build:server
```

The `icacls` line comes first, before anything is built or started, because a folder created directly under `C:\` inherits "Authenticated Users: Modify", so any local user could replace the server program or its hooks, which run as LocalService. After it only administrators (`*S-1-5-32-544`), the system (`*S-1-5-18`) and the service account (`*S-1-5-19`, LocalService) can open the folder. icacls accepts SIDs on any Windows language, while account names such as `BUILTIN\Administrators` can fail on a localized one, and `/grant:r` replaces earlier grants for them, so running the line again is safe. Use an elevated PowerShell for upgrades too. LocalService is shared by several built-in Windows services, so this keeps out local users, not other LocalService processes; a dedicated virtual service account for PM Space would close that gap (this guide does not set one up).

Check that the folder is closed: `icacls C:\pm-space` lists only those three accounts, with no `Authenticated Users` or `Users` entry.

### 3.3 First start

Run the server once in a terminal to check it works. These are the same flags the service will use (section 4.3 explains them). On Linux:

```bash
sudo -u pmspace /opt/pm-space/server/pocketbase serve \
  --http=127.0.0.1:8090 \
  --dir=/opt/pm-space/server/pb_data \
  --migrationsDir=/opt/pm-space/server/pb_migrations \
  --hooksDir=/opt/pm-space/server/pb_hooks \
  --publicDir=/opt/pm-space/server/pb_public \
  --dev=false --automigrate=false --hooksWatch=false
```

On Windows (_untested_): `.\server\pocketbase.exe serve --http=127.0.0.1:8090 --dir=server\pb_data --migrationsDir=server\pb_migrations --hooksDir=server\pb_hooks --publicDir=server\pb_public --dev=false --automigrate=false`

It prints the address and, on the very first start, a one-time link for creating the superuser (section 6). From a second terminal:

```bash
curl -s http://127.0.0.1:8090/api/health
# {"message":"API is healthy.","code":200,"data":{}}
```

Stop it with Ctrl+C. The first start created every collection from `server/pb_migrations`, so the database is ready.

Never run `npm run seed:dev` on this server. It fills an empty database with demo accounts that all share a published password. It refuses to seed if any collection it writes to already has records and does nothing without the `--dev-database` flag, but a brand-new production database is empty, so the flag is the only thing standing in the way.

## 4. Run as a service

### 4.1 Linux (systemd)

Create the unit file:

```bash
sudo tee /etc/systemd/system/pm-space.service >/dev/null <<'EOF'
[Unit]
Description=PM Space (PocketBase)
After=network.target

[Service]
User=pmspace
Group=pmspace
WorkingDirectory=/opt/pm-space
ExecStart=/opt/pm-space/server/pocketbase serve \
  --http=127.0.0.1:8090 \
  --dir=/opt/pm-space/server/pb_data \
  --migrationsDir=/opt/pm-space/server/pb_migrations \
  --hooksDir=/opt/pm-space/server/pb_hooks \
  --publicDir=/opt/pm-space/server/pb_public \
  --dev=false \
  --automigrate=false \
  --hooksWatch=false
Restart=always
RestartSec=5
LimitNOFILE=4096
NoNewPrivileges=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pm-space
systemctl status pm-space --no-pager
curl -s http://127.0.0.1:8090/api/health
```

Day to day:

```bash
sudo systemctl restart pm-space       # also: stop, start
sudo journalctl -u pm-space -f        # live output (start-up errors appear here)
sudo journalctl -u pm-space -n 100 --no-pager
```

With `--dev=false` the journal only has the start-up banner and fatal errors. Requests and errors are kept in the database for 5 days (default) and are in the dashboard under **Logs**.

| Setting                 | Why                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `User=pmspace`          | runs without privileges; it only needs to write `server/pb_data`                                              |
| `--http=127.0.0.1:8090` | listen on this machine only; the reverse proxy is the public face                                             |
| `Restart=always`        | start again after a crash or a failed start-up (it retries every 5 seconds)                                   |
| `LimitNOFILE=4096`      | more open files than the systemd default of 1024: each live-update connection and each database file uses one |
| `NoNewPrivileges=true`  | the process can never gain more privileges                                                                    |
| `UMask=0077`            | files the service creates later (database, uploads, backups) are readable by `pmspace` only                   |

If SELinux is enforcing (RHEL family) and systemd reports `status=203/EXEC`, the program needs an executable label (_untested_): `sudo semanage fcontext -a -t bin_t '/opt/pm-space/server/pocketbase' && sudo restorecon -v /opt/pm-space/server/pocketbase`.

### 4.2 Windows service (WinSW)

PocketBase is not a native Windows service, so wrap it with [WinSW](https://github.com/winsw/winsw), a small program that runs any executable as a service. WinSW sends the program Ctrl+C when the service stops, waits for `<stoptimeout>`, and only then kills it; PocketBase shuts down cleanly on Ctrl+C. This section was written from the WinSW v2.12.0 documentation and is _untested_ on a real Windows server.

1. Download `WinSW-x64.exe` from <https://github.com/winsw/winsw/releases/tag/v2.12.0> (it needs no .NET install) and save it as `C:\pm-space\service\pm-space.exe`.
2. Save this as `C:\pm-space\service\pm-space.xml`. The XML file must have the same name as the renamed `.exe`, in the same folder.

```xml
<service>
  <id>PMSpace</id>
  <name>PM Space</name>
  <description>PM Space (PocketBase)</description>
  <executable>C:\pm-space\server\pocketbase.exe</executable>
  <arguments>serve --http=127.0.0.1:8090 --dir=C:\pm-space\server\pb_data --migrationsDir=C:\pm-space\server\pb_migrations --hooksDir=C:\pm-space\server\pb_hooks --publicDir=C:\pm-space\server\pb_public --dev=false --automigrate=false</arguments>
  <workingdirectory>C:\pm-space</workingdirectory>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <stoptimeout>30 sec</stoptimeout>
  <logpath>C:\pm-space\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <serviceaccount>
    <domain>NT AUTHORITY</domain>
    <user>LocalService</user>
  </serviceaccount>
</service>
```

3. Let the service account write to the data and log folders, then install and start it (elevated PowerShell). The install folder was closed to other users in section 3.2; if you got it there some other way, run that `icacls` line first.

```powershell
New-Item -ItemType Directory -Force C:\pm-space\server\pb_data, C:\pm-space\logs | Out-Null
icacls C:\pm-space\server\pb_data /grant "*S-1-5-19:(OI)(CI)M"
icacls C:\pm-space\logs /grant "*S-1-5-19:(OI)(CI)M"

cd C:\pm-space\service
.\pm-space.exe install
.\pm-space.exe start
.\pm-space.exe status          # prints Started
Invoke-RestMethod http://127.0.0.1:8090/api/health
```

Other WinSW commands: `stopwait` (stop and wait until it has stopped), `restart`, `uninstall`. `stop` alone does not wait. To change the XML: `stopwait`, `uninstall`, edit, `install`, `start`. Output and WinSW's own messages go to `C:\pm-space\logs` and the Windows Event Log. If the service will not start, look there first; as a last resort delete the `<serviceaccount>` block so it runs as LocalSystem, the WinSW default.

### 4.3 Why these flags

**`--dev=false`.** The program decides its default from where it sits. Started from a path under the system temp folder or the user cache folder, it assumes it was started with `go run` and turns dev mode on, which logs every SQL statement to the console. A normally installed binary defaults to off, but pass the flag so a service never depends on that (`tools/osutils/run.go:8-19`, `pocketbase.go:298-309`; checked by starting it both ways).

**`--automigrate=false`.** There are two separate things here, and the flag only controls the second:

1. _Applying_ migrations. Every time the server starts it applies all migration files in `--migrationsDir` that the database has not seen yet (`apis/serve.go:66-70`). This happens whatever `--automigrate` says. Verified: with `--automigrate=false`, a migration added while the server was stopped was applied at the next start. The migrations run in one transaction: when one fails the server exits with an error, nothing is half-applied, and the database stays as it was (checked with a deliberately broken migration, section 11).
2. _Recording_ dashboard edits. With the default `--automigrate=true`, every collection or rule change made in the dashboard writes a new `<timestamp>_updated_<collection>.js` file into `--migrationsDir` and marks it as already applied (`plugins/migratecmd/automigrate.go:16-96`). Checked: editing one rule produced `1791903691_updated_notes.js`. On a production server that leaves an untracked file in the git checkout that exists nowhere else. The live database now has a change that git does not know about, and a later migration that touches the same collection can fail against it.

Production policy: **schema and API rules change only through migrations in git.** `--automigrate=false` stops stray files appearing. If someone does edit a collection in the production dashboard anyway, that change still applies to the database, but nothing records it. For an extra guard, turn on **Settings > Application > Hide/Lock collection and record controls**; it hides the collection create and edit buttons and adds an unlock step to record edits (read from the dashboard source, not clicked through; switch it off while you add users or set up OAuth2).

**`--hooksWatch=false`.** By default PocketBase restarts itself whenever a file in `--hooksDir` changes (no effect on Windows). Checked: editing a hook file restarted the process in place. During a `git pull` that could restart the server before the new app is built and before you expect it. With `false`, nothing restarts until you do it yourself.

Never run `pocketbase update`. It jumps to the newest release and bypasses the pinned version and its checksum.

## 5. HTTPS

Browsers need HTTPS for sign-in to be safe, and Microsoft sign-in later requires it. Pick one of the two options.

### 5.1 Reverse proxy with your own certificate (internal network)

Put a proxy in front of `127.0.0.1:8090`. It holds the certificate for `studio.example.com` that your internal CA issued; staff browsers must trust that CA (domain-joined PCs normally do). Open TCP 443 (and 80 if you want the redirect) to staff networks only.

**Live updates are Server-Sent Events** on `/api/realtime`: one long-lived response per open browser tab. Three things must hold or updates arrive late or not at all:

- **No buffering.** PocketBase sends `X-Accel-Buffering: no`, which nginx obeys, but turn buffering off for that path anyway.
- **A long read timeout.** PocketBase ends a stream itself after 5 minutes without an event (`apis/realtime.go:69`; measured: closed at 300 s), and the browser reconnects. A proxy that cuts streams sooner makes the browser reconnect more often, and changes made while it is reconnecting are missed. Measured: nginx with its default `proxy_read_timeout` (60 s) cut an idle stream after exactly 60 s. Use 360 s, which is longer than PocketBase's 5 minutes.
- **HTTP/2** (both configs below have it). Browsers allow about six HTTP/1.1 connections per site, and each open tab keeps one for live updates.

Uploads need the proxy to allow big request bodies. nginx's default of 1 MB rejected a 2 MB upload with `413`; Caddy accepted the same upload without any setting.

Both configs below were run in front of PocketBase v0.40.5 (with other host names, ports and certificate paths) and checked for: instant delivery of live events, a stream surviving more than 60 s idle, a 2 MB upload, HTTP/2, and a client-supplied `X-Forwarded-For` being overwritten. The nginx port-80 redirect block was only syntax-checked.

**Option A: Caddy** (2.10.0 tested; <https://caddyserver.com/docs/install>). Put this in `/etc/caddy/Caddyfile`:

```
studio.example.com {
	tls /etc/caddy/certs/studio.example.com.crt /etc/caddy/certs/studio.example.com.key

	# The page itself: ask browsers to re-check it so an update shows up straight away
	@page path /
	header @page Cache-Control "no-cache"

	# Caddy streams the live-update connection (Server-Sent Events) with no extra settings
	reverse_proxy 127.0.0.1:8090
}
```

The `.crt` file must contain the full chain (certificate plus intermediates). The `caddy` user must be able to read both files. Then:

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy redirects port 80 to HTTPS by itself (_untested_ here, because the test used non-standard ports).

**Option B: nginx** (1.24 tested). Put this in `/etc/nginx/conf.d/pm-space.conf`:

```nginx
server {
    listen 80;
    server_name studio.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;                     # nginx 1.25.1 or newer: "listen 443 ssl;" plus "http2 on;"
    server_name studio.example.com;

    ssl_certificate     /etc/nginx/certs/studio.example.com.crt;   # full chain
    ssl_certificate_key /etc/nginx/certs/studio.example.com.key;

    # nginx's default limit is 1 MB, which would reject file uploads.
    # Keep this above the largest file you allow people to upload: the app and the files collection stop at 100 MB per file,
    # and the form around the file adds a little, so a limit of exactly 100m would refuse a file of exactly 100 MB.
    client_max_body_size 110m;

    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;      # overwrite, never append, whatever the client sent
    proxy_set_header X-Forwarded-Proto $scheme;

    location / {
        proxy_pass http://127.0.0.1:8090;
    }

    # The page itself: ask browsers to re-check it so an update shows up straight away
    location = / {
        proxy_pass http://127.0.0.1:8090;
        add_header Cache-Control "no-cache" always;
    }

    # Live updates (Server-Sent Events): no buffering, and a read timeout longer than
    # PocketBase's own 5 minute idle limit
    location /api/realtime {
        proxy_pass http://127.0.0.1:8090;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 360s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**IIS** (Application Request Routing and URL Rewrite) is common on Windows servers but was not tested. If you use it: turn response buffering off for the proxied site (ARR's _Response buffer threshold_ to 0) and raise the ARR proxy time-out above 5 minutes. IIS also refuses request bodies over about 30 MB by default (**Request Filtering > maxAllowedContentLength**); set it to at least 115343360 bytes (110 MB) for the app's 100 MB file limit. Otherwise Caddy runs on Windows too, with the same Caddyfile (write file paths with forward slashes, for example `tls C:/certs/studio.crt C:/certs/studio.key`); run it as a second WinSW service with executable `caddy.exe` and arguments `run --config C:\caddy\Caddyfile` (_untested_).

**Check it from a staff PC** (add `-k` only while testing with a self-signed certificate):

```bash
curl -sI https://studio.example.com/api/health | head -1       # HTTP/2 200
curl -sN --max-time 5 https://studio.example.com/api/realtime
# should print three lines at once and then wait until curl gives up after 5 seconds:
# id:AbC...
# event:PB_CONNECT
# data:{"clientId":"AbC..."}
```

If the second command prints nothing until the timeout, something between you and PocketBase is buffering the stream (section 11).

### 5.2 PocketBase's built-in Let's Encrypt

Only valid if the server is reachable from the public internet on ports 80 and 443 and `studio.example.com` resolves to it publicly, because Let's Encrypt has to call back to your server. For an internal-only server use option 5.1.

Start PocketBase with the domain instead of `--http`. In the unit file of section 4.1 only the `ExecStart` line changes:

```
ExecStart=/opt/pm-space/server/pocketbase serve studio.example.com \
  --dir=/opt/pm-space/server/pb_data \
  --migrationsDir=/opt/pm-space/server/pb_migrations \
  --hooksDir=/opt/pm-space/server/pb_hooks \
  --publicDir=/opt/pm-space/server/pb_public \
  --dev=false \
  --automigrate=false \
  --hooksWatch=false
```

With a domain argument PocketBase listens on `0.0.0.0:80` and `0.0.0.0:443`, answers plain HTTP with a redirect to HTTPS, and gets and renews its certificate by itself, keeping it in `pb_data/.autocert_cache` (`cmd/serve.go:25-36`, `apis/serve.go:134-138,296-304`). Checked here: the start-up banner shows `https://studio.example.com` and a plain HTTP request gets `302` to `https://studio.example.com/`. Not checked: actually obtaining a certificate, which needs real DNS and internet access.

Binding to ports below 1024 as the `pmspace` user needs one extra line in the `[Service]` section (syntax-checked with `systemd-analyze verify`):

```
AmbientCapabilities=CAP_NET_BIND_SERVICE
```

### 5.3 Real client IPs behind the proxy

Behind a proxy, every request arrives from `127.0.0.1`, so PocketBase's logs and rate limits cannot tell people apart. Tell PocketBase which header carries the real address. In the dashboard: **Settings > Application > IP proxy headers**, set **Trusted IP proxy headers** to `X-Forwarded-For`, keep **IP priority** on "Use rightmost IP", and save. The panel shows the "Resolved user IP" so you can see it work.

Both configs above send exactly that header (nginx overwrites it with `$remote_addr`; Caddy replaces any client-supplied value). Checked: with the setting on, a request carrying a fake `X-Forwarded-For: 6.6.6.6` was still seen as the real client. This is only safe because PocketBase listens on `127.0.0.1`; if it were reachable directly, anyone could forge the header.

### 5.4 Limit sign-in attempts

PocketBase ships with rate limiting switched **off**, so nothing slows down someone guessing passwords (checked: 120 wrong passwords in 8 seconds were all answered). Turn it on for sign-in only, and do it after 5.3: without trusted proxy headers every request seems to come from the proxy, and everybody would share one limit.

Dashboard > **Settings > Application > Rate limiting**: switch it on, delete every rule except `*:auth`, set that one to **10** requests per **60** seconds, and save. Do not keep the other default rules. `*:create` allows 20 new records per 5 seconds per address, and the app saves in bursts (duplicating a project creates all its tasks at once), so it would refuse ordinary work.

The same from the server, as the superuser (get a token with `curl -s -X POST http://127.0.0.1:8090/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"it-admin@example.com","password":"…"}'`):

```bash
curl -s -X PATCH http://127.0.0.1:8090/api/settings -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"rateLimits":{"enabled":true,"rules":[{"label":"*:auth","maxRequests":10,"duration":60}]}}'
```

Checked: with that rule the eleventh wrong password within a minute is answered `429 Too Many Requests`, while 40 records created in a burst all succeed.

### 5.5 Keep the dashboard for IT

The dashboard at `/_/`, and the superuser API behind it, is reachable wherever the app is. The superuser password protects it; to also limit it to IT's own machines, give PocketBase an allow-list of addresses or subnets (after 5.3, so it sees real addresses):

```bash
sudo -u pmspace /opt/pm-space/server/pocketbase superuser ips 10.0.5.0/24 --dir=/opt/pm-space/server/pb_data --dev=false
```

Every superuser request from anywhere else is then refused with `403`. Running the command with no addresses clears the list (section 11).

## 6. First admin

You need two things: a PocketBase superuser for yourself, then the first app user with `role = admin`.

**Step 1: create the superuser.** The command works before the first start, and also while the service runs. Passwords need at least 8 characters.

```bash
sudo -u pmspace /opt/pm-space/server/pocketbase superuser upsert it-admin@example.com 'a-long-password' \
  --dir=/opt/pm-space/server/pb_data --dev=false
```

On Windows (_untested_) run `.\server\pocketbase.exe superuser upsert it-admin@example.com "a-long-password" --dir=C:\pm-space\server\pb_data --dev=false` from `C:\pm-space`.

Use `sudo -u pmspace` so the files PocketBase touches stay owned by the service account. The command creates the superuser, or changes the password if that email already exists, so it is also the cure for a forgotten superuser password. The password lands in your shell history; clear it or change the password in the dashboard afterwards.

Alternative without a command line: if no superuser exists, every start prints a one-time link to the log:

```
(!) Launch the URL below in the browser if it hasn't been open already to create your first superuser account:
http://127.0.0.1:8090/_/#/pbinstall/<long token>
```

Find it with `sudo journalctl -u pm-space | grep pbinstall`. Replace `http://127.0.0.1:8090` with `https://studio.example.com` when you open it. It is valid for 30 minutes (restart the service for a fresh one: `apis/installer.go:31,46-69`). The same page can also set the server up from an uploaded backup file instead (Linux only, section 9).

**Step 2: create the first app user.** Open `https://studio.example.com/_/` and sign in as the superuser. Open the `users` collection, press **New record**, and fill in the form as in section 7 with `role` set to `admin`. Only a superuser can do this the first time, because the rule for creating users is "admins only" and nobody is an admin yet. Then open `https://studio.example.com/` and sign in with that account.

**Step 3: create the first workspace.** Signed in to the app as that admin, open the workspace menu at the top of the sidebar, choose **Create workspace** and name it (for example "Sam Engineering"). Every project belongs to a workspace; until one exists, **New project** asks an admin to create one first.

Users with `role = admin` see private projects and can create workspaces. Other users see a private project only if they are a member of it. To make a project private, open it, choose **Share**, and set **General access** to **Only people invited**: from then on only the people listed there (and admins) can see the project or anything in it, and the server enforces it. In this phase anyone who can see a project can change that setting and add or remove people; finer permissions arrive with Phase 2.

**Is it working?**

```bash
curl -s https://studio.example.com/api/health
# {"message":"API is healthy.","code":200,"data":{}}

curl -s -o /dev/null -w '%{http_code}\n' https://studio.example.com/api/collections/tasks/records
# 401: the API refuses requests that are not signed in (the hook in server/pb_hooks)
```

Then sign in as two different users in two browsers: a change in one should appear in the other within a couple of seconds, without reloading.

## 7. Adding users

Dashboard (`https://studio.example.com/_/`) > **Collections** > `users` > **New record**:

| Field                         | What to enter                                                                                                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`                       | their work email. Upper and lower case don't matter: sign-in and the duplicate check ignore case. If you will turn on Microsoft sign-in (section 12), use the same address as their Microsoft 365 email.                                                                          |
| Public (next to the email)    | switched **On** automatically when the account is created (a hook does it, whatever the form says), so colleagues see the address on the Members page. This is the `emailVisibility` flag. To hide someone's address from everyone but admins, switch it off afterwards and save. |
| `password`, `passwordConfirm` | an initial password of at least 8 characters. Give it to them through a channel you trust, and ask them to change it at first sign-in: **Settings > Password** in the app (at least 10 characters, with a number or symbol). Changing it there signs out their other devices.     |
| `name`, `title`               | display name and job title                                                                                                                                                                                                                                                        |
| `role`                        | `admin`, `manager` or `member`; left empty, it becomes `member`. The role is stored now and enforced from Phase 2. Only `admin` has an effect today: see private projects, create workspaces.                                                                                     |
| `verified`                    | switch it **On** (the dashboard asks you to confirm). It does not affect password sign-in. It matters later: the first Microsoft sign-in of an unverified account throws away its password (section 12).                                                                          |

Save. Send the person the app address and their email and initial password.

**Forgotten password.** Open their record, switch on **change password**, enter a new password twice, save. Their old sessions end at once (checked: the old token is rejected) and the old password stops working. PocketBase has no email set up (SMTP is off by default), so a "send password reset email" action and any reset link do nothing; the admin always sets the new password. For the same reason the "new login" alert emails are switched off for app users. Switch them on (`users` > Options) once an email server is configured.

**Changing a role.** Edit the record and change `role`.

**Removing someone.** Delete their record. Their session stops working immediately (checked). Their tasks, comments, files and activity stay; the author or assignee on them becomes empty, and they drop out of every project's member list and lead (checked). Their notifications, saved views and personal settings are deleted with the account. Make a backup first (section 8) if they leave a lot of history. To lock someone out but keep their history, set a long random password instead of deleting them; that also ends their sessions (checked). Once Microsoft sign-in is on (section 12), also disable the person in Microsoft 365, or delete the account, because a password change does not stop a Microsoft sign-in.

## 8. Nightly backup

**Do not copy `pb_data` by hand while the server runs.** SQLite keeps recent writes in a side file (`data.db-wal`) until it merges them. Demonstrated: a live server held 13 records, and a copy of `data.db` alone, taken at that moment, held 10. Stop the service first if you ever copy the folder yourself. Otherwise use the built-in backup, which makes a consistent snapshot while the server keeps running.

### 8.1 Built-in scheduled backups

Dashboard > **Settings > Backups > Backup options**:

1. Switch on **Enable auto backups**.
2. **Cron expression**: for example `0 1 * * *` (every day at 01:00). **The time zone is UTC**, whatever the server clock says.
3. **Max @auto backups to keep**: for example `14`.
4. **Save changes.**

The **Settings > Application > Application name** (`PM Space` unless you change it) becomes part of the file name.

What you get, in `server/pb_data/backups/` (`core/backup_create.go`, `core/backup.go`):

- A zip named `@auto_pb_backup_pm_space_20261013010000.zip` (UTC timestamp). Backups you start yourself ("Initialize new backup") are named `pb_backup_<app name>_<timestamp>.zip`.
- Inside: `data.db` (a consistent copy, made while the server runs), `auxiliary.db` (logs) and `storage/` (**every uploaded file**), plus `types.d.ts`. Left out: the `backups/` folder itself and temporary folders. So one zip holds everything that matters in `pb_data`.
- Retention: after each run PocketBase deletes the oldest `@auto_pb_backup_*` zips beyond the number you set. Zips you made by hand or copied in are never deleted by it. (Checked with an every-minute schedule and a limit of 2: exactly the 2 newest `@auto_` files survived and the hand-made ones stayed.)
- A zip appears under its final name only when it is complete; it is written as `<name>.zip.<random>.tmp` first. A copy job that takes only `*.zip` therefore never copies half a backup.
- If a scheduled run fails, PocketBase logs an error ("Autobackup failure" alert). With no email configured nobody is told, so check regularly (below).

Try it now instead of waiting for tonight: **Settings > Crons**, press **Run** next to `__pbAutoBackup__`, then:

```bash
sudo ls -l /opt/pm-space/server/pb_data/backups/
```

Check from a monitoring job that a backup is recent (prints a warning when no automatic backup is younger than two days). `pb_data` is closed to other users, so the job must run as root or as `pmspace`; from any other account put `sudo -u pmspace` in front of `find`:

```bash
find /opt/pm-space/server/pb_data/backups -name '@auto_pb_backup_*.zip' -mtime -2 | grep -q . || echo "NO RECENT BACKUP"
```

### 8.2 Copy the zips off the machine

A backup on the same disk does not survive a dead disk or a stolen server. Copy the zips elsewhere every night. Each zip holds the whole database and every upload, so the copy needs the same care as `pb_data`: readable only by the account that looks after backups.

**Linux (cron and rsync).** This copies only the `.zip` files and only what is new. It also copes with the UTC-versus-local-time difference, because it simply runs every hour. Put it in `/etc/cron.d/pm-space-backup-copy` (this assumes a `backup` user on `backuphost` and an SSH key for root: the job has to run as root, because `pb_data` is closed to every other account). The rsync options were tested as a local copy; the SSH part depends on your environment.

```
17 * * * * root rsync -a --chmod=D700,F600 --include='*.zip' --exclude='*' /opt/pm-space/server/pb_data/backups/ backup@backuphost:/srv/backups/pm-space/
```

`--chmod=D700,F600` keeps the copies private on the other side. Close the destination folder too (`ssh backup@backuphost chmod 700 /srv/backups/pm-space`).

The destination keeps every zip, so prune it there, for example 60 days:

```bash
find /srv/backups/pm-space -name '*.zip' -mtime +60 -delete
```

You can use any other mechanism your company already has (a file share, object storage). PocketBase can also write its backups straight to S3-compatible storage (**Store backups in S3 storage** on the same Backups page; _untested_).

**Windows (robocopy and Task Scheduler)** (_untested_). `robocopy` returns 1 when it copied something; anything below 8 means success.

```powershell
schtasks /Create /TN "PM Space backup copy" /SC DAILY /ST 03:30 /RU SYSTEM /TR "robocopy C:\pm-space\server\pb_data\backups D:\backup-copy\pm-space *.zip /R:2 /W:5"
```

Choose a time after the PocketBase backup (remember it runs in UTC), and a destination the task's account can write to. A file server share needs `/RU` set to an account with access to it. The destination folder must not inherit its permissions from a drive root, which gives "Authenticated Users: Modify": close it the way section 3.2 closes the install folder (the task runs as SYSTEM, so this is enough):

```powershell
New-Item -ItemType Directory -Force D:\backup-copy | Out-Null
icacls D:\backup-copy /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F"
```

## 9. Restoring from backup

A restore replaces **everything** in `pb_data` with the backup: users, superusers, settings, the Microsoft client secret, uploads. Anything saved after the backup is gone. Before you start, copy the current `pb_data` aside if it is still readable (on Linux with `sudo cp -a`, which keeps the owner and the closed permissions; the manual restore below keeps it as `pb_data.old` anyway).

If the backup is older than the code you now run, nothing special is needed: the server applies any migration the backup does not have when it starts (checked by restoring a backup made before a migration existed).

### 9.1 From the dashboard (Linux only)

**Settings > Backups**. If the zip is not in the list, copy it into `server/pb_data/backups/` (owned by `pmspace` and closed to other users) with `sudo install -d -o pmspace -g pmspace -m 700 /opt/pm-space/server/pb_data/backups && sudo install -o pmspace -g pmspace -m 600 /path/to/backup.zip /opt/pm-space/server/pb_data/backups/` (the first command creates the folder, which a fresh `pb_data` does not have yet), or use the **Upload backup** button. Press **Restore** on its row and type the file name to confirm. PocketBase unpacks it, swaps `pb_data` and restarts itself. Under systemd the service keeps running (it re-executes in place), and the page reloads when it is back. Checked on Linux.

PocketBase marks this feature experimental and it **does not work on Windows** (`core/backup_restore.go:21,66-68`). Use the manual path there.

On a brand-new server (Linux) you can also upload the zip on the first-start installer page, the link described in section 6.

### 9.2 Manual restore (Linux and Windows)

Checked end to end on Linux before `pb_data` was closed to other users: a record and an uploaded file were created, a backup was taken, a later record was added, `pb_data` was moved aside, the zip was unpacked into a new `pb_data`, and after the start the first record and the file were back and the later record was gone. The `sudo` and mode-700 steps below were added after that and were not run through a second full restore.

```bash
sudo systemctl stop pm-space &&
cd /opt/pm-space/server &&
sudo mv pb_data pb_data.old &&                 # keep it until you are happy
sudo mkdir -m 700 pb_data &&
sudo unzip -q /path/to/@auto_pb_backup_pm_space_20261013010000.zip -d pb_data &&
sudo chown -R pmspace:pmspace pb_data &&
sudo systemctl start pm-space
sudo journalctl -u pm-space -n 20 --no-pager
```

The steps are joined with `&&`, so the block stops at the first one that fails, for example a service or folder name that is different on your install. The last line is left out of the chain on purpose: it shows the service log whether or not the start worked, and a failed start says there why. Moving `pb_data` while the server still runs would lose its last writes. The file steps use `sudo` because `pb_data` and its old copy are closed to other users; `sudo unzip` also reads a zip from your home folder, which `pmspace` could not.

Then sign in and look at recent data. Delete `pb_data.old` (`sudo rm -r`) when you are satisfied. A fresh `pb_data` has no `backups/` folder; PocketBase creates it when it next needs it, so copy your zips back in (with the `sudo install` line of section 9.1) if you want them listed in the dashboard.

Windows (_untested_), in an elevated PowerShell:

```powershell
cd C:\pm-space\service
.\pm-space.exe stopwait
Rename-Item C:\pm-space\server\pb_data pb_data.old
Expand-Archive -LiteralPath D:\backup-copy\pm-space\your-backup.zip -DestinationPath C:\pm-space\server\pb_data
icacls C:\pm-space\server\pb_data /grant "*S-1-5-19:(OI)(CI)M"
.\pm-space.exe start
```

## 10. Upgrading

### 10.1 App updates

```bash
cd /opt/pm-space
git pull
npm ci
npm run build:server
sudo systemctl restart pm-space
sudo journalctl -u pm-space -n 20 --no-pager      # expect the "Server started" banner and no errors
curl -s http://127.0.0.1:8090/api/health
```

On Windows, in an elevated PowerShell (only administrators can open the folder): `git pull`, `npm ci`, `npm run build:server`, then `C:\pm-space\service\pm-space.exe restart` (_untested_).

On an install from an earlier version of this guide, use its own folder and service names here (see the top of this guide). With the new names the restart fails with `Unit pm-space.service not found` and the old server keeps running, so the health check still answers. That server already serves the rebuilt app, because app files need no restart, but it still runs the old migrations and hooks. Restart it under its own name before anyone uses the app.

The update that renames the product to PM Space signs everyone out once: the app keeps the sign-in under a new name. Its migration also sets **Settings > Application > Application name** to `PM Space`, replacing a name you chose. New backup zips are named `@auto_pb_backup_pm_space_…` from then on; older zips keep their names and still count toward **Max @auto backups to keep**.

The update that adds project templates (migration `1791849606_templates.js`) creates a `templates` collection: a restart applies it, and there is nothing else to do. Only admins and managers may write to it.

The update that adds project stages (migration `1791849607_stage_sets.js`) creates a `stage_sets` collection the same way: a restart applies it, and there is nothing else to do. Only admins and managers may write to it. Projects keep their stage in their own data, so nothing is migrated: a project that has an old status (Planning, In Progress, At Risk, On Hold, Completed) is shown in the matching stage of the built-in set (Tender, Design, Design, Design, Closed) and, for At risk and On hold, with that health, and it is saved in the new form the first time someone changes it. A workspace with no stage sets uses the built-in set (Integrator job); Settings > Stages > Customize turns it into a set you can edit.

The update that adds task labels per workspace (migration `1791849608_workspace_lists.js`) creates a `workspace_lists` collection the same way: a restart applies it, and there is nothing else to do. It holds one record per workspace (the first time an admin or manager saves labels in Settings > Labels), and only admins and managers may write to it. Tasks keep their label ids in their own data, so nothing is migrated. A workspace with no saved list uses the built-in labels of the Integrator set (Electrical, Mechanical, PLC, SCADA, ...); a task that carries one of the old fixed labels (Design, Frontend, Backend, Research, Content, Bug, QA, Growth) keeps that id, which the set does not have, so the app no longer shows it on the task. The same holds for a label removed from a saved list: its tasks stop showing it, and are not edited.

The same record holds the workspace's project fields (Settings > Project fields): their definitions are `doc.fields`, a list of `{ id, name, type, inTable, options? }` (type `text`, `number`, `date` or `select`; only a `select` has `options`, `[{ id, name }]`), and there is nothing to migrate. A workspace whose record has no `fields` key uses three built-in text fields (Client, End user, PO / contract no.), and a saved list, even an empty one, replaces them. A project keeps its value of a field as the key `f_<field id>` of its own `doc` (the text, the number, the `YYYY-MM-DD` day, or the id of the chosen option), and no key when it has no value. Deleting a field, or removing a dropdown option, leaves those values on the projects: the app no longer shows them, but they stay in each project's `doc`, where anyone who can read the project can still read them through the API. If a workspace's record is deleted, the built-in fields come back, and so do any Client, End user and PO values still on its projects.

An install that still lacks any of these three collections (its last update predates migration `1791849608_workspace_lists.js`) must restart straight after `npm run build:server`. The rebuilt app reads `templates`, `stage_sets` and `workspace_lists` whenever it loads someone's data, so until the restart applies their migrations nobody can get in, although the server is up: a stored session opens on the sign-in page with "Couldn't load your data", and signing in ends with the same message. If the restart fails (see the note on earlier names above), the old server keeps serving the rebuilt app, and this lasts until it runs the new migrations.

The update that closes the data folder (`chmod 700` on `pb_data`, `UMask=0077` in the unit, and on Windows a lock-down of `C:\pm-space`) does not change an existing install by itself. On Linux:

```bash
sudo chmod 700 /opt/pm-space/server/pb_data
# add the line UMask=0077 to the [Service] section of /etc/systemd/system/pm-space.service, then:
sudo systemctl daemon-reload && sudo systemctl restart pm-space
```

Also close what this guide's own steps left behind: `sudo chmod 700 /opt/pm-space/server/pb_data.old` (section 9.2), the `~/pm-space-test` copy (delete it, section 10.2), and the zips already copied off-machine (`chmod -R go-rwx` on their folder, section 8.2). On Windows, run the `icacls` line of section 3.2 from an elevated PowerShell (it assumes `C:\pm-space`) and close a backup copy folder the same way. Then run the check at the end of section 3.1 or 3.2. If untrusted local users could reach the server before, closing it does not undo that: sign everyone out (in the dashboard, edit the `users` and `_superusers` collections and use **Invalidate all previously issued tokens**), change the superuser password and the Microsoft client secret if one is set, and ask everyone who signs in with a password to change it (the database holds the password hashes, and a weak password can be guessed from its hash offline; signing out does not stop that). Then stop the service, delete `server/pocketbase` (`server\pocketbase.exe` on Windows, which cannot be deleted while the service runs: `.\pm-space.exe stopwait` in `C:\pm-space\service`), run the `get-pocketbase` script again (it keeps a binary that already reports the pinned version), start the service, and check `git status` for changed files in `server/pb_hooks` and `server/pb_migrations`.

Take a backup first (**Settings > Crons > Run** `__pbAutoBackup__`, or **Initialize new backup**): migrations only go forward.

**When is a restart needed?**

| What changed in the pull                         | What to do                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| app code only (`src/`, styles, `index.html`)     | `npm run build:server`. No restart: new files are served at once (checked: replaced files appeared without a restart). |
| `server/pb_migrations/`                          | restart. New migrations are applied at start-up, all or nothing.                                                       |
| `server/pb_hooks/`                               | restart (`--hooksWatch=false` means hooks load only at start).                                                         |
| `package.json` or `package-lock.json`            | `npm ci` before building.                                                                                              |
| PocketBase version in `scripts/get-pocketbase.*` | section 10.2.                                                                                                          |

The simple rule: restart after every update. It takes about a second. Live updates drop for that moment and the app reconnects by itself.

Each build renames the app's script files, so a browser that reused an old copy of the app page would point at files that no longer exist. A hook (`server/pb_hooks/static_cache.pb.js`) sends `Cache-Control: no-cache` with the app page, so browsers re-check it on every visit and an update shows up on the next load. The proxy configs of section 5.1 send the same header as a second line of defence. If someone still sees a blank page, a hard refresh (Ctrl+F5) fixes it.

**Rolling back.** `git checkout <previous commit>`, `npm ci`, `npm run build:server`, restart. A new migration is **not** undone by that. If the update changed the database, the safest way back is the backup you took before it (section 9).

To undo only the last migration instead, and only if it has a working `down` function: stop the service and, **before** you check out the old commit, run the following and answer `y` (checked). Then check out the old commit, rebuild and start the service. The order matters: once the new migration file is gone, `migrate down 1` reverts an older migration instead (checked), and if the server starts first the migration is simply applied again.

```bash
sudo -u pmspace /opt/pm-space/server/pocketbase migrate down 1 \
  --dir=/opt/pm-space/server/pb_data --migrationsDir=/opt/pm-space/server/pb_migrations
```

### 10.2 PocketBase upgrades

PocketBase is pre-1.0 and minor versions can contain breaking changes, so upgrades are a deliberate act. The version is pinned in two places, `scripts/get-pocketbase.sh` and `scripts/get-pocketbase.ps1`, each with the SHA-256 checksums of the release files. Nothing upgrades by itself. **Never run `pocketbase update`.**

1. **Read the changelog** for every version between yours and the target: <https://github.com/pocketbase/pocketbase/blob/master/CHANGELOG.md>. Breaking changes are marked with a warning sign.
2. **Back up** (section 8) and make sure a copy is off the machine.
3. **Test on a copy** before touching the live server. On the server or a test VM:

   ```bash
   git clone /opt/pm-space ~/pm-space-test          # a throw-away copy of the code
   cd ~/pm-space-test
   # change PB_VERSION and the checksums in scripts/get-pocketbase.sh (step 4 below), then:
   scripts/get-pocketbase.sh
   # the zips are in the closed pb_data: take one out as yourself
   sudo install -o "$USER" -m 600 /opt/pm-space/server/pb_data/backups/@auto_pb_backup_pm_space_20261013010000.zip ~/latest-backup.zip
   mkdir -m 700 server/pb_data && unzip -q ~/latest-backup.zip -d server/pb_data
   server/pocketbase serve --http=127.0.0.1:8091 \
     --dir=server/pb_data --migrationsDir=server/pb_migrations --hooksDir=server/pb_hooks \
     --publicDir=/opt/pm-space/server/pb_public --dev=false --automigrate=false --hooksWatch=false
   ```

   Look at the output for errors, then open the app through an SSH tunnel (`ssh -L 8091:127.0.0.1:8091 your-server`, then <http://localhost:8091>) and click around. Delete `~/pm-space-test` and `~/latest-backup.zip` afterwards. (On a test VM, copy the zip over from your off-machine copy instead of using the `sudo install` line.)

4. **Bump the version and the checksums in both scripts.** The checksums are in `checksums.txt` on the release page: `https://github.com/pocketbase/pocketbase/releases/download/v<NEW VERSION>/checksums.txt`. For each platform a script lists, replace the old checksum with the matching line (the `.sh` has Linux and macOS, the `.ps1` has Windows). Commit the change.
5. **On the live server:** `git pull`, then run the script again (`scripts/get-pocketbase.sh`, or the `.ps1` on Windows; on Windows stop the service first, because the program file is locked while it runs), then restart the service.
6. **Check the logs** straight away: `sudo journalctl -u pm-space -n 50 --no-pager`. Look for the banner and for errors from the system migrations that PocketBase runs on its own data. Sign in, open a project, create a task. If anything is wrong, stop the service, restore the backup (section 9) and put the old version back in the scripts.

## 11. Troubleshooting

**The service does not start: port in use.** The log says `listen tcp 127.0.0.1:8090: bind: address already in use`. Something else, often a copy started by hand, has the port. Find it and stop it:

```bash
sudo ss -ltnp 'sport = :8090'
# or: sudo lsof -nP -iTCP:8090 -sTCP:LISTEN
```

On Windows: `netstat -ano | findstr :8090` (_untested_). Alternatively move PocketBase to another port in the unit and in the proxy config.

**The service keeps restarting: a migration failed.** The log says `failed to apply migration 1800000000_something.js: ...` and the process exits with status 1. With `Restart=always` it tries again every 5 seconds, so run `sudo systemctl stop pm-space` while you fix it. The failed start changed nothing: all pending migrations run in one transaction, and a deliberately broken test migration (one that changed a collection and then threw) left the database exactly as it was. Fix or remove the named file in `server/pb_migrations/` (`git log -p -- server/pb_migrations` shows what changed), or go back to the previous commit, then start the service. No backup restore is needed for this.

**Live updates do not arrive: changes show only after a reload.** Run the `curl -sN --max-time 5 .../api/realtime` check from section 5.1, once on the server against `http://127.0.0.1:8090` and once from a staff PC against the real name. If the server answers instantly and the staff PC prints nothing, the proxy (or a corporate web proxy or SSL-inspection device in between) is buffering or cutting the stream. For nginx check `proxy_buffering off;` and `proxy_read_timeout 360s;` on `/api/realtime`. A timeout that is too short shows up as a stream that is cut at the same interval every time (60 seconds with nginx's default); run the `curl` check without `--max-time` and see how long it lasts.

**Blank page or old screen after an update.** Hard refresh (Ctrl+F5). See the cache note in section 10.1.

**Uploads fail with "413" or "Request Entity Too Large".** Raise `client_max_body_size` in nginx (section 5.1). PocketBase's own limit is 32 MB plus the size limits of the file fields.

**Locked out of the dashboard.**

- _Forgot the superuser password:_ `sudo -u pmspace /opt/pm-space/server/pocketbase superuser upsert it-admin@example.com 'new-password' --dir=/opt/pm-space/server/pb_data --dev=false` (works while the service runs).
- _Restricted the Superuser IPs setting and your address is not on the list:_ every superuser request is refused with `403`. Clear the list from the server: `sudo -u pmspace /opt/pm-space/server/pocketbase superuser ips --dir=/opt/pm-space/server/pb_data` (checked: it works while the service runs).
- _No app admin is left:_ sign in to the dashboard as superuser and set `role` to `admin` on a `users` record.

**Backups stopped appearing.** Check the free disk space (a backup needs about 2× the size of `pb_data`), then **Logs** in the dashboard for "Autobackup failure", then run the job by hand from **Settings > Crons**.

## 12. Spike: Microsoft 365 sign-in

Findings only. Nothing here is built into the app yet. The question: can staff sign in with their Microsoft 365 account, and what must IT set up in Microsoft Entra ID (formerly Azure AD)?

**Answer: yes.** PocketBase v0.40.5 ships a Microsoft provider. The app needs a "Sign in with Microsoft" button; IT needs an app registration in Entra and one provider entry in the PocketBase dashboard. Only people who already have an account in PM Space can sign in, as long as the `users` collection's create rule stays admin-only (section 12.2): Microsoft sign-in then never creates accounts.

How this was checked: PocketBase source at tag v0.40.5 (paths and lines below), and the sign-in behaviour against a local stand-in for Microsoft's three endpoints (token, Graph `/me`), pointed at through the provider's URL settings. The Entra portal steps come from Microsoft's published documentation (the `MicrosoftDocs/entra-docs` repository on GitHub, whose text backs `learn.microsoft.com`) and were not tried against a real tenant.

### 12.1 What PocketBase provides

| Question                | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a provider?    | Yes. Provider name `microsoft`, shown as "Microsoft" (the dashboard form is titled "Azure AD / Entra ID"). `tools/auth/microsoft.go:16-18,23,41`; `ui/src/collections/oauth2/microsoftOptions.js:94`                                                                                                                                                                                                                                                                                    |
| Default authorize URL   | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`. `microsoft.go:36,44`, built by `golang.org/x/oauth2@v0.37.0/microsoft/microsoft.go:23-32` (an empty tenant becomes `common`)                                                                                                                                                                                                                                                                                          |
| Default token URL       | `https://login.microsoftonline.com/common/oauth2/v2.0/token` (same lines)                                                                                                                                                                                                                                                                                                                                                                                                               |
| User-info URL           | `https://graph.microsoft.com/v1.0/me`. `microsoft.go:46`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Scopes it requests      | `User.Read` only (`microsoft.go:43`). It adds `openid` only when you pick an id-token option under "Extract email from" (`microsoft.go:54-64`). Verified in the authorize URL it builds: `scope=User.Read`, PKCE `S256`, `response_type=code` (`apis/record_auth_methods.go:156-171`).                                                                                                                                                                                                  |
| User fields it maps     | Graph `id` is the stable account id (stored in the `_externalAuths` link table); `displayName` is read as the name; `mail` is read as the email and treated as verified. No avatar and no username. PocketBase copies name and avatar into an account only when it _creates_ one, so a pre-created account keeps what the admin typed. `microsoft.go:84-98,122`; `tools/auth/auth.go:142-164`; `apis/record_auth_with_oauth2.go:267-317` (create) against `:333-384` (existing account) |
| Other email sources     | Dashboard "Extract email from": Graph `mail` (default), or an id-token claim `email`, `email` + `xms_edov`, `verified_primary_email`. `microsoft.go:104-123`; `microsoftOptions.js:8-90`                                                                                                                                                                                                                                                                                                |
| Single-tenant URLs      | The authorize and token URLs can be overridden per provider, and the dashboard form makes both required fields with the tenant id in the example. `core/collection_model_auth_options.go:527-543,572-612`; `microsoftOptions.js:101-134`                                                                                                                                                                                                                                                |
| Redirect URL it expects | `https://<host>/api/oauth2-redirect` (accepts GET and POST). `apis/record_auth.go:12-17` under the `/api` group (`apis/base.go:39,43`); the dashboard's own example says "register ${baseURL}/api/oauth2-redirect" (`ui/src/apiPreview/docsAuthWithOAuth2.js:87`)                                                                                                                                                                                                                       |
| Where the config lives  | In the database (`pb_data`), not in git. Provider settings, including the client secret, are deliberately left out of generated migrations (`plugins/migratecmd/automigrate.go:38-44`), so they live only in the database and are covered by your backups.                                                                                                                                                                                                                              |

**Why the single-tenant override is not optional.** Microsoft rejects the `/common` endpoint for an app registered as single-tenant: error `AADSTS50194 ... Usage of the /common endpoint isn't supported for such applications ... Use a tenant-specific endpoint or configure the application to be multitenant` (`entra-docs/docs/identity-platform/reference-error-codes.md:225`). So IT must replace `common` with the tenant id in both URLs.

**One more requirement from the SDK.** The JS SDK's `authWithOAuth2` (read in the bundled `pocketbase` 0.28.1) opens a popup, builds the redirect URL as `<origin>/api/oauth2-redirect`, and receives the result over the same live-update connection (a realtime subscription named `@oauth2`; the redirect handler is `apis/record_auth_with_oauth2_redirect.go:31-101`, which also checks that the browser has the same IP as its live connection, lines 62-66). So the SSE proxy settings of section 5.1 and the trusted proxy header of section 5.3 matter for Microsoft sign-in too, and the popup must be started from a click.

### 12.2 What happens when someone signs in

Rows 1 to 7 were reproduced with the stand-in Microsoft endpoints, on a `users` collection whose create rule was changed between runs as the rows say. Row 8 and the "later sign-ins match on the id" detail in row 1 come from the source. The two functions that decide everything are `recordAuthWithOAuth2` and `oauth2Submit` in `apis/record_auth_with_oauth2.go`.

| Situation                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. An account with the same email exists, and is **Verified**    | Signs in to that account. The Microsoft id is linked on first use; later sign-ins match on the id, not the email. Their password still works. `recordAuthWithOAuth2` `:116-137`, `oauth2Submit` `:386-397`                                                                                                                                                                                                                              |
| 2. The account exists but is **not Verified**                    | Signs in, marks it verified, **and replaces its password with a random one**, so the old password stops working (an anti-hijack measure). `oauth2Submit` `:343-346,374-377`. Hence: always tick Verified.                                                                                                                                                                                                                               |
| 3. The emails differ only in upper or lower case                 | No match, unless the `users` collection's unique email index is declared `COLLATE NOCASE`; PocketBase's default index is not (`FindAuthRecordByEmail` in `core/record_query.go:562-568`, default index added at `core/collection_model.go:1051-1060`). With a NOCASE index the same test signed in. **This app's migration declares it NOCASE** (`server/pb_migrations/1791849601_users_email_nocase.js`), so case doesn't matter here. |
| 4. Microsoft has no `mail` for the person (no mailbox)           | No email, so no match: it goes down the "new account" route below and is refused. Every user needs the `mail` attribute filled in Entra. `microsoft.go:122`, `record_auth_with_oauth2.go:134`                                                                                                                                                                                                                                           |
| 5. No account with that email, and the create rule is admin-only | **Refused**, `400 "Failed to create record."`. PocketBase tries to create the account through the ordinary create API with nobody signed in, so the collection's create rule decides (`oauth2Submit` `:260-332`, `sendOAuth2RecordCreateRequest` `:403-425`, `apis/batch.go:356`, `apis/record_crud.go:324-328`).                                                                                                                       |
| 6. No account with that email, and the create rule is `null`     | **Refused**, `403 "Only superusers can perform this action."` (`apis/record_crud.go:231-232`).                                                                                                                                                                                                                                                                                                                                          |
| 7. No account with that email, and the create rule is public     | **An account is created, already verified, for anyone Microsoft lets in** (tested). PocketBase's built-in `users` collection starts with a public create rule (`migrations/1640988000_init.go:321`), so the app's migration must change it.                                                                                                                                                                                             |
| 8. A superuser                                                   | Can never sign up through OAuth2 (`oauth2Submit` `:263-265`). Superusers keep using the dashboard password.                                                                                                                                                                                                                                                                                                                             |

So the two rules that keep it closed are: the `users` create rule stays admin-only, and the Entra app is single-tenant.

### 12.3 What IT registers in Microsoft Entra

Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) with an account that may register applications (at least _Application Developer_) and, for the consent step, may grant consent (_Cloud Application Administrator_ or _Application Administrator_).

1. **App registration.** **Entra ID > App registrations > New registration**. Name: `PM Space`. **Supported account types: "Single tenant only"** (the portal adds your tenant's name to it), the option Microsoft recommends for most apps. Press **Register**. (`entra-docs/docs/identity-platform/quickstart-register-app.md`)
2. **Redirect URI.** Open the app, **Manage > Authentication > Add Redirect URI**, choose the platform **Web** (server-side apps that exchange the code with a secret use Web, not Single-page application), and enter `https://studio.example.com/api/oauth2-redirect`. Redirect URIs must be `https` (only localhost is exempt), and the path is case-sensitive. (`how-to-add-redirect-uri.md`, `reply-url.md`)
3. **Copy two ids** from the app's **Overview** page: **Application (client) ID** and **Directory (tenant) ID**.
4. **Client secret.** **Certificates & secrets > Client secrets > New client secret**. A secret can last at most 24 months and Microsoft recommends under 12. **Copy the secret "Value" immediately; it is never shown again** (the "Secret ID" column is not what you need). PocketBase only supports a client secret here, not a certificate (`core/collection_model_auth_options.go:546-551`). Put the expiry date in a calendar: when it passes, Microsoft sign-in fails with `AADSTS7000222 ... client secret keys are expired`, while password sign-in keeps working. To rotate, create a second secret, paste it into PocketBase, then delete the old one. (`how-to-add-credentials.md`, `reference-error-codes.md:411`)
5. **API permissions.** Nothing to add. **Microsoft Graph > User.Read (delegated), "Sign in and read user profile"**, is added automatically at registration and is the only permission PocketBase asks for. Press **Grant admin consent for** your tenant on that page anyway, so no one sees a consent prompt and nothing breaks if your tenant restricts user consent. (`quickstart-register-app.md`, `howto-convert-app-to-be-multi-tenant.md:119`, `grant-admin-consent.md`)
6. **Optional: limit who may try.** **Entra ID > Enterprise apps > PM Space > Properties > Assignment required = Yes**, then assign people or groups. Admin consent (step 5) is then required. (`application-properties.md`, `configure-user-consent.md`)

### 12.4 What goes back into PocketBase

Dashboard > **Collections > `users` > the gear icon ("Collection settings") > Options > OAuth2**: switch **Enable** on, **Add provider**, choose **Microsoft**. (If you turned on "Hide/Lock collection and record controls", switch it off while you do this.)

| PocketBase field   | Value                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ID          | the **Application (client) ID**                                                                                                                                                                                                                                                                                                          |
| Client secret      | the secret **Value** from step 4                                                                                                                                                                                                                                                                                                         |
| Auth URL           | `https://login.microsoftonline.com/<Directory (tenant) ID>/oauth2/v2.0/authorize`                                                                                                                                                                                                                                                        |
| Token URL          | `https://login.microsoftonline.com/<Directory (tenant) ID>/oauth2/v2.0/token`                                                                                                                                                                                                                                                            |
| Extract email from | leave on the default (Graph `mail`). PocketBase calls this historical default "generally accepted to be safe in controlled/single-tenant AD setup" (`microsoftOptions.js:19`, `microsoft.go:117-121`). Use one of the id-token options only if `mail` is empty for your users and you have enabled the matching optional claim in Entra. |

The exact URLs are also listed in Entra under the app registration's **Endpoints** pane (use the v2 authorize and token endpoints). The user-info URL is not shown for Microsoft and stays at Graph's `/me`. Then:

- check the `users` create rule is still admin-only (**API rules** tab), and
- make sure every account's email matches the person's Microsoft 365 `mail` address.

### 12.5 App work left for a later phase

- A **"Sign in with Microsoft" button** on the login page (`src/pages/auth.js`) that calls `pb.collection('users').authWithOAuth2({ provider: 'microsoft' })` on the existing PocketBase client, then continues exactly like a password sign-in (load the data, start the sync). It must run directly from the click, because it opens a popup.
- A clear message for the refusal case (`400 Failed to create record.`): "There is no PM Space account for this Microsoft account. Ask an admin to add you."
- Keep password sign-in for IT and for emergencies (an Entra outage must not lock everyone out). Decide later whether to switch it off for ordinary users.
- Already done in Phase 1: the `users` email index is `COLLATE NOCASE` and the create rule is admin-only. Keep both.
- Test the popup in the browsers staff use. PocketBase v0.40 sends `Cross-Origin-Opener-Policy: same-origin` on every response (`apis/middlewares.go:296`, CHANGELOG v0.40.0), which can stop the app page from controlling a popup that has moved on to Microsoft. The flow does not depend on that (the result arrives over the live-update connection, and PocketBase's own completion page closes the popup itself: `ui/src/auth/pageOAuth2RedirectSuccess.js`), so it is expected to work, but it was not tried in a browser.
- Optional: copy the display name from `authData.meta` after the first sign-in (PocketBase does not update the name of an existing account), and decide what to do about avatars (the provider maps none).
