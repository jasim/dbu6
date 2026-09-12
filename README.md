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

### Double-entry books

Every transaction is a journal entry between two accounts,
for example `assets:bank:hdfc` and `expenses:grocery`. It follows GAAP approach
and provides standard accounting reports like trial balance, balance
sheet, account ledger and so on. It also has reports tuned for personal
financial management like: net worth over time, monthly cashflow etc.

### Statement parsers for any bank

You can add parsers for any bank / credit card using the custom-built-parsers
approach.

The directory `custom-built-parsers/` holds deterministic parsers for statement
layouts
that have already been handled. This currently several Indian banks and cards in
PDF, CSV, and XLS form. The Import statements screen recognises which one
matches each upload and which of your accounts it belongs to.

For a layout that has no parser yet, you can ask the coding agent to write a
parser for it. There is clear guide in the repo that lets the coding agent
create an accurate parser in a single shot. See
[custom-built-parsers/README.md](./custom-built-parsers/README.md) and
[custom-built-parsers/import-statement-parser-guide.md](./custom-built-parsers/import-statement-parser-guide.md).

Transactions that no parser reads, in whatever form you have them (text copied
from a PDF or a web page, HTML, CSV, or a list you typed), go through the Import
freeform transactions screen. It gives you a prompt for your coding agent, which turns the
transactions into a statement, asks you for the opening and closing balances,
and imports them into Drafts. See
[custom-built-parsers/freeform-transactions-guide.md](./custom-built-parsers/freeform-transactions-guide.md).

### Automatic categorization

Each imported transaction is assigned an account in two passes.

1. Your own rules in `transaction_mappings.mjs`. Exact matches on the
   narration win outright. Substring rules are checked in order and can be
   limited to withdrawals or deposits.
2. Anything the rules miss goes to an LLM together with your account list and
   your written instructions on how to categorize. If the LLM is not
   confident, it leaves the entry blank for you.

The sample instructions are in
[user-config.example/custom_mappings_default.prompt](./user-config.example/custom_mappings_default.prompt).
Different banks and cards can use different instruction files, configured in
`import-presets.json`.

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
file. Account names follow hledger conventions, so the export drops into an
existing hledger setup.

## What you configure

Everything specific to you lives under `data/`, which is gitignored:

```
data/
  sqlite.db
  user-config/
    transaction_mappings.mjs     narration → account rules, applied before the LLM
    hledger_accounts.prompt      the account list handed to the LLM
    custom_mappings_*.prompt     your categorization instructions for the LLM
    import-presets.json          your banks and cards, and which parser and prompts each uses
```

`pnpm setup` seeds `data/user-config/` from `user-config.example/` and never
overwrites files you have edited. A rule file looks like this:

```js
export const mappings = {
    exact: {"ACME SUPERMARKET": "expenses:grocery"},
    includes: [
        {account: "expenses:fuel", direction: "withdrawal", values: ["FUELS"]},
    ],
};
```

## Running it

Requirements:

- Node 22 or newer and pnpm.
- A Nuabase API key in `NUABASE_API_KEY`, for LLM-backed categorization.
- `pdftotext` (from poppler) if you import PDF statements.

```bash
pnpm install
pnpm dev
```

This starts the API and the web UI in watch mode. Open the frontend port
configured in `mise.toml` in your browser. For a production build, run
`pnpm build` then `pnpm start`, or use the included `Dockerfile`.

dbu6 currently depends on locally linked checkouts of the Sapporta and
Nuabase packages. See [DEVELOPMENT.md](./DEVELOPMENT.md) for what that means
and for the full setup.

## More

- [DEVELOPMENT.md](./DEVELOPMENT.md): commands, ports, environment, project
  layout, and how to extend the code.
- [DEPLOYMENT.md](./DEPLOYMENT.md): supported deployment shapes and their
  environment variables.
