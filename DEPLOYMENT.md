# Deployment

Running a books folder for real: the one `npx dbu6 init` made, with dbu6
installed in its `node_modules`. This document is for that folder, not for
dbu6's repository; working on dbu6 itself is [DEVELOPMENT.md](./DEVELOPMENT.md).

## The shape

One process serves the web app and its API on one port: `dbu6 start`. It
migrates the database safely if anything is pending, builds the project's web
app when the project has reports or a `frontend.tsx` and that build is stale,
and then listens. The browser loads the app from that port and its API calls
are relative (`/api/...`), so nothing about the API's location is configured
in the frontend.

Anything in front of it (nginx, Caddy, a platform's router, a load balancer)
proxies one public origin to that port, for TLS and the rest. The proxy does
not change the browser contract: `/` and `/api/*` still share one origin.
Serving the SPA from a CDN on another origin than the API is not covered: the
prebuilt app calls `/api` relatively, and a project without reports is served
that prebuilt app.

## Before the first start

```bash
npx dbu6 init my-books      # or the folder you already keep
cd my-books
```

`init` wrote `.env` from the template with a generated `BETTER_AUTH_SECRET`
and local defaults. For a server, set the values that differ:

```sh
# .env
SAPPORTA_API_PORT=3000
SAPPORTA_PUBLIC_APP_URL=https://books.example.com   # the origin the browser uses
BETTER_AUTH_SECRET=...                               # keep the generated one
SAPPORTA_REQUIRE_VERIFIED_EMAIL=true
SAPPORTA_HEALTH_POLICY=authenticated
SAPPORTA_MAIL_TRANSPORT=smtp
SAPPORTA_MAIL_FROM="dbu6 <no-reply@books.example.com>"
SMTP_URL=smtps://user:pass@smtp.example.com:465
```

A value already in the environment wins over `.env`, so a systemd unit, a
container or a platform can set everything and the file can be absent. `.env`
is gitignored; never commit it.

Then:

```bash
npx dbu6 check              # tools, migrations, config, and the project's own code
npx dbu6 start
```

`check` says whether `uv` and `pdftotext` are installed (statement imports
need them), whether better-sqlite3's native binding loads, and whether
`user-config/` parses. `start` stays in the foreground; run it under systemd,
a process manager or the container below. It handles `SIGINT` and `SIGTERM`:
in-flight requests drain, the database is closed, then the process exits.

## The database, and backups

The books are `data/sqlite.db` under the project folder (or under
`SAPPORTA_DATA_DIR`, absolute or relative to the folder, if set). It must be
on a persistent filesystem: not `/tmp`, not a container's own filesystem.

**dbu6 keeps no backups.** There is one `sqlite.db` and no other copy,
anywhere: no backup retention, no copy outside the project, no `restore`
command. The one copy dbu6 ever makes is `migrateSafely`'s, beside the
database while a migration runs (`data/sqlite.db.migrating`), and it is gone
when the command returns, whichever way it went: the verified copy takes the
original's place, or the copy is deleted and the original is untouched.

Copying `data/` somewhere safe is therefore your job. SQLite gives a
consistent snapshot even while dbu6 is writing:

```bash
sqlite3 data/sqlite.db ".backup /backups/sqlite-$(date +%F).db"
```

Run it on a schedule and keep the copies off the machine. `user-config/`,
your parsers and reports are in the folder's git repository; push it.

## Upgrading

```bash
npx dbu6 upgrade            # to the latest version, or: npx dbu6 upgrade 1.4.0
```

`upgrade` moves the pin in `package.json`, runs `npm install`, prints the
upgrade notes of every version between the old one and the new one (what a
coding agent has to do about the release, when anything), migrates the
database safely, then runs `check`. If the migration does not verify, the
project is put back on the version it was on, reinstalled, and the database is
as it was; the message says which migration and which figures. If `check`
reports something, `upgrade` exits non-zero and the report says what to fix:
a report or `dbu6.config.ts` that no longer typechecks, a parser test that
fails. A coding agent is the intended reader of both.

Back up `data/` before an upgrade all the same: the migration is verified
against the ledger's figures, and a backup is what covers everything else.

Restart `dbu6 start` afterwards; the running process is the old version.

## The Dockerfile

`init` put a `Dockerfile` and a `.dockerignore` in the folder. The image is
built from the folder, so it holds this project: its `user-config/`, parsers,
reports and optional files, with dbu6 installed by `npm ci` from the
lockfile, and the project's web app built. It is unbuilt until dbu6 is on the
registry.

```bash
docker build -t my-books .
docker run -d --name my-books -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e SAPPORTA_PUBLIC_APP_URL=http://localhost:3000 \
  -v my-books-data:/app/data \
  my-books
```

- The image has no `.env` (`.dockerignore` keeps it out), so the container's
  environment configures dbu6. `BETTER_AUTH_SECRET` and
  `SAPPORTA_PUBLIC_APP_URL` are required; the rest is the table below. The
  port is `SAPPORTA_API_PORT`, or a platform's `PORT`, or 3000.
- `/app/data` must be a volume, named or a bind mount, or the books vanish
  with the container. A bind-mounted directory must be owned by uid 1000
  (the image's `node` user). Back it up the same way as above, from the host.
- `user-config/` is part of the image, so changing a mapping rule or a preset
  is a rebuild. To edit it in place, bind-mount the folder:
  `-v "$PWD/user-config":/app/user-config`.
- Statement imports work: the image has `uv`, `python3` and `pdftotext`.
  There is no coding agent in it, so nothing is categorized automatically,
  Settings says no agent was found, and the app offers only **Copy prompt**
  for the prompts it writes. The deprecated Nuabase gateway still categorizes
  there: set `LLM_ENGINE=nuabase` and `NUABASE_API_KEY`.
- The health check hits `/health` and treats any HTTP reply below 500 as
  healthy, so it holds under every `SAPPORTA_HEALTH_POLICY`.
- Upgrading is `npx dbu6 upgrade` in the folder, commit, rebuild the image,
  replace the container; `start` in the new container migrates the volume's
  database safely on its first run.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SAPPORTA_API_PORT` | The port dbu6 listens on. `PORT` is accepted instead, for platforms that assign one; if both are set they must agree. Default 3000. |
| `SAPPORTA_PUBLIC_APP_URL` | The origin the browser uses, such as `https://books.example.com`. Auth cookies, email links and the default trusted origin come from it. Required. |
| `SAPPORTA_FRONTEND_ORIGINS` | Extra browser origins allowed to make credentialed requests. Only when something other than the public origin serves the app. |
| `SAPPORTA_FRONTEND_PORT` | Only `dbu6 dev`, in a project with reports or a `frontend.tsx`: the port the screens are served on with hot reload. |
| `SAPPORTA_DATA_DIR` | The directory holding `sqlite.db`: absolute, or relative to the project folder. Default `data/`. |
| `BETTER_AUTH_SECRET` | Signs session cookies. Generated by `init`; changing it signs everyone out. Required. |
| `SAPPORTA_REQUIRE_VERIFIED_EMAIL` | Whether sign-up needs a verified email. `false` locally, `true` on a server with mail set up. |
| `SAPPORTA_HEALTH_POLICY` | Who may read `/health`: `public`, `authenticated` or `disabled`. |
| `SAPPORTA_MAIL_TRANSPORT` | `stream` prints outgoing mail to the terminal; `smtp` sends it; `disabled`. |
| `SAPPORTA_MAIL_FROM` | The sender of verification and reset mail, on a domain your SMTP provider will send for. |
| `SMTP_URL`, or `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | The SMTP connection, when the transport is `smtp`. `SMTP_URL` wins when both are given. |
| `LLM_ENGINE`, `NUABASE_API_KEY` | Deprecated: categorize on the Nuabase gateway instead of a coding agent on the machine. |
| `SAPPORTA_API_URL`, `SAPPORTA_API_TOKEN` | Not read by the server: they point the `sapporta` CLI and a coding agent at a running dbu6 (`npx dbu6 docs books`). |

## A reverse proxy

nginx, for one origin proxied to the process:

```nginx
server {
    listen 443 ssl;
    server_name books.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;   # statement uploads
    }
}
```

Set `SAPPORTA_PUBLIC_APP_URL` to the proxy's origin. dbu6 serves its own
static files with the right cache headers, so there is nothing to serve from
disk.
