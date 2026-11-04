# dbu6

dbu6 is a self-hosted double-entry bookkeeping application for personal
finances. Your coding agent (Claude Code, Codex, or Pi) can import your bank
and credit card statements, convert the rows into balanced journal entries,
categorize transactions, and verify every statement against the balances
computed in your books before posting anything.

* **Import statements from any bank or card.** You can import PDF, Excel,
  CSV, or text statements from any date range and in any order. When dbu6
  cannot read a statement layout yet, your coding agent writes a parser for
  that layout so dbu6 can import future statements without the agent.
* **One plan and one round of questions.** The agent proposes a plan first
  and does not change anything until you approve it. After you approve the
  plan, the agent processes your statements and asks all of its remaining
  questions in a single message. It offers to turn your answers into rules
  so it does not ask the same questions again, and adds only the ones you
  agree to.
* **Categorized by your rules and your agent.** dbu6 applies your
  categorization rules first, and then your coding agent categorizes the
  remaining transactions using your existing AI subscription.
* **Checked against statement balances.** dbu6 rejects an import if the
  transaction rows do not add up to the balances printed on the statement,
  and no entries are posted to your books until the computed balances equal
  the statement balances.
* **Double-entry books with standard reports.** dbu6 includes reports for
  your trial balance, balance sheet, income statement, and net worth over
  time, and you can also write custom reports.
* **Local storage in a single folder.** dbu6 stores your data locally in one
  SQLite database with plain-text configuration files instead of a cloud
  service. When your agent processes statements, it sends them only to the
  AI model that it is configured to use.

## Requirements

You need Node.js 22.18 or newer with `npm` (`git` is optional). If you plan
to import statements, you also need `uv` and `pdftotext` (from poppler). You
can use a coding agent (Claude Code, Codex, or Pi) to do the bookkeeping. If
you do not use an agent, you can use the step-by-step screens in dbu6 to
import statement layouts that dbu6 already supports, and dbu6 will categorize
transactions using only your rules.

To use a coding agent with dbu6, you must install the
[Sapporta](https://github.com/jasim/sapporta) agent skill once per machine by
running the `npx skills add` command in
[Install dbu6](https://dbu6.com/docs/install/). The `sapporta` CLI that the
skill calls is included with dbu6, and you can run `npx dbu6 check` to
confirm that it is configured.

## Quick start

```sh
npm init @dbu6 my-books
cd my-books
npx dbu6 dev
```

`npm init @dbu6` creates the folder, installs dbu6, and initializes the
database. `npx dbu6 dev` starts the local web server so you can open
<http://localhost:2345> and sign up.

To import your statements with an agent, drop your statement files from any
bank, card, or date range onto **Let's set up your books**, and click **Add N
files to my books**. Your coding agent opens in a terminal and replies with a
plan, and it does not change anything until you approve that plan. After you
approve it, the agent sets up each bank and card account, imports and
categorizes the transactions, tailors the chart of accounts to your spending,
and resolves duplicates and failing balance checks. If the agent cannot
resolve an item from the statements, it asks you in one round of questions.
You can then post the entries to your books on the **Review** screen, or you
can ask the agent to post them. Once your books contain entries, dbu6 opens
on the **Overview** screen, which shows the current month's income, spending,
and savings, your net worth, and the date each account's books run until.

If you work without a coding agent, you can complete the same setup one
screen at a time to configure your chart of accounts, add a bank or card
account with its start date, upload statements, set opening balances, and
review the categorized entries.

When dbu6 hands a task to your agent, it writes an agent token to
`.env.agent` if the folder does not already have a valid one. To create a
token or check the agent's access yourself, run:

```sh
npx dbu6 agent env
npx sapporta api get /api/auth-context
```

`npx dbu6 agent env` writes a new token to the gitignored `.env.agent` file,
and `npx sapporta api get /api/auth-context` prints the user and workspace
associated with that token. `npx sapporta` runs the copy of the Sapporta CLI
bundled with dbu6, so you do not need to install a separate package.

See [Install dbu6](https://dbu6.com/docs/install/) for complete installation
instructions, everyday commands, and backup procedures.

## The packages

dbu6 is published on npm under the
[`dbu6` organization](https://www.npmjs.com/org/dbu6):

* [`@dbu6/app`](https://www.npmjs.com/package/@dbu6/app) contains the web
  application, the `dbu6` CLI, the statement parsers, and the documentation
  guides, and it is the only dependency in a books folder.
* [`@dbu6/create`](https://www.npmjs.com/package/@dbu6/create) is the
  initializer package that `npm init @dbu6` runs. It only runs `dbu6 init`
  from the matching version of `@dbu6/app`. To pin a version when creating a
  folder, run `npm init @dbu6@1.2.3 my-books`.

## Documentation

The documentation is available at <https://dbu6.com/docs/>:

* [What dbu6 does](https://dbu6.com/docs/) — what reports dbu6 provides and
  how statement imports work from start to finish.
* [Bookkeeping basics](https://dbu6.com/docs/bookkeeping-basics/) —
  definitions of the bookkeeping terms used in dbu6 for anyone new to
  double-entry accounting.
* [Install dbu6](https://dbu6.com/docs/install/) — a prompt you can give your
  coding agent to install dbu6, along with prerequisites, folder setup,
  starting the app, connecting the agent, and backups.
* [Set up your books with your coding agent](https://dbu6.com/docs/first-books/) —
  a message-by-message walkthrough of importing your first batch of
  statements and reviewing the resulting entries.
* [Keep your books up to date](https://dbu6.com/docs/keeping-up/) — how to
  import new statements each month.
* [Things to ask your agent](https://dbu6.com/docs/ask-your-agent/) —
  examples of asking your agent to finish reviewing entries, record cash,
  deposits, investments and loans, update categories, answer questions about
  your finances, and write new reports.
* [What your agent does on its own](https://dbu6.com/docs/agent-permissions/) —
  which actions are covered when you approve a plan, which actions require
  confirmation first, what the agent never changes, and what data is sent to
  your AI model.
* [Your books](https://dbu6.com/docs/your-books/) — how the books folder,
  accounts, and journal entries are structured, and which files you can edit
  directly.
* [Importing statements](https://dbu6.com/docs/statements/) — statement
  parsers, how your agent writes parsers for unsupported layouts, freeform
  transactions, and balance checks.
* [Categorization](https://dbu6.com/docs/categorization/) — how your mapping
  rules work and how your agent categorizes the remaining transactions.
* [Reports](https://dbu6.com/docs/reports/) — built-in reports, custom
  reports, and exporting your books to `hledger`.
* [Doing it by hand](https://dbu6.com/docs/by-hand/) — the step-by-step
  screens in the web app, for doing each step yourself instead of the agent
  run.

In this repository:

* [DBU6-BOOKS.md](https://github.com/jasim/dbu6/blob/main/DBU6-BOOKS.md) —
  the guide and CLI commands for coding agents working in a books folder.
* [DEPLOYMENT.md](https://github.com/jasim/dbu6/blob/main/DEPLOYMENT.md) —
  instructions for running dbu6 on a server.
* [DEVELOPMENT.md](https://github.com/jasim/dbu6/blob/main/DEVELOPMENT.md) —
  instructions for developing dbu6.

## License

[MIT](https://github.com/jasim/dbu6/blob/main/LICENSE)
