# Development

Technical reference for working on dbu6. This repository is the source of one
npm package, `dbu6`, and nothing else: it is not a project and holds no books.
`pnpm dev` here only keeps `dist/` compiled. The app runs in a project folder
beside the checkout, such as `../demo-dbu6`, whose `node_modules/dbu6` links
to this checkout (see [A project linked to this checkout](#a-project-linked-to-this-checkout)).
For what dbu6 is and how a person uses it, see
[README.md](./README.md): they run `npx dbu6 init`, and never clone this
repository. For running a books folder for real, see
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Getting started from a clone

With the [prerequisites](#prerequisites) installed:

1. Install the Sapporta skill for your coding agent:

   ```bash
   npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
   ```

2. Compile dbu6 and keep it compiled:

   ```bash
   pnpm install
   pnpm dev
   ```

   `pnpm dev` cleans `dist/`, compiles the Node side, and then watches: one
   TypeScript watcher recompiles the Node side, and one typechecks the
   frontend. It starts no server.

3. In another terminal, make a project folder beside the checkout that runs
   it, and start the app there:

   ```bash
   mkdir ../demo-dbu6 && cd ../demo-dbu6
   echo '{ "name": "demo-dbu6" }' > sapporta.json
   echo '{ "name": "demo-dbu6", "private": true, "type": "module", "scripts": { "dev": "dbu6 dev", "seed": "dbu6 seed" }, "dependencies": { "dbu6": "link:../dbu6" } }' > package.json
   pnpm install
   pnpm exec dbu6 setup
   pnpm exec dbu6 migrate
   pnpm dev
   ```

   `dbu6 setup` creates `.env` from the template's `.env.example` with a
   generated `BETTER_AUTH_SECRET` and fills `user-config/`, and `dbu6 migrate`
   creates the database. `dbu6 dev` would not: it sets up only an empty
   folder, and this one already has files in it.

4. Open the frontend port, `SAPPORTA_FRONTEND_PORT` in that folder's `.env`
   (http://localhost:2340 from the template), and sign up; set
   `SAPPORTA_PUBLIC_APP_URL` to the same address (see
   [Ports and environment](#ports-and-environment)). For sample data, run
   `pnpm seed` in the project folder while its `pnpm dev` is running, and sign
   in as `demo@example.com` / `demo-password`.

`pnpm install` needs the Sapporta packages to resolve; see
[Sapporta packages](#sapporta-packages) for the state this checkout is in.

## Prerequisites

- Node 22+ and pnpm 11 (the version is pinned in `package.json`).
- `mise` is optional. Here `mise.toml` only pins the Node version and names a
  local Sapporta checkout; copy `mise.toml.example` to `mise.toml` if you want
  it. A project folder keeps its ports and personal settings, such as
  `NUABASE_API_KEY`, in its own `.env` or `mise.toml`.
- For automatic categorization and the Open in terminal buttons, Claude Code or
  Codex installed and logged in on this machine. See [LLM engine](#llm-engine).
- `pdftotext` (poppler) for PDF imports.
- `uv`, which runs the saved statement parsers.

### Sapporta packages

The `@sapporta/*` packages and `nuabase` come from the npm registry at the
versions pinned in `package.json`, so `pnpm install` needs nothing beside
this repository. That is the state to commit and the only state a release is
made from.

To work on the framework itself, clone Sapporta, run `pnpm install && pnpm build`
there, and point this project at it with
`pnpm package-sources use:local /absolute/path/to/sapporta`, which writes
`link:` specs into `package.json` and `pnpm-workspace.yaml`; `pnpm
package-sources use:npm` switches back and `pnpm package-sources status` says
which is active. While linked, rebuild Sapporta's `dist` after changing it
and before typechecking dbu6, or you will see stale type errors.

While the branch depends on Sapporta changes that are not published yet, the
links are committed, and three things are gated on them:

- `.github/workflows/ci.yml` finds the `link:` specs and skips every job that
  installs, so CI neither fails nor pretends to pass; `pii-scan.yml` needs no
  install and always runs.
- `scripts/pack.mjs` refuses to pack (a tarball would name registry versions
  that lack the checkout's changes) except with `--local-sapporta`, which
  `pnpm pack:verify` and `pnpm pack:verify-init` use and which is never
  published.
- `pnpm release` refuses; `pnpm release --dry-run` runs the whole path with
  `--local-sapporta` and says a release would be stopped.

Publishing Sapporta, then `pnpm package-sources:update-npm` and
`pnpm package-sources:use-npm`, lifts all three.

## Commands

- `pnpm dev` — `scripts/dev.mjs`: clean `dist/`, compile the Node side, then
  watch: recompile the Node side on change, and typecheck the frontend. It
  serves nothing; a [linked project](#a-project-linked-to-this-checkout)'s
  `dbu6 dev` restarts its server on each recompile.
- `pnpm build` — typecheck, then `scripts/build.mjs`: compile the Node side
  (`tsc`) to `dist/server`, `dist/shared` and `dist/frontend-host`, build
  `dbu6/frontend` to `dist/frontend`, and build the prebuilt web app to
  `dist/app`. See [The package](#the-package).
- `pnpm typecheck` — both TypeScript projects: `tsconfig.json` (Node: server,
  shared, frontend host) and `src/frontend/tsconfig.json` (DOM: frontend,
  shared).
- `pnpm test` — vitest (two projects in `vitest.config.ts`, `server` and
  `frontend`; `pnpm exec vitest run --project frontend` runs one), then
  `pnpm test:scripts`. `pnpm test:parsers` (`dbu6 parser test`) runs the
  bundled parsers' Python tests, and needs `uv`; `pnpm dbu6 parser test
  hdfc-bank-xls` runs one parser's.
- `pnpm test:watch`, `pnpm format`.
- `pnpm dbu6 <command>` — the `dbu6` command (`bin/dbu6.mjs`), the same one a
  user's project runs. Here it is for `docs` and `parser`. `dbu6 dev` refuses
  this repository, which has files but no database; `dbu6 setup` and
  `dbu6 migrate`, which create a project's files when asked, would create
  them here, so run them in a project folder. See
  [The `dbu6` command](#the-dbu6-command).
- `pnpm pii-scan` — the "No PII" scan of AGENTS.md over the tracked tree
  (`scripts/pii-scan.mjs`); `pnpm pii-scan:pack` scans what `npm pack` would
  ship and refuses `link:` dependencies. Both run in a release.
- `pnpm pack:tarball`, `pnpm pack:verify`, `pnpm pack:verify-init`,
  `pnpm release` — see [The package](#the-package) and
  [Releasing](#releasing).
- `node scripts/move-files.mjs … [--dry-run]` — move code inside
  `src/server` (paths relative to it) and rewrite every relative import of
  it. Each form merges imports that end up naming one module twice, formats
  the edited files, and reports the TypeScript errors left in them;
  `--dry-run` prints the edits and those errors without making them.
  Afterwards it lists text that still names what moved, such as the docs and
  the agent prompts; update those by hand.
  - `<from> <to> [<from> <to> …]` moves files or folders with `git mv`, and
    rewrites every `vi.mock` path too. It also lists tests left beside a moved
    file.
  - `--symbols <file> <name>[,<name>…] <to>` moves top-level declarations
    into another file, created if it doesn't exist, with TypeScript's "Move to
    file" refactor.
  - `--through <folder>` makes every file outside the folder import its files
    through its `index.ts`.
- `pnpm db:generate --name add_table` — generate
  Drizzle SQL migrations from schema changes. It and `pnpm db:check` need no
  database.
- `pnpm db:migrate` — apply pending migrations with Drizzle Kit to the
  database in `SAPPORTA_DATA_DIR` (relative to this repository, or absolute),
  in place and unverified:
  `SAPPORTA_DATA_DIR=../demo-dbu6/data pnpm db:migrate`. It is for a migration
  still being written, against a database you can lose; `dbu6 migrate` in the
  project is what everything else uses. `pnpm db:studio` opens the same way.

### A project linked to this checkout

dbu6 runs, while it is worked on, in a project folder beside the checkout,
such as `../demo-dbu6`. Its `package.json` depends on `"dbu6":
"link:../dbu6"`, so `pnpm install` there makes `node_modules/dbu6` a symlink
to this checkout and `node_modules/.bin/dbu6` its command.
[Getting started](#getting-started-from-a-clone) shows how to make one. It
runs this checkout's `bin/dbu6.mjs` and the compiled `dist/`, which `pnpm dev`
here keeps current, so start that first. Everything else about it is an
ordinary project's: its `.env`, `data/`, `user-config/`, `sapporta.json`, and
its own reports and parsers if it has any.

In it, `pnpm <script>` runs what its `package.json` names and
`pnpm exec dbu6 <command>` runs any command:

- `dbu6 dev`: migrate safely, then the API server under `node --watch` and
  Vite, which hot-updates `src/frontend`. It creates and overwrites nothing,
  except in an empty folder, which it sets up first. See
  [How a linked project's `dbu6 dev` runs](#how-a-linked-projects-dbu6-dev-runs).
- `dbu6 setup`: create `.env` from the template's `.env.example` with a
  generated `BETTER_AUTH_SECRET`, and fill `user-config/` from
  `user-config.example/`. Every step leaves an existing file alone. It does
  not touch the database.
- `dbu6 migrate`: `migrateSafely` alone (see
  [Schema and migrations](#schema-and-migrations)). `dev` and `start` run it
  too, and it creates the database when there is none.
- `dbu6 seed [YYYY-MM-DD]`: with the project's `dbu6 dev` running, create
  `demo@example.com` (password `demo-password`) holding a year of sample
  personal finances up to today, or up to the given date. The twelve months
  before that month are posted journals, and that month so far is HDFC savings
  drafts. The demo account gets an import preset institution for each
  statement account, written with the ledger. Re-running replaces the demo
  account's ledger and presets. With
  `--statements <dir>`, that month is written to `<dir>` as the statement files
  it would arrive in (HDFC savings XLS, HDFC credit card CSV, and an SBI PDF no
  saved parser reads, whose institution lists no parser) instead of drafts.
  `--statements` draws the files with the parsers' fixture
  generators, so it works only when dbu6 runs from this repository, not from an
  installed package. The code is `src/server/seed/`.
- `dbu6 start`: migrate safely, then serve API and SPA on one port (run
  `pnpm build` here first, for `dist/app`).

## Ports and environment

A project's environment lives in its `.env`, which the `dbu6` command loads
for every command. `dbu6 setup` creates it from `template/.env.example` and
fills in `BETTER_AUTH_SECRET`. It holds the ports and the URLs derived from
them, the data directory, and local-only auth and mail defaults —
`SAPPORTA_MAIL_TRANSPORT=stream` among them, so Nodemailer prints the full
generated email source to the API console instead of delivering it. This
repository has no env file: nothing here reads one.

A value already in the environment wins over one from an env file, so a
`mise.toml` entry or a plain shell export overrides any of these without
editing the file. That is what makes mise optional rather than required.

A linked project's `dbu6 dev` always serves the app through Vite, on
`SAPPORTA_FRONTEND_PORT`. The template's `.env.example` points
`SAPPORTA_PUBLIC_APP_URL` at the API port, where a project with no reports is
served, so in a linked project set it to the frontend port's address, as
`../demo-dbu6/.env` does, and auth and email links reach the app.

`SAPPORTA_DATA_DIR` in a project's `.env` names the directory that holds
`sqlite.db`: an absolute path, or a path relative to the
project root. When it is unset the database is `data/sqlite.db` in the project
folder. Point it somewhere else to keep, say, sample data apart from real
data. `pnpm db:migrate` and `pnpm db:studio` here read the same variable, from
the shell.

### Running multiple Sapporta projects on one machine

Each backend binds to `SAPPORTA_API_PORT` and each Vite dev server binds to
`SAPPORTA_FRONTEND_PORT` — `3000` and `5173` when neither is set. To run
several projects side-by-side, give each its own stable port pair, either by
editing its `.env`:

```sh
SAPPORTA_FRONTEND_PORT=2341
SAPPORTA_API_PORT=2346
SAPPORTA_PUBLIC_APP_URL=http://localhost:2341
SAPPORTA_API_URL=http://localhost:2346
```

or by overriding the same four variables from its `mise.toml`. The frontend
host (`src/frontend-host/config.ts`) points its `/api` proxy at the API port and
binds Vite to the frontend port. The API trusts the derived public app
URL and uses it for auth/email callback links, so those links also go through
Vite's `/api/*` proxy in development. `VITE_API_URL` is not needed because
frontend code calls relative `/api/*` URLs through Vite's proxy.

Vite fails when the configured frontend port is occupied instead of silently
selecting another one. The derived `SAPPORTA_API_URL` also points API-backed CLI
commands at the same backend.

Managed hosting platforms may set the conventional `PORT` variable instead of
`SAPPORTA_API_PORT`. The API accepts that fallback. If both variables are set,
they must contain the same port.

## Project layout

```
src/server/              backend — schema/, modules/, workflows/, app/ (see Backend layering)
src/frontend/            SPA — React, imports @sapporta/frontend and @sapporta/ui CSS
src/shared/              ts-rest contracts + types shared by backend and frontend
src/frontend-host/       Vite run programmatically: serves and builds the app (see The package)
migrations/              Drizzle migrations, shipped in the package
custom-built-parsers/    saved Python parsers for known statement layouts
docs/                    the guides `dbu6 docs` prints, their worked examples, upgrade-notes/
template/                a user project's starting files, rendered by `dbu6 init`
user-config.example/     the example config `dbu6 setup` fills user-config/ from
src/cli/                 the `dbu6` command's commands; bin/dbu6.mjs loads them from dist/cli
bin/dbu6.mjs             the package's `bin`
scripts/                 repository tooling: build, pack, release, PII scan, move-files, package sources
dist/                    gitignored — build output, the only code the package ships
```

`template/` is what a person's folder starts as: `package.json` pinned to
this package's exact version, `tsconfig.json`, `.env.example`, `gitignore`
(written as `.gitignore`; npm drops a real one from a package), `AGENTS.md`,
and the `Dockerfile` with its `.dockerignore`. `user-config/` is filled by
`setup`, from `user-config.example/`. There is no `reports/`,
`dbu6.config.ts` or `frontend.tsx` in the template; the guides show them.

The guides are listed in `src/shared/guides.ts` (`GUIDES`), which is the one
place a guide's name, file and worked examples are declared: `dbu6 docs
<name>` prints the file and then each example under its path, so a guide
never holds a copy of code that is typechecked where it lives
(`docs/examples/`, under `tsc -p docs/examples` in `pnpm typecheck`). The
prompts name guides through `guideCommand`, never by path, because in a
user's project the files sit under `node_modules`.

### The package

dbu6 is one package with one `package.json`. `exports` names everything a
user's project may import, and nothing else is reachable:

| Specifier | File | What it is |
|---|---|---|
| `dbu6/server` | `dist/server/index.js` | from `src/server/index.ts` |
| `dbu6/frontend` | `dist/frontend/index.js` | from `src/frontend/index.ts`: a Vite library build with every bare import left external |
| `dbu6/frontend.css` | `dist/frontend/frontend.css` | `src/frontend/frontend.css` copied: Tailwind source, imported only by the frontend host |

`src/` is not shipped. [docs/frontend-host-findings.md](./docs/frontend-host-findings.md)
explains why the frontend ships as compiled JS plus Tailwind source, and how
the host (`src/frontend-host/`) builds a user's app from it. `dist/app` is our
own app built by that same host from `dist/frontend`, so what we ship went
through the pipeline a user's build goes through.

Import rules between the parts of `src/` are checked by
`scripts/import-boundaries.test.mjs` (part of `pnpm test`): `src/frontend` may
import `src/shared` and nothing from `src/server`, and the reverse.

`pnpm pack:tarball` (`scripts/pack.mjs`, after `pnpm build`) packs the way the
package is published: from a staging copy of the files `npm pack` would
include, with a manifest stripped of scripts and dev dependencies and an
`npm-shrinkwrap.json` that npm resolves there. The shrinkwrap cannot come from
`pnpm-lock.yaml`, so it is npm's resolution at pack time, and it is the
tarball, not this checkout, that CI must test.

`pnpm pack:verify` proves the user's path: it packs with `--local-sapporta`
and runs `scripts/verify-tarball.mjs`, which installs only the tarball in a
scratch project under `tmp/` with npm and checks that `dbu6/server` and
`dbu6/frontend` import, that nothing else does, that the project typechecks,
and that the frontend host builds its app. While Sapporta is linked from a
local checkout, `--local-sapporta` also packs those packages (with `pnpm pack`,
which writes nothing into that checkout) and installs them through npm
`overrides`; such a tarball carries no shrinkwrap and is never published. A
tarball packed without the flag names the registry's Sapporta versions, which
install but lack whatever the checkout has that is unpublished.

`pnpm pack:verify-init` proves the first thing a user does: it packs the same
way and runs `scripts/verify-init.mjs`, which calls `dbu6 init` with the
tarball as the dbu6 to install (`initProject` from `dist/cli`, with the linked
Sapporta's `overrides` added to the new project's package.json before its
`npm install`), then checks the project it made, runs `dbu6 check` in it, and
starts `dbu6 start` on ports 2400/2401 until `/health` answers.
`.github/workflows/ci.yml` runs both proofs, plus `dbu6 check` and
`dbu6 build` in the tarball project, from a registry-resolved tarball; its
jobs that install are skipped while `package.json` carries `link:` overrides.

### Releasing

dbu6 is published from the tarball `scripts/pack.mjs` stages, never from this
directory: the root `package.json` describes the repository (scripts, dev
dependencies, `private: true`, and `link:` specs while Sapporta is linked),
and the staged manifest is what a user's npm installs. `npm publish` here is
refused twice, by `private` and by `prepublishOnly`, which prints where to go
instead. `npm publish <tarball>` runs no lifecycle script, so the gate is the
release script itself:

```bash
# in package.json: set "version" to the release, commit
pnpm release --dry-run     # every gate and step, nothing uploaded
pnpm release               # publish, then tag v<version>; push the tag
```

`scripts/release.mjs` refuses unless the version is exact and not the
`0.0.0` placeholder, the tree is clean, no `v<version>` tag exists and no
dependency is a `link:`; then runs `pii-scan --tracked`, `pii-scan --pack`,
`pnpm test` (`--skip-tests` when CI has), `pnpm build`, `pack.mjs` into
`tmp/release/` (which scans the staged tree once more, generated manifest and
shrinkwrap included), and `npm publish <tarball> --access public`. A
prerelease version goes under the `next` dist-tag unless `--tag` says
otherwise. With `--dry-run` every gate and step runs and is reported, `npm
publish --dry-run` prints what would be uploaded, and the exit code says
whether a release would have gone through.

A release that changes the promised surface, a `user-config/` format, the
parser contract or the schema in a way a project has to act on gets a note in
`docs/upgrade-notes/<version>.md`, in the same commit
([docs/upgrade-notes/README.md](./docs/upgrade-notes/README.md) has the
convention). `dbu6 upgrade` prints the notes between the two versions. Most
releases need none.

`sapporta.json` marks a project's root for Sapporta: this repository has
none, since it is not a project, and a user's project gets its own from the
template. Sapporta looks
for the marker starting from the running script, so nothing that ships inside
the package may look like one, or an installed dbu6 would take
`node_modules/dbu6` for the project.

### How a linked project's `dbu6 dev` runs

`dbu6 dev` (`src/cli/dev.ts`) starts the API under `node --watch`
(`dbu6 serve --no-frontend`, from `dist/`), in its own process group, which is
stopped by signalling the group, so stopping `dev` leaves nothing running.
Nothing in it compiles: `pnpm dev` in this repository recompiles the Node side
into `dist/`, and `node --watch` restarts the API when a file it imported
changes. Vite runs inside the `dev` process: the frontend host, as in a user's
`dbu6 dev`, but with `ownFrontend: "src"`: `dbu6/frontend` is aliased to
`src/frontend/index.ts` and the stylesheet to `src/frontend/frontend.css`, so
our own code hot-updates. A user's project gets the compiled `dist/frontend`
from `node_modules` instead, pre-bundled. `pnpm build` uses the third mode,
`"dist"`, for the prebuilt app.

The host is Node code and runs compiled, from `dist/frontend-host`, which is
why `bin/dbu6.mjs` compiles the Node side when `dist/` lacks it. Vite's root is
this repository, not the project folder: Vite resolves react and the rest from
its root's `node_modules`, and the project has only `node_modules/dbu6`.

### The `dbu6` command

`bin/dbu6.mjs` is the package's `bin` and is thin: it imports
`dist/cli/main.js` and calls `main(args)`. Run from this repository, as a
linked project runs it, it first compiles the Node side when `dist/` lacks it,
and registers Sapporta's source-link hook when `@sapporta/server` is a `link:`
dependency, which is why no script passes `--import` any more.

`src/cli/` holds one module per concern: `main.ts` (dispatch, and what a
migration result prints), `project.ts` (the project folder: `DBU6_ROOT`, else
the nearest `package.json` at or above the working directory; and its `.env`),
`dev.ts`, `setup.ts`, `init.ts`, `upgrade.ts`, `check.ts`, `parser.ts`, `docs.ts`,
and `frontend.ts`, the command's only contact with the frontend host. `src/cli`
sits above the rest of the Node side: it alone may import both `src/server` and
`src/frontend-host` (`scripts/import-boundaries.test.mjs`). `seed` is
`src/server/seed/`.

| Command | Does |
| --- | --- |
| `dev` | in an empty folder (nothing but hidden files) `setup` first; in any other it creates nothing and refuses one with no database (`devFolder` in `project.ts`). Then `migrateSafely`, the server under `node --watch`, plus Vite when the project has reports or a `frontend.tsx` (always, when dbu6 runs from this repository) |
| `start` | `migrateSafely`, build the project's web app if it has one, serve |
| `serve [--no-frontend]` | serve only; what `dev` runs under `node --watch`. Refuses pending migrations |
| `build` | build the project's web app into `<root>/dist/app` |
| `migrate` | `migrateSafely` alone |
| `upgrade [version]` | refuses a version older than the installed one; otherwise pin, `npm install`, print `docs/upgrade-notes/` between the versions, then the new version's `migrate` and `check`; restores `package.json` and the lockfile and reinstalls if the migration fails |
| `check` | everything an upgrade can break, in one report; exit 1 when a line fails, and nothing is changed. See [`dbu6 check`](#dbu6-check) |
| `setup` | the env file, an auth secret, `user-config/` |
| `seed [date] [--statements <dir>]` | sample data for the demo account |
| `parser test [name]`, `parser run <name> <input>` | a parser's tests, or a parser on a file, with `shared` on `PYTHONPATH` |
| `docs [name]` | print a packaged guide (`GUIDES` in `src/shared/guides.ts`); lists them with no name |
| `init <directory> [--dbu6 <spec>]` | a new project: `template/` rendered (the name from the directory, dbu6 pinned to this package's exact version, `gitignore` written as `.gitignore`), `npm install`, then the installed package's `setup` and `migrate`, and a first commit when git is installed. Refuses a directory with anything in it. `--dbu6` installs another spec, such as a tarball, for an unpublished build |

A scratch project, say to try a report, is made like
[a linked project](#a-project-linked-to-this-checkout), on ports of its own.
Its `dbu6.config.ts` and `reports/*/api.ts` import `dbu6/server`, which
resolves through `node_modules/dbu6` to this package's `exports`, so to
`dist/`, which is also what the running server loaded.

#### `dbu6 check`

`src/cli/check.ts`. Each section is a function of the project root that
returns `{ name, status, detail }` lines, `status` being `ok`, `fail` or
`info`; `runCheck` runs them all, prints one line per check with a failure's
tool output indented under it, and returns whether any line failed. `info`
lines never fail the run. `dbu6 upgrade` runs it after migrating.

| Section | Checks | Fails when |
| --- | --- | --- |
| Tools | Node against the package's `engines.node`; better-sqlite3 opens a database; `uv` and `pdftotext` are on `PATH` | any is missing or too old |
| Migrations | the migrations `data/sqlite.db` has not applied | never: pending ones are information for `dbu6 migrate` |
| Types | `tsc --noEmit` with the project's `tsconfig.json`, when the project has any `.ts` (typescript is resolved from the package, not the project) | tsc reports an error, or there is TypeScript but no tsconfig |
| Reports | `node --test` over each `reports/<id>/**/*.test.ts`; then a build of the web app when the project has `reports/*/report.ts` or a `frontend.tsx`, into a temporary directory that is removed, so `dist/app` is untouched (the build also runs `assertSingleCopies`) | a test or the build fails |
| Parsers | every `*_test.py` of the project's `custom-built-parsers/`, under `uv` with `shared` on `PYTHONPATH`; a project parser that shadows a bundled one is named | a test fails or uv cannot run |
| Config | `user-config/` read by the code the app reads it with: `transaction_mappings.mjs` (`readTransactionMappings`), `settings.json` (`chosenCodingAgent`); the import presets, every row of `import_presets` (`readEveryImportPreset`), with each listed parser, each instruction file and each account's ledger account; an `import-presets.json` that migration 0008 has not moved (information while that migration is pending) | a file does not parse, a preset names something missing, or `import-presets.json` is left after 0008 kept it |

In this repository, `pnpm typecheck` and `pnpm test:parsers` cover what
`check` checks in a project. `src/cli/check.test.ts`
builds a scratch project with a report that no longer typechecks, a failing
parser test and a pending migration, and asserts that one run names all three.

How the server is assembled is `openDbu6` (`src/server/open.ts`): the config
is imported first, because its `loadCategorizer` is an input to the runtime;
then the runtime, middleware, the framework's routes and ours, the project's
reports (`project-reports.ts`), the config's `extend`, OpenAPI, and the web
app last. Node runs the project's `.ts` files itself, by type stripping, since
they sit outside `node_modules`. A route that repeats an existing one stops
startup, naming the file (`route-collisions.ts`).

### Backend layering

`src/server` is layered in tiers. A file imports only from its own module, from
a lower tier, or from a same-tier module it sits above, so each tier can be
built, tested and understood without anything above it. Lowest first:

| Tier | Where | Modules | Owns | Must not contain |
| --- | --- | --- | --- | --- |
| 0 | `schema/`, `paths.ts`, `data-lock.ts`, `dbu-config.ts`, `modules/ledger-sql/` | schema, paths, data-lock, dbu-config, ledger-sql | Tables; where everything is, in the project and in the package, the database file included; the data folder's lock; what dbu6 keeps about the machine in `dbu_config`; row scoping for raw SQL, built from Sapporta's `rowSecurity`, and the auth type every store takes | Domain queries; a hand-written workspace/user filter |
| 1 | `modules/values/` | values | Money and its direction, amounts in paise and when two are the same, Account, Chrono, the text normalization transaction identity uses | I/O, statements, ledger tables |
| 2 | `modules/statement/` | statement | Statement rows and documents (Abacus): parsing, ordering, running balances, joining a multi-part upload, and the statement's own errors | HTTP status, wire payloads, checkpoints, upload or request advice |
| 3 | `modules/` | transaction-identity, categorization, gpay, journal-plan, statement-sources, chart-of-accounts | Transaction keys and matchers; mapping rules, the prompt, the LLM interface, and turning an answer into a ledger account id, the same-account rule included; the Google Pay Takeout index and enrichment; the journal plan and the one hledger formatter; saved parsers, import presets and the auto-import plan; the starter chart of accounts and the rules a proposed chart keeps | Database access, coding-agent names, route concepts |
| 4 | `modules/` | accounts < journals < reconciliation < drafts; coding-agent; import-presets | Accounts as the stores and screens look them up, and the Opening Balances account; posted journals, writing them from a plan, the last reconciled checkpoint, and each account's opening entry, the entries beside it, and rewriting or deleting a standalone one (`opening-entries.ts`); matching against stored drafts and journals, running balances, the balance-check rule, the since-checkpoint filter (its checkpoint-day rule and why: `reconciliation/checkpoint-day.md`); draft rows: saving, placing balance assertions, loading, reclassifying, clearing once posted, status, where an account's drafts begin (`first-drafts.ts`), and the lessons the user teaches the categoriser from them (`categorization-lessons.ts`). The coding agent: detection, models, handoff, settings, and at its top the engine categorization runs on. The import_presets rows, read and written under the request's auth | Workflow sequencing, report columns; ledger concepts anywhere in coding-agent but its top file |
| 5 | `workflows/` | statement-import, posting, reclassification, opening-balances, import-presets, chart-of-accounts; add-account above opening-balances, import-presets and statement-import | The domain workflows, where the action happens: they sequence module calls and make the domain decisions | SQL, text formatting, HTTP; imports of each other |
| 6 | `app/`, `runtime.ts`, `mount.ts`, `open.ts`, `config.ts`, `project-reports.ts`, `route-collisions.ts`, `report-kit.ts`, `index.ts`, `seed/` | app | Routes, reports (rendering only), error translation, uploads, auth guards, the Home and Review views, hosting; the project's reports and `dbu6.config.ts`; the promised exports; sample data | Queries or rules another module needs |

- Only tier 4 orders its modules (accounts < journals < reconciliation <
  drafts). Tier 3 modules never import each other, and neither do workflows: a
  step two of them need moves down into a module. The one exception is
  `workflows/add-account.ts`, adding a bank or card from its statements
  (/add), which sequences opening-balances, import-presets and
  statement-import and is imported by none of them.
- A module that declares entry files is imported only through them.
- A route authorizes, calls one workflow (or a module, for a plain read), and
  translates the result and the errors to HTTP.
- A module's errors carry domain fields only: no HTTP status, wire body or
  advice. `workflows/statement-import/refusals.ts` lists the errors that end an
  import, the modules' and the import's own (an account the ledger doesn't
  have), and `app/import-error-response.ts` alone turns them into a status
  and a `statementImportErrorSchema` body, hints included.
- Tests live with the module they test and follow the same rules.
- Sapporta's guide puts larger workflows in `src/server/modules/<domain>/`.
  dbu6 keeps them in `workflows/`, a tier of their own, on purpose; don't move
  them into `modules/`.

Beside the tiers, `migrate-safely.ts` and `ledger-fingerprint.ts` are the
database's upgrade. They import only `paths.ts`, `data-lock.ts`, Sapporta and
`data-migrations/`, and read the ledger's tables with SQL of their own,
because a fingerprint must read every schema a database has had. A data
migration in `data-migrations/` may use tier 3's pure code to decide what to
write, and writes it with SQL of its own (see
[Schema and migrations](#schema-and-migrations)).

Every file is in its tier. No test checks it, so a new file gets its place in
this table when it is added. Each
module in `modules/<name>/` is imported through its `index.ts`: `ledger-sql`,
`values`, `statement`; in tier 3 `transaction-identity`, `categorization`,
`gpay`, `journal-plan`, `statement-sources` and `chart-of-accounts`; and in tier 4 `accounts`,
`journals`, `reconciliation`, `drafts`, `coding-agent` and `import-presets`.
Tests also import
`ledger-sql/testing.ts`, whose `testLedgerAuth` is a request's auth over the
ledger's tables. The workflows are
`workflows/statement-import/` (one account's statement, the automatic batch,
and freeform transactions; imported through its `index.ts`),
`workflows/posting.ts`, `workflows/reclassification.ts`,
`workflows/opening-balances.ts` (each asset and liability account's opening
entry: listing them with their sections and locks, posting one
against Opening Balances, and changing or removing one while nothing else is
posted on its account and its journal opens it alone),
`workflows/import-presets.ts` (the presets' one writer: a batch of changes
applied, checked against the whole table, and written in one transaction),
`workflows/chart-of-accounts.ts` (setup's chart of accounts: the starter
chart for books with no accounts, and creating the ticked accounts) and
`workflows/add-account.ts` (/add: reading dropped statements as /import
does, then setting up the bank or card they belong to, its opening balance
and its import). A bank or card's ledger account and preset entry, written
together, are in `workflows/import-presets.ts`.

`src/shared/` is imported by relative path (`../shared/index.js` from the
server, `../shared/index` from the frontend). Both
`src/server/` and `src/frontend/` depend on it; it depends on
neither. It holds what would otherwise be declared on both sides of the
client/server boundary: contracts, wire types and pure helpers.

## User data

Everything specific to the user lives in the project root: the database in
`data/` (`SAPPORTA_DATA_DIR`), their config in `user-config/`, their parsers
in `custom-built-parsers/`, and the uploads an agent is pointed at in `tmp/`.
This repository holds none of it, and still gitignores `data/` and
`user-config/`, so books put here by mistake stay out of git; in a user's
project only `data/` is gitignored. The template's Dockerfile copies the project into the image and
declares `/app/data` as its volume.

dbu6 keeps no copy of the books beyond `data/sqlite.db`: `migrateSafely`'s
copy lives beside it and is gone when the command returns, whichever way it
went, and there is no backup retention, no backup outside the project and no
`restore` command. Backing up `data/` is the user's job, and the docs say so.

### Moving the books out of an older clone

A clone from before this repository stopped being a project may hold real
books in `data/`. They move by hand, once, and nothing here migrates the
clone layout:

1. Make a project folder outside this repository: `npx dbu6 init my-books`
   once the package is published, or until then
   [a linked project](#a-project-linked-to-this-checkout).
2. With nothing running, move (not copy, so the books stay in one place)
   `data/sqlite.db` to `my-books/data/`. Before user-config moved to the
   project root it sat in `data/user-config/`; move that, or `user-config/`,
   to `my-books/user-config/`, over what `init` filled in. Move
   `.env.development` to `my-books/.env`, which keeps the auth secret and so
   the sign-ins, and `tmp/statement-uploads/` and `tmp/agent-prompts/` to
   `my-books/tmp/`.
3. Copy any private parser from the clone's `custom-built-parsers/` (one
   the package does not ship) to `my-books/custom-built-parsers/<name>/`.
4. In `my-books/user-config/import-presets.json`, each preset's
   `custom_statement_parser_path` is the parser's directory name alone
   (`hdfc-bank-xls`), resolved against the project's parsers and then the
   package's; edit a value that is still a path.
5. `cd my-books && npx dbu6 dev`. Its migration moves `import-presets.json`
   into the presets table and deletes the file, or says why it kept it
   (DBU6-BOOKS.md, "Import presets", has the conversion for a kept file).
6. `npx dbu6 check`.

`src/server/paths.ts` is the one module that knows where things are, and no
other file joins a path onto a root. What is the user's comes from the project
root (`userConfigDir()`, `userConfigPath()`, `dataDir()`, `databaseFile()`,
`reportsDir()`, `uploadStagingDir()`); what is ours comes from the package directory
(`packageDir(...)`), found by walking up from `paths.ts` to the `package.json`
named `dbu6`, never from the project root. `parserRoots()` is the user's
`custom-built-parsers/` and then ours. In a user's project the package is
under `node_modules`, and in a linked project that is a symlink to this
repository; only `dbu6 parser`, run here, has the two the same. `DBU6_ROOT` overrides the project root, which is how a
test points it at a temporary directory (`vi.stubEnv("DBU6_ROOT", dir)`).
`openDbu6Runtime(root)` refuses a `root` other than the one `DBU6_ROOT` names,
because the functions above that take no root would read that other folder.

### transaction_mappings.mjs

Deterministic rules, applied before the LLM is consulted. The file is pure
data; the matching engine is
`src/server/modules/categorization/mapping-rules.ts`.

`loadCategorizer` (`categorization/load-categorizer.ts`) reads this file and the
account's prompt files once for each import or reclassification; it is the only
code that reads them. `categorize` (`categorization/categorize.ts`) applies what
it read: the rules, then the LLM for the rest, choosing from the ledger's
accounts, then the ledger account each answer names by its exact name in
Accounts. A name the ledger doesn't hold, or the
statement's own account, leaves the row uncategorized. A file that is missing
or broken refuses only once a row needs it, so an import with nothing new
needs no config.

Narrations are normalized before matching (NFKC, whitespace collapsed, trimmed,
upper-cased). `exact` wins outright; `includes` are substring rules checked in
declaration order, so put narrow patterns ahead of broad ones. `direction` is
optional and limits a rule to `"withdrawal"` or `"deposit"`.

### LLM prompts

The categorization prompt template is in
`src/server/modules/categorization/prompt-template.ts`. It is filled with
the accounts the LLM may answer with and the `custom_mappings_*.prompt` files
the statement's account lists in the import presets
(`custom_mappings_filenames`, joined in that order), which `loadCategorizer`
reads. `categorize` supplies the accounts: every account in the Accounts table
(row-scoped) except Equity, one name per line. Each row the LLM gets names its
statement account in brackets ahead of the narration
(`[cc:sample] Expense: …`), and the prompt keeps it from choosing another bank's
or card's accounts except for a clear transfer. Notes about what an account is
for belong in the `custom_mappings_*.prompt` files. An `hledger_accounts.prompt`
left in `user-config/` from before is no longer read.
`categorization/llm-categorization.ts` is the only LLM call site. It says what
categorization needs of an LLM (`CategorizationLlm`), sends the descriptions
the mapping rules didn't categorize, and reports how the calls fared; which
engine fills that need is `src/server/modules/coding-agent/`'s business. A
failed call's error arrives fit to show: `coding-agent/nuabase.ts` logs the
full message and shortens what it returns (`reportedError`).

### LLM engine

dbu6 uses one coding agent for everything AI: Claude Code (`claude`) or Codex
(`codex`), installed and logged in on the machine running the server. It is
chosen on the **Settings** screen; until then dbu6 uses the first installed,
Claude Code first. The choice is saved in `user-config/settings.json`, and
the agent's executable must be on the server's `PATH`.

Everything the server does with an agent is in
`src/server/modules/coding-agent/`, which the rest of the backend imports
through its `index.ts`:

| Module | What it holds |
| --- | --- |
| `agents.ts` | `CODING_AGENT_RUN`: each agent's models, most capable first, and its auto-mode options. Detection, the saved choice, and which agent is active. |
| `models.ts` | Which of an agent's models answer on this machine, and when to ask again. |
| `nuabase.ts` | The only import of `nuabase`; every call into it and every value out of it. |
| `categorization-llm.ts` | The engine categorization runs on: the agent, or the deprecated gateway. |
| `chart-llm.ts` | The same engine for setup's chart of accounts, on the agent's most capable model. |
| `handoff.ts`, `launcher.ts` | Starting an agent on a prompt in a terminal. |
| `errors.ts` | Why the server refused, as the routes state it. |
| `settings.ts` | What the Settings screen reads and changes. |

The screens' side of an agent — its name, how to sign in — is
`codingAgentSchema` and `CODING_AGENTS` in `src/shared`. Adding an agent is an
entry in each of those two tables.

- **Models.** The last model in an agent's list is the floor: dbu6 never uses a
  less capable one. Which models work depends on the login and plan (Codex
  refuses Sol on some ChatGPT accounts), so dbu6 asks each model for a one-word
  reply at startup, for every signed-in agent, and logs what it found. It asks
  again when a prompt or categorization needs a model and none answered last
  time, and when **Check models again** is pressed on Settings, which shows the
  models and why any didn't answer.
- **Categorization** runs headless (`Nua.direct` with `localAgent`), on the
  least capable model that answered, billed to your own Claude or ChatGPT plan
  rather than an API key. Nothing is cached, so reclassifying sends every
  description again.
- **The chart of accounts** a new user describes at `/setup` is one
  more headless call (`Nua.direct`'s `get`, a structured answer checked
  against `chartProposalSchema`), on the most capable model that answered,
  since it is a single call. It reads no files, writes nothing and runs no
  commands; its answer is a proposal the user ticks through
  (`modules/chart-of-accounts/suggest.ts` has the prompt).
- **Agent prompts** open on the most capable model that answered, in the
  agent's auto mode: the agent's own reviewer approves edits and commands, so
  the user isn't asked for each one. Every prompt opens with
  `PLAN_FIRST_RULE` (`src/frontend/agent-prompt-rules.ts`), which the
  AI-assisted panel puts on top of whatever it copies or hands off: the
  agent's first reply is the big idea in a sentence and a few short steps, and
  it touches nothing until the user says go.

With no agent installed, or none of its models answering, categorization
reports why and the import goes through uncategorized, and prompts can only be
copied.

`LLM_ENGINE=nuabase` is a deprecated override that categorizes on the Nuabase
gateway (`Nua.gateway`), paid for with `NUABASE_API_KEY`, all descriptions in
one call. The app never offers it, and a report of a run on it names no agent.
Any other `LLM_ENGINE` stops the server at startup.

Categorization failures don't fail an import: the transactions stay
uncategorized, and the import result and the Classify drafts screen say how
many descriptions weren't categorized and why (the `categorization` report,
which an import that created no drafts leaves out).

Calls on a local agent count against your plan's limits. Use one only on an
instance you run for yourself.

## Adding an API endpoint

Each endpoint is a trio:

1. **`src/shared/contracts/foo.ts`** — declare a ts-rest contract
   router (request/response schemas, path, method). One source of truth for
   the wire shape; re-export it from `src/shared/contracts/index.ts`
   (which `src/shared/index.ts` barrels through).
2. **`src/server/app/foo.ts`** — `api.register("foo", contract.foo, handler)`,
   default-exported. Mount it in `src/server/mount.ts`'s `loadDbu6App()` with
   `mountApi(api, fooApi)`; it's served under `/api`. A sub-app that needs
   something of the runtime (`runtime.ts`) default-exports a function of it
   instead, as the three that categorize take `runtime.loadCategorizer`. Keep
   the handler thin:
   it calls one workflow or module and translates the result to HTTP (see
   [Backend layering](#backend-layering)). It authorizes first:
   `requireWorkflowAuth(c)` (`app/workflow-auth.ts`), or `authorizeReport(c,
   name)` for a report, returns the `LedgerAuth` every store takes, and raw
   SQL reads the ledger through `allRows`/`oneRow` (`modules/ledger-sql`),
   whose `scoped_*` relations hold only that auth's rows. A workflow route
   calls `requireWorkflowLedger(c)` instead, for the `Ledger` a workflow takes:
   Drizzle, the SQLite connection and that auth. A route that doesn't touch
   the ledger calls `requireOwner(c)`.
3. **`src/frontend/api.ts`** — pass the contract to
   `createApiClient(contract, { baseUrl: getApiBase })`. Frontend code calls
   `fooApi.foo()` and gets a fully typed response or throws `ApiError`.

Because both sides import the same contract, request and response types cannot
drift. Change the contract once and both ends fail to typecheck until they
match. `src/shared/contracts/journals.ts` plus
`src/server/app/render-journals-hledger.ts` is a small example of the trio.

## Schema and migrations

Schema files live in `src/server/schema/`. Export both the raw Drizzle table
object and the Sapporta wrapper:

```ts
export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  name: text("name").notNull(),
});
export const accounts = table({
  drizzle: accountsTable,
  meta: { label: "Accounts" },
});
```

Change the schema, run Drizzle Kit generate, review the SQL, then
`dbu6 migrate` in a linked project (or just restart its `dbu6 dev`). The migrations are written to `migrations/` at
the repository root, which is where the package ships them; Drizzle Kit is only
a development dependency for generating them. `openDbu6` refuses to
serve a database with pending migrations and never applies one; `dev` and
`start` call `migrateSafely` before they open it.

Avoid migrations that drop and recreate a table. SQLite cascades the drop to
child rows. `pnpm db:migrate` applies in place and unverified, so point it
only at a scratch database you can lose, never at real books;
`dbu6 migrate` needs no copy, because it makes and verifies its own.

A user's database is migrated only by `migrateSafely`
(`src/server/migrate-safely.ts`): on a copy, one migration at a time, accepted
only while the ledger fingerprint (`src/server/ledger-fingerprint.ts`) stays
equal, and the copy takes the original's place only then. The fingerprint is
each account's id, parent and balance, the counts of journals and entries, a
hash over every entry, that every journal balances and the trial balance is
zero, and the same for drafts. Writing a migration therefore has two more
steps when it touches what the fingerprint reads:

- A migration that alters a table or column the fingerprint reads adds, in the
  same commit, a reader for the schema before it: today's reader moves into
  `READERS_BEFORE` under the migration's tag, and the fingerprint of a
  database picks its reader by the last migration applied to it.
- A migration that is meant to change ledger figures names the kinds it
  changes in `FIGURES_A_MIGRATION_CHANGES`, and only those figures are
  skipped in the comparison for that step.

Some moves need code: `0008_import_presets_from_file` turns
`user-config/import-presets.json` into `import_presets` rows. Such a
migration's SQL file is a marker (`SELECT 1;`, since an empty one fails;
`pnpm db:generate --custom --name …` makes it), and its code is a data step
in `src/server/data-migrations/`, registered in `DATA_STEPS` under the
migration's tag. `migrateSafely` runs the step on the copy right after the
SQL and compares the fingerprint after it, as after any migration. A step
writes with SQL of its own, against the schema its migration leaves, so a
later schema change can't change what it writes. It never refuses the
migration for what it can't convert: it leaves the project's files alone and
returns a note, which `dbu6 migrate` prints, and `dbu6 check` says what to do
next. A file whose contents it moved into the copy it deletes in
`afterCommit`, which runs only once the copy has taken the original's place,
so a rejected migration leaves both the database and the file as they were.

`ledger-fingerprint.test.ts` walks seeded books through every migration in
the repository, one at a time, and fails until both are right; the rejection
names the migration and the figures that differ, which is also what a user
sees. A migration a project has to act on beyond that gets an upgrade note
([Releasing](#releasing)).

Drizzle's schema doesn't know about triggers. `accounts` has two, from the
custom migration `0004_account_tree_rules.sql`, which keep `parent_id` in the
same workspace, user and account type and refuse loops. Dropping the table
drops them, so a migration that rebuilds `accounts` must create them again;
`schema/accounts.test.ts` migrates a fresh database and fails until it does.
Write further database-only rules the same way: `db:generate:custom`, then a
test against a migrated database. `drizzle-kit migrate` exits 1 without a
message when a statement fails; run the migration through drizzle-orm's
`migrate()` to see the error.

Accounts are named in plain words, such as `Dining Out`, never with their
parents' names in front. The tree comes only from `parent_id`, and each type
has one top account (`Assets`, `Liabilities`, `Equity`, `Income`,
`Expenses`) in the sample data. A name is unique in a user's books
(`accounts_name_unique`, from `0005_unique_account_names.sql`), because
mapping rules and the LLM name an account by it alone. Import presets name
an account by its id, so renaming one leaves them alone. The
hledger export builds each account's colon path, `Expenses:Food:Dining Out`,
from the tree (`hledgerAccountNames` in `modules/journal-plan/hledger.ts`).

## Email

This project uses Nodemailer. `src/server/mailer.ts` exports
`createSapportaMailer()`, which returns a small project mailer object containing
the raw Nodemailer `transport`, parsed defaults, and a `sendMail()` helper.
The runtime (`src/server/runtime.ts`) builds that mailer and carries it as
`runtime.mailer`, so a route that sends mail takes it from the runtime in
`loadDbu6App()` (`src/server/mount.ts`) without importing auth internals.

In development, `SAPPORTA_MAIL_TRANSPORT=stream` uses Nodemailer's stream
transport. Every call to `sendMail()` runs through Nodemailer's normal message
pipeline and logs the complete generated email source to the API console,
including Better Auth verification/reset messages and custom app messages.

In production, set `SAPPORTA_MAIL_TRANSPORT=smtp`, `SAPPORTA_MAIL_FROM`, and
either `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`.
Most providers, including SES, Postmark, Resend, SendGrid, Mailgun, and standard
mail hosts, publish SMTP settings. If you prefer a provider SDK, edit
`src/server/mailer.ts` directly.

## Statement parsers

Saved parsers for known bank layouts live in `custom-built-parsers/`. The
Import statements screen recognises uploads with them, by file extension and by
running each parser as an executable fingerprint. See
[custom-built-parsers/README.md](./custom-built-parsers/README.md) for the
Abacus JSON contract and
[custom-built-parsers/import-statement-parser-guide.md](./custom-built-parsers/import-statement-parser-guide.md)
for the workflow of having a coding agent build and register a new parser.

## Deployment

[DEPLOYMENT.md](./DEPLOYMENT.md) is written for a user's books folder: `.env`,
`dbu6 start`, the `Dockerfile` that `init` puts in the folder
(`template/Dockerfile`, which builds the image from the project, not from
this repository), upgrading, and the environment variables. This repository
has no Dockerfile of its own; the template's is unbuilt until Sapporta is
published, because an image installs dbu6 with `npm ci`.
