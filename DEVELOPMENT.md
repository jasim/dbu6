# Development

Technical reference for working on dbu6. For what the project is and how to
use it, see [README.md](./README.md). For production deployment, see
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Prerequisites

- Node 22+ and pnpm 11 (the version is pinned in `package.json`).
- `mise` is optional. Everything the app needs has a working default in
  `.env.development`; `mise.toml` only pins the Node version and holds personal
  settings such as `NUABASE_API_KEY`. Copy `mise.toml.example` to `mise.toml` if
  you want it.
- For automatic categorization and the Open in terminal buttons, Claude Code or
  Codex installed and logged in on this machine. See [LLM engine](#llm-engine).
- `pdftotext` (poppler) for PDF imports.
- `uv`, which runs the saved statement parsers. The Standard Chartered PDF
  parser also needs the `extract-table-from-pdf.py` script, whose path is
  hardcoded to `~/m/a/code/tools/pdf-extract/` in
  `custom-built-parsers/stanc-bank-pdf-table/parser.py`.

### Sapporta packages

The `@sapporta/*` packages and `nuabase` come from the npm registry at the
versions pinned in each `package.json`, so `pnpm install` needs nothing beside
this repository. That is the committed state, and the one to commit.

To work on the framework itself, clone Sapporta, run `pnpm install && pnpm build`
there, and point this project at it with
`pnpm package-sources use:local /absolute/path/to/sapporta`; `pnpm package-sources
use:npm` switches back and `pnpm package-sources status` says which is active.
While linked, rebuild Sapporta's `dist` after changing it and before typechecking
dbu6, or you will see stale type errors.

## Commands

- `pnpm dev` — start backend and frontend in watch mode. Runs `pnpm setup`
  and a clean first.
- `pnpm setup` — bring a checkout to a runnable state: create
  `.env.development` from `.env.development.example` with a generated
  `BETTER_AUTH_SECRET`, seed `data/user-config/` from `user-config.example/`,
  and apply pending migrations. Every step is idempotent and leaves an existing
  file alone, so `pnpm dev` can run it on every start.
- `pnpm seed [YYYY-MM-DD]` — with `pnpm dev` running, create
  `demo@example.com` (password `demo-password`) holding a year of sample
  personal finances up to today, or up to the given date. The twelve months
  before that month are posted journals, and that month so far is HDFC savings
  drafts. Re-running replaces the demo account's ledger.
- `pnpm build` — typecheck, compile shared + backend (`tsc`), and bundle the
  frontend (`vite build`).
- `pnpm start` — run the production server (serves API and SPA on one port).
- `pnpm typecheck`, `pnpm test`, `pnpm test:watch`, `pnpm format`.
- `node scripts/move-files.mjs … [--dry-run]` — move code inside
  `packages/api` (paths relative to it) and rewrite every relative import of
  it. Each form merges imports that end up naming one module twice, formats
  the edited files, and reports the TypeScript errors left in them;
  `--dry-run` prints the edits and those errors without making them.
  Afterwards it lists text that still names what moved, such as
  `layering.test.ts`'s table, the docs and the agent prompts; update those by
  hand.
  - `<from> <to> [<from> <to> …]` moves files or folders with `git mv`, and
    rewrites every `vi.mock` path too. It also lists tests left beside a moved
    file.
  - `--symbols <file> <name>[,<name>…] <to>` moves top-level declarations
    into another file, created if it doesn't exist, with TypeScript's "Move to
    file" refactor.
  - `--through <folder>` makes every file outside the folder import its files
    through its `index.ts`.
- `pnpm --filter ./packages/api db:generate --name add_table` — generate
  Drizzle SQL migrations from schema changes.
- `pnpm --filter ./packages/api db:migrate` — apply pending migrations.

## Ports and environment

The whole development environment lives in `.env.development`, which `pnpm dev`
and every `pnpm db:*` script load with Node's built-in `--env-file` support.
That ignored file is created from `.env.development.example` by `pnpm setup`,
which also fills in `BETTER_AUTH_SECRET`. It holds the dev ports and the URLs
derived from them, the data directory, and local-only auth and mail defaults —
`SAPPORTA_MAIL_TRANSPORT=stream` among them, so Nodemailer prints the full
generated email source to the API console instead of delivering it.

A value already in the environment wins over one from an env file, so a
`mise.toml` entry or a plain shell export overrides any of these without
editing the file. That is what makes mise optional here rather than required.

`SAPPORTA_DATA_DIR` in `.env.development` names the directory that holds
`sqlite.db` and `user-config/`: an absolute path, or a path relative to the
project root. It has no default. `pnpm dev`, `pnpm setup`, and every
`pnpm --filter ./packages/api db:*` script load that file, so all of them open
the same database. Point it somewhere else to keep, say, sample data apart from
real data.

### Running multiple Sapporta projects on one machine

Each backend binds to `SAPPORTA_API_PORT` and each Vite dev server binds to
`SAPPORTA_FRONTEND_PORT` — `2345` and `2340` here, `3000` and `5173` when
neither is set. To run several projects side-by-side, give each its own stable
port pair, either by editing its `.env.development`:

```sh
SAPPORTA_FRONTEND_PORT=2341
SAPPORTA_API_PORT=2346
SAPPORTA_PUBLIC_APP_URL=http://localhost:2341
SAPPORTA_API_URL=http://localhost:2346
```

or by overriding the same four variables from `mise.toml`, which
`mise.toml.example` shows commented out. `packages/frontend/vite.config.ts` points its `/api` proxy at the API
port and binds Vite to the frontend port. The API trusts the derived public app
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
packages/api/            backend — schema/, modules/, workflows/, app/ (see Backend layering)
packages/frontend/       SPA — Vite + React, imports @sapporta/frontend and @sapporta/ui CSS
packages/shared/         ts-rest contracts + types shared by backend and frontend
custom-built-parsers/    saved Python parsers for known statement layouts
user-config.example/     tracked template for the private user config
data/                    gitignored — the SQLite database and user config
scripts/                 dev runner, first-run setup, sample data, dist cleanup
```

### Backend layering

`packages/api` is layered in tiers. A file imports only from its own module, from
a lower tier, or from a same-tier module it sits above, so each tier can be
built, tested and understood without anything above it. Lowest first:

| Tier | Where | Modules | Owns | Must not contain |
| --- | --- | --- | --- | --- |
| 0 | `schema/`, `user-data.ts`, `modules/ledger-sql/` | schema, user-data, ledger-sql | Tables; config paths; row scoping for raw SQL, built from Sapporta's `rowSecurity`, and the auth type every store takes | Domain queries; a hand-written workspace/user filter |
| 1 | `modules/values/` | values | Money and its direction, amounts in paise, Account, Chrono, the text normalization transaction identity uses | I/O, statements, ledger tables |
| 2 | `modules/statement/` | statement | Statement rows and documents (Abacus): parsing, ordering, running balances, joining a multi-part upload, and the statement's own errors | HTTP status, wire payloads, checkpoints, upload or request advice |
| 3 | `modules/` | transaction-identity, categorization, gpay, journal-plan, statement-sources | Transaction keys and matchers; mapping rules, the prompt, the LLM interface, and turning an answer into a ledger account id, the same-account rule included; the Google Pay Takeout index and enrichment; transaction groups, the journal plan and the one hledger formatter; saved parsers, import presets and the auto-import plan | Database access, coding-agent names, route concepts |
| 4 | `modules/` | accounts < journals < reconciliation < drafts; coding-agent | Accounts as the stores and screens look them up; posted journals, writing them from a plan, and the last reconciled checkpoint; matching against stored drafts and journals, running balances, the balance-check rule, the since-checkpoint filter; draft rows: saving, placing balance assertions, loading, reclassifying, clearing once posted, status. The coding agent: detection, models, handoff, settings, and at its top the engine categorization runs on | Workflow sequencing, report columns; ledger concepts anywhere in coding-agent but its top file |
| 5 | `workflows/` | statement-import, posting, reclassification | The domain workflows, where the action happens: they sequence module calls and make the domain decisions | SQL, text formatting, HTTP; imports of each other |
| 6 | `app/`, `app.ts`, `boot.ts` | app | Routes, reports (rendering only), error translation, uploads, auth guards, the Home and Review views, hosting | Queries or rules another module needs |

- Only tier 4 orders its modules (accounts < journals < reconciliation <
  drafts). Tier 3 modules never import each other, and neither do workflows: a
  step two of them need moves down into a module.
- A module that declares entry files is imported only through them.
- A route authorizes, calls one workflow (or a module, for a plain read), and
  translates the result and the errors to HTTP.
- A module's errors carry domain fields only: no HTTP status, wire body or
  advice. `workflows/statement-import/refusals.ts` lists the errors that end an
  import, and `app/import-error-response.ts` alone turns them into a status
  and a `statementImportErrorSchema` body, hints included.
- Tests live with the module they test and follow the same rules.
- Sapporta's guide puts larger workflows in `packages/api/modules/<domain>/`.
  dbu6 keeps them in `workflows/`, a tier of their own, on purpose; don't move
  them into `modules/`.

`packages/api/layering.test.ts` enforces this. Its table says which module
every file belongs to, so a new file needs a place in it, and the imports that
break the rules today are listed there with the [PLAN.md](./PLAN.md) task that
removes them. That list only shrinks.

Every file is in its tier ([PLAN.md](./PLAN.md) reshapes what remains). Each
module in `modules/<name>/` is imported through its `index.ts`: `ledger-sql`,
`values`, `statement`; in tier 3 `transaction-identity`, `categorization`,
`gpay`, `journal-plan` and `statement-sources`; and in tier 4 `accounts`,
`journals`, `reconciliation`, `drafts` and `coding-agent`. Tests also import
`ledger-sql/testing.ts`, whose `testLedgerAuth` is a request's auth over the
ledger's tables. The workflows are
`workflows/statement-import/` (one account's statement, the automatic batch,
and freeform transactions; imported through its `index.ts`),
`workflows/posting.ts` and `workflows/reclassification.ts`.

`packages/shared/` is a workspace package (`dbu6-shared`). Both
`packages/api/` and `packages/frontend/src/` depend on it; it depends on
neither. See [`packages/shared/CLAUDE.md`](./packages/shared/CLAUDE.md) for
what belongs there.

## User data

Everything specific to the user lives in `SAPPORTA_DATA_DIR` (`data/` in
development, gitignored as a unit; `/app/data` in the Docker image, which
declares it as its volume). Backend code resolves these paths through
`packages/api/user-data.ts` (`userConfigDir()`, `userConfigPath()`), which
builds on `dataPath()` from `@sapporta/server`. Don't hardcode them.

### transaction_mappings.mjs

Deterministic rules, applied before the LLM is consulted. The file is pure
data; the matching engine is
`packages/api/modules/categorization/mapping-rules.ts`.

`loadCategorizer` (`categorization/load-categorizer.ts`) reads this file and the
prompt files once for each import or reclassification; it is the only code that
reads them. `categorize` (`categorization/categorize.ts`) applies what it read:
the rules, then the LLM for the rest, then the ledger account each answer names
by its exact name in Accounts. A name the ledger doesn't hold, or the
statement's own account, leaves the row uncategorized. A file that is missing
or broken refuses only once a row needs it, so an import with nothing new
needs no config.

Narrations are normalized before matching (NFKC, whitespace collapsed, trimmed,
upper-cased). `exact` wins outright; `includes` are substring rules checked in
declaration order, so put narrow patterns ahead of broad ones. `direction` is
optional and limits a rule to `"withdrawal"` or `"deposit"`.

### LLM prompts

The categorization prompt template is in
`packages/api/modules/categorization/prompt-template.ts`. It is filled
with `hledger_accounts.prompt` and the `custom_mappings_*.prompt` files named
by the matching entry in `import-presets.json`, which `loadCategorizer` reads.
`categorization/llm-categorization.ts` is the only LLM call site. It says what
categorization needs of an LLM (`CategorizationLlm`), sends the descriptions
the mapping rules didn't categorize, and reports how the calls fared; which
engine fills that need is `packages/api/modules/coding-agent/`'s business. A
failed call's error arrives fit to show: `coding-agent/nuabase.ts` logs the
full message and shortens what it returns (`reportedError`).

### LLM engine

dbu6 uses one coding agent for everything AI: Claude Code (`claude`) or Codex
(`codex`), installed and logged in on the machine running the server. It is
chosen on the **Settings** screen; until then dbu6 uses the first installed,
Claude Code first. The choice is saved in `data/user-config/settings.json`, and
the agent's executable must be on the server's `PATH`.

Everything the server does with an agent is in
`packages/api/modules/coding-agent/`, which the rest of the backend imports
through its `index.ts`:

| Module | What it holds |
| --- | --- |
| `agents.ts` | `CODING_AGENT_RUN`: each agent's models, most capable first, and its auto-mode options. Detection, the saved choice, and which agent is active. |
| `models.ts` | Which of an agent's models answer on this machine, and when to ask again. |
| `nuabase.ts` | The only import of `nuabase`; every call into it and every value out of it. |
| `categorization-llm.ts` | The engine categorization runs on: the agent, or the deprecated gateway. |
| `handoff.ts`, `launcher.ts` | Starting an agent on a prompt in a terminal. |
| `errors.ts` | Why the server refused, as the routes state it. |
| `settings.ts` | What the Settings screen reads and changes. |

The screens' side of an agent — its name, how to sign in — is
`codingAgentSchema` and `CODING_AGENTS` in `dbu6-shared`. Adding an agent is an
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
- **Agent prompts** open on the most capable model that answered, in the
  agent's auto mode: the agent's own reviewer approves edits and commands, so
  the user isn't asked for each one. Every prompt opens with
  `PLAN_FIRST_RULE` (`packages/frontend/src/agent-prompt-rules.ts`), which the
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

1. **`packages/shared/src/contracts/foo.ts`** — declare a ts-rest contract
   router (request/response schemas, path, method). One source of truth for
   the wire shape; re-export it from `packages/shared/src/contracts/index.ts`
   (which `packages/shared/src/index.ts` barrels through).
2. **`packages/api/app/foo.ts`** — `api.register("foo", contract.foo, handler)`,
   default-exported. Mount it in `packages/api/app.ts`'s `loadApp()` with
   `app.route("/", fooApi)`; it's served under `/api`. Keep the handler thin:
   it calls one workflow or module and translates the result to HTTP (see
   [Backend layering](#backend-layering)). It authorizes first:
   `requireWorkflowAuth(c)` (`app/workflow-auth.ts`), or `authorizeReport(c,
   name)` for a report, returns the `LedgerAuth` every store takes, and raw
   SQL reads the ledger through `allRows`/`oneRow` (`modules/ledger-sql`),
   whose `scoped_*` relations hold only that auth's rows. A route that
   doesn't touch the ledger calls `requireOwner(c)`.
3. **`packages/frontend/src/api.ts`** — pass the contract to
   `createApiClient(contract, { baseUrl: getApiBase })`. Frontend code calls
   `fooApi.foo()` and gets a fully typed response or throws `ApiError`.

Because both sides import the same contract, request and response types cannot
drift. Change the contract once and both ends fail to typecheck until they
match. `packages/shared/src/contracts/journals.ts` plus
`packages/api/app/render-journals-hledger.ts` is a small example of the trio.

## Schema and migrations

Schema files live in `packages/api/schema/`. Export both the raw Drizzle table
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

Change the schema, run Drizzle Kit generate, review the SQL, run Drizzle Kit
migrate, then start the server. The server checks migration readiness at boot
but never applies migrations.

Avoid migrations that drop and recreate a table. SQLite cascades the drop to
child rows. Back up `data/sqlite.db` before running a migration you have not
run before.

Drizzle's schema doesn't know about triggers. `accounts` has two, from the
custom migration `0004_account_tree_rules.sql`, which keep `parent_id` in the
same workspace, user and account type and refuse loops. Dropping the table
drops them, so a migration that rebuilds `accounts` must create them again;
`schema/accounts.test.ts` migrates a fresh database and fails until it does.
Write further database-only rules the same way: `db:generate:custom`, then a
test against a migrated database. `drizzle-kit migrate` exits 1 without a
message when a statement fails; run the migration through drizzle-orm's
`migrate()` to see the error.

## Email

This project uses Nodemailer. `packages/api/mailer.ts` exports
`createSapportaMailer()`, which returns a small project mailer object containing
the raw Nodemailer `transport`, parsed defaults, and a `sendMail()` helper.
`packages/api/app.ts` receives that mailer in `loadApp()` options, so routes can
use it directly or pass it into domain modules without importing auth internals.

In development, `SAPPORTA_MAIL_TRANSPORT=stream` uses Nodemailer's stream
transport. Every call to `sendMail()` runs through Nodemailer's normal message
pipeline and logs the complete generated email source to the API console,
including Better Auth verification/reset messages and custom app messages.

In production, set `SAPPORTA_MAIL_TRANSPORT=smtp`, `SAPPORTA_MAIL_FROM`, and
either `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`.
Most providers, including SES, Postmark, Resend, SendGrid, Mailgun, and standard
mail hosts, publish SMTP settings. If you prefer a provider SDK, edit
`packages/api/mailer.ts` directly.

## Statement parsers

Saved parsers for known bank layouts live in `custom-built-parsers/`. The
Import statements screen recognises uploads with them, by file extension and by
running each parser as an executable fingerprint. See
[custom-built-parsers/README.md](./custom-built-parsers/README.md) for the
Abacus JSON contract and
[custom-built-parsers/import-statement-parser-guide.md](./custom-built-parsers/import-statement-parser-guide.md)
for the workflow of having a coding agent build and register a new parser.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the three supported deployment shapes
(single process, reverse proxy, split topology with CDN + separate API host)
and the env vars each one needs. The `Dockerfile` implements the single-process
shape and runs migrations before boot.
