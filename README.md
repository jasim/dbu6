# dbu6

dbu6 is a self-hosted double-entry bookkeeping application for personal
finances. It can take you from a pile of statements to ordered financial data,
with a workflow fine-tuned for LLM assisted categorization.

* It turns bank and credit card statements into balanced journal entries.
* All transactions are automatically categorized using LLMs.
* Account balances from statements are reconciled against the computed balance,
  ensuring data integrity.
* Reports: monthly net income/expense, balance sheet, accounts statement,
  search, and so on.

dbu6 can be operated through coding agents (
see [Sapporta](https://github.com/jasim/sapporta) for details). All tables and
APIs are exposed to the LLM, and so you can ask any question or update data
purely agentically. It can be as complex and advanced as the most recent LLM
models support.

The user interface is a series of connected data-grids that lets you explore,
drill-down and see related data easily.

## Quick start

You need Node 22 or newer, plus `uv` and `pdftotext` (from poppler) for the
statement parsers.

```bash
npx dbu6 init my-books
cd my-books
npx dbu6 dev
```

`init` makes the folder, installs dbu6 into it, creates `.env` with a
generated secret, fills `user-config/` from the examples, creates the database,
and makes the first commit. Open http://localhost:2345 and sign up. Home then
takes you through setting up: pick the accounts your books start with (or
describe your money and have your coding agent propose them), add the banks
and cards you get statements from, show dbu6 a sample statement of each, and
record what each account held when you start. For a year of sample data, run
`npx dbu6 seed` while `dev` is running and sign in as `demo@example.com` /
`demo-password`.

The folder is yours; the program is the `dbu6` package in `node_modules`.
`npx dbu6 upgrade` moves it to a newer version, migrating the database on a
verified copy, and `npx dbu6 check` reports anything an upgrade broke.
Nothing in the folder refers to dbu6's code until you add a report.

```
my-books/
  package.json            one dependency: dbu6, pinned to an exact version
  tsconfig.json           so your reports typecheck under `dbu6 check`
  AGENTS.md               how a coding agent works in this folder
  Dockerfile              the folder as a container, when you want one
  user-config/            mapping rules, categorization prompts
  custom-built-parsers/   your parsers for statements dbu6 cannot read yet
  reports/                your reports, one folder each, with their own screens
  data/                   sqlite.db, gitignored; back it up yourself
  .env                    ports, mail, the auth secret; gitignored
  dbu6.config.ts          optional: a categorizer of your own, extra routes
  frontend.tsx            optional: extra pages and navigation entries
```

Install the Sapporta skill for your coding agent, and let it read
`npx dbu6 docs` for the guides that ship with the installed version:

```bash
npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
```

### Double-entry books

Every transaction is a journal entry between two accounts,
for example `HDFC Bank` and `Groceries`. Accounts are named in plain words and
nest under one another: `Assets` holds `Bank`, which holds `HDFC Bank`, and
`Expenses` holds `Food`, which holds `Dining Out`. Each name is unique in your
books, so mapping rules refer to an account by its name
alone. It follows GAAP approach
and provides standard accounting reports like trial balance, balance
sheet, account ledger and so on. It also has reports tuned for personal
financial management like: net worth over time, monthly cashflow etc.

### Statement parsers for any bank

dbu6 ships deterministic parsers for statement layouts that have already been
handled: several Indian banks and cards in PDF, CSV, and XLS form
([custom-built-parsers/](./custom-built-parsers/)). The Import statements
screen recognises which one matches each upload and which of your accounts it
belongs to. A parser of your own goes in your folder's
`custom-built-parsers/`, and shadows a bundled one of the same name.

For a layout that has no parser yet, ask your coding agent to write one. The
guide that ships with dbu6 (`npx dbu6 docs parser-guide`) lets the agent
create an accurate parser in a single shot, and the Import statements screen
gives you the prompt: copy it, or, when Claude Code or Codex is installed on
the machine running dbu6, click **Open in Claude Code** (or **Codex**,
whichever Settings names) to start the agent on it in a new terminal window,
in your books folder. (On Linux the button gives you a command to run in a
terminal instead.) Every prompt asks the agent to show you its steps first
and to do nothing until you say go. The guides are
[custom-built-parsers/README.md](./custom-built-parsers/README.md) and
[custom-built-parsers/import-statement-parser-guide.md](./custom-built-parsers/import-statement-parser-guide.md).

Transactions that no parser reads, in whatever form you have them (text copied
from a PDF or a web page, HTML, CSV, or a list you typed), go through the Import
freeform transactions screen. It gives you a prompt for your coding agent, which turns the
transactions into a statement, asks you for the opening and closing balances,
and imports them into Drafts. Copy the prompt, or open it in your coding agent
from the same screen, and paste the transactions when you say go. See
[custom-built-parsers/freeform-transactions-guide.md](./custom-built-parsers/freeform-transactions-guide.md).

### Automatic categorization

Each imported transaction is assigned an account in two passes.

1. Your own rules in `transaction_mappings.mjs`. Exact matches on the
   narration win outright. Substring rules are checked in order and can be
   limited to withdrawals or deposits.
2. Anything the rules miss goes to an LLM together with your accounts (all but
   Equity, from the Accounts table) and your written instructions on how to
   categorize. If the LLM is not confident, it leaves the entry blank for you.

The LLM is the coding agent on your own machine, Claude Code or Codex, logged
in with your own plan. dbu6 finds whichever is installed; **Settings** shows
which one it uses and lets you switch. Without one, nothing is categorized
automatically. If the LLM can't be reached, the import still goes through and
says how many descriptions were left uncategorized, and why. See
[DEVELOPMENT.md](./DEVELOPMENT.md#llm-engine).

The sample instructions are in
[user-config.example/custom_mappings_default.prompt](./user-config.example/custom_mappings_default.prompt).
Different banks and cards can use different instruction files, listed in
their import presets, which dbu6 keeps in the database and your coding agent
changes for you (`npx dbu6 docs books`).

### Reconciliation on every import

Before a statement is accepted, dbu6 looks up the last posted entry and
balance for that account and works out where the new statement should start.
It then checks the statement's balances against what the books compute from
the imported rows. A mismatch stops the import.

For bank statements with a running balance, every row is checked. For credit
card statements, which usually have no per-row balance, the opening and
closing balances of the statement are used instead.

Imported rows are held as drafts. You reclassify what needs it, check for
duplicates against earlier imports, confirm the balance checks pass, and post.
Nothing reaches the books until you post.

### hledger export

Posted journals can be rendered as an [hledger](https://hledger.org) journal
file. Each account is written as its path through the account tree, such as
`Expenses:Food:Dining Out`, so the export drops into an existing hledger
setup.

## What you configure

Everything specific to you lives in your books folder. The database is
gitignored; the rest is worth committing, and `init` makes the first commit:

```
data/
  sqlite.db                    the books, and the import presets: your banks and cards,
                               which parser reads each and which prompts it uses;
                               dbu6 keeps no other copy
user-config/
  transaction_mappings.mjs     narration → account rules, applied before the LLM
  custom_mappings_*.prompt     your categorization instructions for the LLM
```

`init` fills `user-config/` from dbu6's examples (`npx dbu6 setup` does it
again for a file that is missing, and never overwrites one you have edited).
A rule file looks like this:

```js
export const mappings = {
    exact: {"ACME SUPERMARKET": "Groceries"},
    includes: [
        {account: "Fuel", direction: "withdrawal", values: ["FUELS"]},
    ],
};
```

## Reports of your own

A report is code in `reports/<id>/`, written the way dbu6's own reports are:
a route that computes it and a React screen that shows it, with full control
of the screen. dbu6 finds the folder, lists the report under "Your reports"
and typechecks and tests it under `npx dbu6 check`. The Reports page has
**Create a report**, which hands your coding agent the prompt; the guide is
`npx dbu6 docs reports`, with one complete worked report. Pages and routes
that are not reports go in `frontend.tsx` and `dbu6.config.ts`
(`npx dbu6 docs customizing`).

## More

- [docs/migrating-from-a-clone.md](./docs/migrating-from-a-clone.md): if you
  ran dbu6 from a clone of this repository, how to move your books, config,
  parsers and changes into a project folder (`npx dbu6 docs from-clone`).
- [DEPLOYMENT.md](./DEPLOYMENT.md): running your books folder for real:
  `.env`, `dbu6 start`, the Dockerfile, upgrading, and why you back up
  `data/` yourself.
- [DEVELOPMENT.md](./DEVELOPMENT.md): this repository is the source of the
  `dbu6` package; how to work on it, from a clone.

## License

[MIT](./LICENSE)
