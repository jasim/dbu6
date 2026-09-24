# Moving your books from a clone of dbu6 into a project folder

dbu6 used to run from a clone of its repository, with the books in its
`data/` and your own parsers, reports and fixes committed beside dbu6's code.
dbu6 is now an npm package, and your books live in a folder of their own that
depends on it. This guide, for a person or a coding agent, moves you from the
first to the second.

What moves, and where to:

| In the clone | In the new project |
| --- | --- |
| `data/sqlite.db` (or `$SAPPORTA_DATA_DIR/sqlite.db`) | `data/sqlite.db` |
| `data/user-config/*` | `user-config/*` |
| `.env.development`, `.env.production`, `mise.toml` | `.env`, a few values only (step 5) |
| a parser you added under `custom-built-parsers/` | `custom-built-parsers/<name>/` |
| a bundled parser you changed | `custom-built-parsers/<name>/`, shadowing ours |
| a report, route, page or categorizer you added | `reports/<id>/`, `dbu6.config.ts`, `frontend.tsx` |
| a change to dbu6's own code | nowhere: dropped, sent upstream, or kept in a fork (step 7) |

Nothing in the clone is changed or deleted, apart from fetching dbu6's history
into its `.git` in step 1. Deleting the clone is for you, the person, to
decide at the end.

## For a coding agent

- Do step 1 and show the person its inventory. Do nothing else until they say
  go.
- Never change, move or delete anything in the clone, and never write to its
  database. The only database you write to is the new project's, in step 4.
- Commands below use `$OLD` for the clone, `$DATA` for the clone's data
  directory, `$NEW` for the new project and `$BASE` for the commit found in
  step 1. Write the real values into each command; shell variables do not
  survive between your commands.
- Stop and ask the person at every **Stop** below.

## Before you start

- Node 22.18 or newer, git, `uv`, and `pdftotext` (poppler), the same tools
  the clone needed.
- dbu6 published on npm: `npm view dbu6 version` prints a version.
- The old app stopped. Quit its `pnpm dev` (or stop its container) and leave it
  stopped until step 8. A running server can still be writing to the database
  you are about to copy.
- A shell without the clone's settings. The environment wins over a
  project's `.env`, so a `SAPPORTA_DATA_DIR` exported by the clone's mise or
  your shell profile would point `init` and `migrate` at the clone's
  database. `env | grep -E '^(SAPPORTA_|DBU6_|BETTER_AUTH_)'` must print
  nothing; if it does, unset them at their source and open a new shell (a
  coding agent asks the person to restart it from one).

## 1. Take an inventory of the clone

**Where the books are.** The data directory is `$OLD/data` unless
`SAPPORTA_DATA_DIR` (`DBU6_DATA_DIR` in clones from before 13 September 2026)
names another; a relative value is relative to `$OLD`.

```bash
grep -H -E 'SAPPORTA_DATA_DIR|DBU6_DATA_DIR' "$OLD"/.env.development "$OLD"/mise*.toml "$OLD"/.mise*.toml 2>/dev/null
```

If the clone ran in a container, the books are in its `/app/data` volume:
with the container stopped, `docker cp <container>:/app/data <new folder>`
and use that folder as `$DATA`.

Check that `$DATA/sqlite.db` exists and that `$DATA/user-config/` holds your
`transaction_mappings.mjs`, `import-presets.json` and `*.prompt` files (and
`settings.json` if you chose a coding agent in Settings).

**How far the clone is from dbu6.** Find the last dbu6 commit the clone has:

```bash
cd "$OLD"
git fetch https://github.com/jasim/dbu6.git main
git merge-base HEAD FETCH_HEAD
```

The hash it prints is `$BASE`, the dbu6 you were running. Your changes are the
difference from it, not from today's dbu6, which moved every file. List them:

```bash
git log --oneline "$BASE"..HEAD           # your commits
git diff --stat "$BASE"                   # every tracked file you changed, committed or not
git ls-files --others --exclude-standard  # files you added and never committed
git stash list; git branch                # work on other branches or in a stash is not in the above
```

**Which parsers are yours.** The parsers dbu6 shipped at `$BASE`:

```bash
git ls-tree -d --name-only "$BASE" custom-built-parsers/ | sed 's#.*/##'
```

Every directory in `$OLD/custom-built-parsers/` other than `shared/` is one of:

- **Yours**: not in that list. It moves as it is (step 6).
- **Bundled, unchanged**: in the list, and `git diff --quiet "$BASE" --
  custom-built-parsers/<name>` exits 0. It stays behind; dbu6 ships it.
- **Bundled, changed by you**: in the list, and that diff is not empty.
  Decided in step 6.

`shared/` is decided in step 6 if `git diff "$BASE" --
custom-built-parsers/shared` is not empty.

**Everything else you changed.** Sort each remaining path into the rows of
step 7's table.

**Stop.** Show the person: the database path, the files in
`$DATA/user-config/`, your commits, and every changed path with its kind or
row. If any path is a schema or migration change (step 7), say so now: the
move cannot go ahead as written.

## 2. Create the new project

Pick a folder that does not exist yet, beside the clone rather than inside it:

```bash
npx dbu6@latest init "$NEW"
```

`init` writes the template, runs `npm install`, creates `.env` with a new
auth secret, fills `user-config/` with dbu6's examples, creates an empty
database at `$NEW/data/sqlite.db`, and makes the first commit. It ends by
printing `Your books are in $NEW.` Do not start the app yet.

From here on, run commands in `$NEW`.

## 3. Check the clone's database has only dbu6's migrations

A fork that added its own migration has tables and a migration history dbu6
does not know, and dbu6 will not serve such a database. Check before copying:

```bash
node -e '
const db = new (require("better-sqlite3"))(process.argv[1], { readonly: true, fileMustExist: true });
const known = new Set(require("./node_modules/dbu6/migrations/meta/_journal.json").entries.map((e) => String(e.when)));
const applied = db.prepare("select created_at from __drizzle_migrations").all().map((r) => String(r.created_at));
const unknown = applied.filter((when) => !known.has(when));
console.log(`${applied.length} applied, ${unknown.length} unknown`, unknown);
' "$DATA/sqlite.db"
```

You should see `0 unknown`. Any other count is a migration of your own:
**Stop**, and see the schema row of step 7.

Record what the books hold now, to compare after the move:

```bash
node -e '
const db = new (require("better-sqlite3"))(process.argv[1], { readonly: true, fileMustExist: true });
const one = (sql) => db.prepare(sql).pluck().get();
console.log({
  users: one("select count(*) from user"),
  accounts: one("select count(*) from accounts"),
  journals: one("select count(*) from journals"),
  journal_entries: one("select count(*) from journal_entries"),
  draft_transactions: one("select count(*) from draft_transactions"),
  debits: one("select round(total(debit), 2) from journal_entries"),
  credits: one("select round(total(credit), 2) from journal_entries"),
});
' "$DATA/sqlite.db"
```

Keep the output; step 8 prints the same figures from the new database.

## 4. Move the books

`init`'s database is empty. Confirm it, then replace its contents with the
clone's, through SQLite's backup API: a consistent copy that includes
anything still in the clone's `sqlite.db-wal`. Never copy the file with `cp`.

```bash
ls data/                                   # sqlite.db only; no sqlite.db-wal, no dbu6.lock
node -e '
const Database = require("better-sqlite3");
const target = new Database("data/sqlite.db", { fileMustExist: true });
const users = target.prepare("select count(*) from user").pluck().get();
target.close();
if (users !== 0) { console.error(`data/sqlite.db has ${users} user(s); it is not the empty database init made. Stopping.`); process.exit(1); }
const source = new Database(process.argv[1], { readonly: true, fileMustExist: true });
source.backup("data/sqlite.db").then(() => { source.close(); console.log("Copied."); });
' "$DATA/sqlite.db"
npx dbu6 migrate
```

`dbu6 migrate` applies the migrations dbu6 has added since `$BASE` to a copy,
checks the ledger's figures are unchanged, and only then puts the copy in
place. If it reports a failure, the database is left as the backup wrote it;
**Stop** and show the person its output.

## 5. Move the configuration

Copy your `user-config/` over the examples `init` put there:

```bash
cp -R "$DATA"/user-config/. user-config/
```

dbu6 no longer reads `user-config/import-presets.json`; step 8 converts it
into the app's import presets. The conversion takes a parser by its directory
name alone (`"hdfc-cc-xls"`) and refuses a path
(`"custom-built-parsers/hdfc-cc-xls/parser.py"`), so rewrite the paths first:

```bash
node -e '
const fs = require("fs"), file = "user-config/import-presets.json";
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/"custom-built-parsers\/([^/"]+)\/parser\.py"/g, "\"$1\""));
'
```

**Environment.** `.env` is already complete for this machine, and serves the
app and its API on one port, `2345`. Do not copy the clone's env files over
it. Carry over only these, if the clone set them in `.env.development`,
`.env.production` or `mise.toml`:

- `SAPPORTA_MAIL_TRANSPORT`, `SAPPORTA_MAIL_FROM` and the `SMTP_*` values.
- `LLM_ENGINE` and `NUABASE_API_KEY`, if you used the Nuabase gateway.
- For a deployment: its `SAPPORTA_PUBLIC_APP_URL` and `SAPPORTA_API_PORT`, in
  the deployment's environment.

Everything else, `SAPPORTA_DATA_DIR` and the clone's ports and URLs included,
stays behind. The new `BETTER_AUTH_SECRET` only means you sign in again, with
the same email and password. Put secrets in `.env`, which is gitignored.

## 6. Move your parsers

For each directory from step 1:

- **Yours**: copy it whole, tests and fixtures included:
  `cp -R "$OLD/custom-built-parsers/<name>" custom-built-parsers/`.
- **Bundled, unchanged**: nothing to do.
- **Bundled, changed by you**: first compare your copy with the one dbu6
  ships now, `node_modules/dbu6/custom-built-parsers/<name>/` (shipped
  without its tests and fixtures). If dbu6's now handles what your change was
  for, leave yours behind. Otherwise copy your whole directory as above; it
  shadows the bundled one, and `dbu6 check` names it on every upgrade.
- **`shared/`**: a project cannot replace it; parsers always import dbu6's
  `shared` package. Move what you added into the parser that uses it, as a
  module beside its `parser.py` (`import mine` finds `mine.py` in the same
  directory), and drop the change to `shared/`. If it changed how existing
  helpers behave, ask for the change in dbu6 (step 7).

Never put a parser under `node_modules/dbu6`. Your fixtures are now in your
own project and may hold real statement data; that matters only if you share
or push the project.

## 7. Move, send upstream, or drop every other change

A project can add to dbu6 but cannot change it: a route, report, page or
navigation entry with the name of one of dbu6's is an error, not a
replacement. Sort each path from step 1:

| Changed in the clone | What to do |
| --- | --- |
| A report: files under `packages/api/app/reports/`, a report screen or definition under `packages/frontend/src/` | Rewrite it as `reports/<id>/`. Guide: `npx dbu6 docs reports`. |
| The categorizer: `packages/api/modules/categorization/` | The `loadCategorizer` seam in `dbu6.config.ts`. Guide: `npx dbu6 docs customizing`. |
| A new server route | `dbu6.config.ts`. Guide: `npx dbu6 docs customizing`. |
| A new page or navigation entry | `frontend.tsx`. Guide: `npx dbu6 docs customizing`. |
| A script that reads or changes the books | Rewrite it against the HTTP API, in your project (for example `scripts/`). Guide: `npx dbu6 docs books`. |
| A migration or schema change: `packages/api/migrations/`, `packages/api/schema/` | **Stop.** A project cannot have tables of its own yet. Keep running the clone, and ask for the change in dbu6 or keep a fork. |
| Any other change to dbu6's code: a fix, or different behaviour in an existing screen or route | Check whether today's dbu6 already does it. If not, open an issue or pull request on dbu6, or keep a fork. It is not carried into the project. |
| `user-config.example/`, `README.md`, `DEVELOPMENT.md`, dbu6's `AGENTS.md` | Drop. A note of your own about your books can go in `$NEW/AGENTS.md`, which is yours. |
| `package.json`, `pnpm-lock.yaml` | Drop, unless code you moved above needs the dependency: `npm install <package>` in `$NEW`. |
| `Dockerfile`, `.env.*.example`, deployment files | Start from `$NEW/Dockerfile` and dbu6's `DEPLOYMENT.md`. `user-config/` is no longer inside the `data/` volume: the image copies it from the project. |

A fork is outside this guide; say so to the person before starting one. Its
commits rebase onto dbu6's `main` with the files moved:
`packages/api/migrations` to `migrations`, the rest of `packages/api` to
`src/server`, `packages/frontend/src` to `src/frontend`, and
`packages/shared/src` to `src/shared`.

## 8. Convert the import presets, and verify

Start the app:

```bash
npx dbu6 dev
```

Open http://localhost:2345 and sign in with the account you used in the clone.

Import presets are now kept in the app, one row per institution. Convert
`user-config/import-presets.json` into them through the API, with an agent
access token as `npx dbu6 docs books` describes under "Reaching the app":

```bash
npx sapporta api post /api/import-presets/import-json --body '{"apply":false}'
```

This proposes the institutions and changes nothing. **Stop.** Show the person
the proposal and its `warnings`. With their yes:

```bash
npx sapporta api post /api/import-presets/import-json --body '{"apply":true}'
```

It writes the presets, reads them back and deletes the file. If it refuses,
the file is kept; the "Import presets" section of `npx dbu6 docs books` says
what each refusal means.

```bash
npx dbu6 check
```

It runs your parsers' tests, reads `user-config/` and checks the import
presets, among others. Every line should be `ok` or `info`; a failed line
comes with the tool's output.

Print step 3's figures from the new database, running the same command with
`data/sqlite.db` in place of `"$DATA/sqlite.db"`. Every figure should equal
the one you recorded.

Check that the Accounts page, the Balance sheet and your latest journals look
as they did, and import a statement you have imported before: the importer
should find its parser and its preset (it will then tell you the rows are
already in the books, or start where they end).

## 9. Commit, and retire the clone

```bash
git status --short          # no data/, no .env, no tmp/
git add -A
git commit -m "Move my books from the dbu6 clone"
```

From now on you upgrade with `npx dbu6 upgrade`, never by pulling dbu6's
repository.

The clone still holds a full copy of your books in `$DATA`, and possibly real
statements in `$OLD/tmp/`.
Once you have used the new project for a while and trust it, delete them
yourself. A coding agent never deletes them.
