# dbu6

Self-hosted double-entry bookkeeping for personal finances. Point it at your
bank and credit card statements and it works through them: the rows become
balanced journal entries, transactions are categorized, and every statement is
checked against the balances your books compute before anything is posted.

* **Statements in, journal entries out.** Bank and credit card statements in
  PDF, CSV and XLS are read by parsers.
* **Categorized by an LLM on your own machine.** Your rules run first; Claude
  Code, Codex or Pi handles the rest.
* **Checked on every import.** A statement's balances are compared with the
  books. A mismatch stops the import.
* **Double-entry books with standard reports.** Trial balance, balance sheet,
  income statement, net worth over time, and reports of your own.
* **A folder you own.** One SQLite database, plain-text configuration, no cloud.

## Requirements

Node.js 22.18 or newer, with `npm`. Statement imports also need `uv` and
`pdftotext` (from poppler). git and a coding agent (Claude Code, Codex or Pi)
are optional. A coding agent needs the
[Sapporta](https://github.com/jasim/sapporta) agent skill, installed once per
machine by the `npx skills add` line in [Getting
started](https://github.com/jasim/dbu6/blob/main/docs/getting-started.md); the
`sapporta` command that skill's work runs through comes in the project with
dbu6, and `npx dbu6 check` confirms it is wired up.

## Quick start

```sh
npm init @dbu6 my-books
cd my-books
npx dbu6 dev
```

`npm init @dbu6` creates the folder, installs dbu6 into it and makes the
database. `dev` serves the app: open <http://localhost:2345> and sign up. Home then takes you
through your chart of accounts, a bank or card, a recent statement for it, your
opening balances, and reviewing what dbu6 categorized.

A coding agent works in the folder when it is asked to. Give it access before
handing it a prompt:

```sh
npx dbu6 agent env
npx sapporta api get /api/auth-context
```

`agent env` mints a token into the gitignored `.env.agent`, and the second
command answers with the user and workspace it acts as. `npx sapporta …` is
dbu6's own copy of the Sapporta CLI — there is nothing else to install.

[Getting started](https://github.com/jasim/dbu6/blob/main/docs/getting-started.md)
has each step in full, the sample data, everyday commands and backups.

## The packages

dbu6 is published on npm by the [`dbu6` organization](https://www.npmjs.com/org/dbu6):

* [`@dbu6/app`](https://www.npmjs.com/package/@dbu6/app) is dbu6 itself: the
  app, the `dbu6` command, the parsers and the guides. It is the one
  dependency of a books folder.
* [`@dbu6/create`](https://www.npmjs.com/package/@dbu6/create) is what `npm
  init @dbu6` runs. It holds no code of its own beyond running `dbu6 init`
  from the `@dbu6/app` of the same version, so `npm init @dbu6@1.2.3` makes a
  folder on dbu6 1.2.3.

## Documentation

* [Getting started](https://github.com/jasim/dbu6/blob/main/docs/getting-started.md) —
  install, the first run, the setup steps, everyday commands, backups.
* [Your books](https://github.com/jasim/dbu6/blob/main/docs/your-books.md) —
  the folder, its accounts and journal entries, and what is yours to change.
* [Importing statements](https://github.com/jasim/dbu6/blob/main/docs/statements.md) —
  parsers, layouts dbu6 cannot read, freeform transactions, balance checks.
* [Categorization](https://github.com/jasim/dbu6/blob/main/docs/categorization.md) —
  your mapping rules and the LLM that handles the rest.
* [Reports](https://github.com/jasim/dbu6/blob/main/docs/reports.md) — the
  reports that ship, reports of your own, and the hledger export.
* [DBU6-BOOKS.md](https://github.com/jasim/dbu6/blob/main/DBU6-BOOKS.md) —
  the guide a coding agent reads, and the commands it runs.
* [DEPLOYMENT.md](https://github.com/jasim/dbu6/blob/main/DEPLOYMENT.md) —
  running your books on a server.
* [DEVELOPMENT.md](https://github.com/jasim/dbu6/blob/main/DEVELOPMENT.md) —
  working on dbu6 itself.

## License

[MIT](https://github.com/jasim/dbu6/blob/main/LICENSE)
