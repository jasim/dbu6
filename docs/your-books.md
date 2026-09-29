# Your books

A books folder from the inside: what `dbu6 init` wrote, how the books are kept,
and what is yours to change.

## The folder

```
my-books/
  package.json            one dependency: @dbu6/app, pinned to an exact version
  package-lock.json       what that installed
  tsconfig.json           so your reports typecheck under `dbu6 check`
  AGENTS.md               how a coding agent works in this folder
  Dockerfile              the folder as a container, when you want one
  .dockerignore
  sapporta.json           the project's name
  .env.development.example  the defaults `dbu6 setup` copies to .env.development
  .env.development        ports, mail, the auth secret; gitignored
  .env.agent              the agent's token; gitignored, written by `dbu6 agent env`
  user-config/            mapping rules and categorization prompts
  data/sqlite.db          the books; gitignored, back it up yourself
```

Two folders appear when you use them: `custom-built-parsers/` for parsers of
your own ([Importing statements](statements.md)), and `reports/` for reports of
your own ([Reports](reports.md)). Two files appear when you want them:
`dbu6.config.ts`, for a categorizer of your own and server routes that are not
reports, and `frontend.tsx`, for pages and navigation entries of your own
(`npx dbu6 docs customizing`).

The program is the `@dbu6/app` package in `node_modules`; the folder is yours.
Nothing in it refers to dbu6's code until you add a report or a `frontend.tsx`.
Never edit anything under `node_modules/@dbu6/app`: an install or an upgrade
replaces it.

## Accounts and journal entries

Every transaction is a journal entry between two accounts, for example
`HDFC Bank` and `Groceries`. Accounts are named in plain words and nest under
one another: `Assets` holds `Bank`, which holds `HDFC Bank`, and `Expenses`
holds `Food`, which holds `Dining Out`. Each name is unique in your books, so
mapping rules refer to an account by its name alone.

It follows the GAAP approach, with standard accounting reports like trial
balance, balance sheet and account ledger, alongside reports tuned for personal
finance such as net worth over time and monthly cashflow.

## What you configure

Everything specific to you lives in the folder. `data/` is gitignored, and the
rest is worth committing:

```
user-config/
  transaction_mappings.mjs     narration → account rules, applied before the LLM
  custom_mappings_*.prompt     your categorization instructions for the LLM
```

`init` fills `user-config/` from dbu6's examples; `npx dbu6 setup` does it again
for a file that is missing, and never overwrites one you have edited. Both
kinds of file are explained in [Categorization](categorization.md).

The import presets — which parser reads each bank's statements, and which
prompts each account uses — are kept in the database rather than a file, and
your coding agent changes them through the API (`npx dbu6 docs books`).

## Upgrading

`npx dbu6 upgrade` moves the package to a newer version, migrating the database
on a verified copy, and then runs `npx dbu6 check`. `dbu6 start` and
`dbu6 migrate` also migrate when something is pending; nothing else does, and
no other tool may change the database's schema.

`npx dbu6 check` reports everything an upgrade can break: the tools it needs,
pending migrations, your reports' types and tests, your parsers' tests, and
`user-config/`. Fix what it reports.

## Working with a coding agent

dbu6 is a [Sapporta](https://sapporta.com) application, and a coding agent
works in this folder through `AGENTS.md` and the guides the installed package
ships. The skill is installed once:

```sh
npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
```

The `sapporta` command the agent uses for your books comes with dbu6, so there
is nothing else to install. It needs a token, and one command mints it for the
folder:

```sh
npx dbu6 agent env
npx sapporta api get /api/auth-context
```

The first writes `.env.agent` — a credential, gitignored, one token per folder —
and the second names the user and workspace it acts as. An agent given a prompt
runs the first itself when it has to.

`npx dbu6 docs` lists the guides, and each one is written for the version you
have installed. The import screens and the Reports page hand your agent a
prompt for the job at hand.
