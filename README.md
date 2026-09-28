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
are optional. [Getting started](https://github.com/jasim/dbu6/blob/main/docs/getting-started.md)
has the install commands for each.

## Quick start

```sh
npx dbu6 init my-books
cd my-books
npx dbu6 dev
```

`init` creates the folder, installs dbu6 into it and makes the database. `dev`
serves the app: open <http://localhost:2345> and sign up. Home then takes you
through your chart of accounts, a bank or card, a recent statement for it, your
opening balances, and reviewing what dbu6 categorized.

[Getting started](https://github.com/jasim/dbu6/blob/main/docs/getting-started.md)
has each step in full, the sample data, everyday commands and backups.

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
* [DEPLOYMENT.md](https://github.com/jasim/dbu6/blob/main/DEPLOYMENT.md) —
  running your books on a server.
* [DEVELOPMENT.md](https://github.com/jasim/dbu6/blob/main/DEVELOPMENT.md) —
  working on dbu6 itself.

## License

[MIT](https://github.com/jasim/dbu6/blob/main/LICENSE)
