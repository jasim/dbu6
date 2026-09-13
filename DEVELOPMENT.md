# Development

Technical reference for working on dbu6. For what the project is and how to
use it, see [README.md](./README.md). For production deployment, see
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Prerequisites

- Node 22+ and pnpm 11 (the version is pinned in `package.json`).
- `mise` is optional but recommended; `mise.toml` holds the dev ports and
  derived URLs. Copy `mise.toml.example` to `mise.toml` to start.
- `NUABASE_API_KEY` set in the environment. All LLM calls go through Nuabase.
- `pdftotext` (poppler) for PDF imports.
- `uv`, which runs the saved statement parsers. The Standard Chartered PDF
  parser also needs the `extract-table-from-pdf.py` script, whose path is
  hardcoded to `~/m/a/code/tools/pdf-extract/` in
  `custom-built-parsers/stanc-bank-pdf-table/parser.py`.

### Linked dependencies

The `@sapporta/*` packages in `packages/api`, `packages/frontend`, and
`packages/shared` are `link:` dependencies pointing at a sibling checkout of
the Sapporta repo, and `nuabase` is a `file:` dependency on a local Nuabase
client checkout. `pnpm install` expects both to exist at the paths in the
package manifests. After changing Sapporta, rebuild its `dist` before
typechecking dbu6, or you will see stale type errors.

## Commands

- `pnpm dev` — start backend and frontend in watch mode. Runs `pnpm setup`
  and a clean first.
- `pnpm setup` — seed `data/user-config/` from `user-config.example/` without
  overwriting edited files.
- `pnpm build` — typecheck, compile shared + backend (`tsc`), and bundle the
  frontend (`vite build`).
- `pnpm start` — run the production server (serves API and SPA on one port).
- `pnpm typecheck`, `pnpm test`, `pnpm test:watch`, `pnpm format`.
- `pnpm --filter ./packages/api db:generate --name add_table` — generate
  Drizzle SQL migrations from schema changes.
- `pnpm --filter ./packages/api db:migrate` — apply pending migrations.

## Ports and environment

Development ports and their derived URLs live in `mise.toml`. With the mise
shell hook active, run `pnpm dev`; otherwise run `mise exec -- pnpm dev`.

`pnpm dev` also loads `.env.development` with Node's built-in `--env-file`
support. That ignored file contains local-only auth and mail defaults, including
a generated `BETTER_AUTH_SECRET` and `SAPPORTA_MAIL_TRANSPORT=stream`, so
Nodemailer prints the full generated email source to the API console instead of
delivering it.

`SAPPORTA_DATA_DIR` in `.env.development` names the directory that holds
`sqlite.db` and `user-config/`: an absolute path, or a path relative to the
project root. It has no default. `pnpm dev`, `pnpm setup`, and every
`pnpm --filter ./packages/api db:*` script load that file, so all of them open
the same database. Point it somewhere else to keep, say, sample data apart from
real data.

### Running multiple Sapporta projects on one machine

Each backend binds to `SAPPORTA_API_PORT` (default `3000`) and each Vite dev
server binds to `SAPPORTA_FRONTEND_PORT` (default `5173`). To run several
projects side-by-side, give each its own stable port pair in `mise.toml`:

```toml
[vars]
frontend_port = 5174
api_port = 3001
```

The `mise.toml` env templates derive `SAPPORTA_API_PORT`,
`SAPPORTA_FRONTEND_PORT`, `SAPPORTA_PUBLIC_APP_URL`, and `SAPPORTA_API_URL` from
that pair. `packages/frontend/vite.config.ts` points its `/api` proxy at the API
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
packages/api/            backend — boot.ts, app.ts, schema/, app/, bank-importer/, modules/
packages/frontend/       SPA — Vite + React, imports @sapporta/frontend and @sapporta/ui CSS
packages/shared/         ts-rest contracts + types shared by backend and frontend
custom-built-parsers/    saved Python parsers for known statement layouts
user-config.example/     tracked template for the private user config
data/                    gitignored — the SQLite database and user config
scripts/                 dev runner, user-config seeding, dist cleanup
```

Inside `packages/api`:

- `app/` — ts-rest route handlers: statement import, draft categorization,
  posting drafts, hledger rendering, and `app/reports/` for each report.
- `bank-importer/` — the import pipeline. `statement-recognition.ts` runs the
  saved parsers under `custom-built-parsers/` to turn uploads into Abacus
  statements (`parsers/` holds their tests), `abacus/` assembles statements and
  reconciles running balances, `statement-import.ts` validates one account's
  statement and hands the new rows to the drafts tail, `categorization/` holds
  the rule engine and the LLM classifier, and `domain/` holds the value types
  (Money, Account, Chrono, JournalPlan, and so on).
- `modules/` — journals (hledger formatting), reconciliation (duplicate
  detection, running balances, transaction identity), draft-transactions.
- `schema/` — Drizzle tables for accounts, draft journals, and journals.

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
`packages/api/bank-importer/categorization/mapping-rules.ts`.

Narrations are normalized before matching (NFKC, whitespace collapsed, trimmed,
upper-cased). `exact` wins outright; `includes` are substring rules checked in
declaration order, so put narrow patterns ahead of broad ones. `direction` is
optional and limits a rule to `"withdrawal"` or `"deposit"`.

### LLM prompts

The categorization prompt template is in
`packages/api/bank-importer/categorization/prompt-template.ts`. It is filled
with `hledger_accounts.prompt` and the `custom_mappings_*.prompt` files named
by the matching entry in `import-presets.json`.
`categorization/llm-categorization.ts` is the only LLM call site; every call
goes through Nuabase (`Nua.gateway` → `nua.list`).

## Adding an API endpoint

Each endpoint is a trio:

1. **`packages/shared/src/contracts/foo.ts`** — declare a ts-rest contract
   router (request/response schemas, path, method). One source of truth for
   the wire shape; re-export it from `packages/shared/src/contracts/index.ts`
   (which `packages/shared/src/index.ts` barrels through).
2. **`packages/api/app/foo.ts`** — `api.register("foo", contract.foo, handler)`,
   default-exported. Mount it in `packages/api/app.ts`'s `loadApp()` with
   `app.route("/", fooApi)`; it's served under `/api`.
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
