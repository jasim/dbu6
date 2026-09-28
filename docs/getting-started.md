# Getting started

This is the path from nothing to a working set of books. dbu6 keeps your books
in a folder of its own, with the `dbu6` program in that folder's
`node_modules`; you never clone or build anything.

## What you need

dbu6 runs on **Node.js 22.18 or newer**, with the `npm` that comes with it.

Statement imports also need:

* **uv** — runs the statement parsers, which are Python.
* **pdftotext** — reads PDF statements; it is part of poppler.

Two things are optional:

* **git** — with it, `init` makes your first commit.
* **A coding agent** — Claude Code, Codex or Pi. It categorizes transactions,
  proposes a chart of accounts, and writes a parser for a statement dbu6
  cannot read yet. Without one, imports still work and only your own mapping
  rules categorize. **Settings** names the agent dbu6 found and lets you
  switch.

```sh
# macOS
brew install node uv poppler

# Debian and Ubuntu
sudo apt install poppler-utils
curl -LsSf https://astral.sh/uv/install.sh | sh
# Node 22.18 or newer: https://nodejs.org/en/download, nvm, or NodeSource;
# a distribution's own nodejs package is usually older than that.
```

None of it is needed to make the folder or keep books by hand. Once you have a
folder, `npx dbu6 check` reports whichever are missing.

## Make the folder

```sh
npm init @dbu6 my-books
cd my-books
```

`npm init @dbu6` is npm's shorthand for running the `@dbu6/create` package,
which runs `dbu6 init` from the latest `@dbu6/app`; `npm init @dbu6@1.2.3`
uses that version instead. The folder must not exist yet, or must be empty.
`init` writes the project files, installs dbu6 (the `@dbu6/app` package) into
`node_modules`, creates `.env` with a generated auth
secret, fills `user-config/` from dbu6's examples, creates the database, and
makes the first commit. It touches nothing outside the folder.
[Your books](your-books.md) describes what it wrote.

## Serve it

```sh
npx dbu6 dev
```

`dev` migrates the database and serves the app. When it prints
`dbu6 API server ready (port 2345)`, open <http://localhost:2345> and sign up.
By default a new account needs no email verification, and any mail dbu6 sends
is printed in this terminal. Leave `dev` running while you use dbu6 and stop it
with Ctrl-C. `npx dbu6 start` is the same server for good, without the reload.

## Set up your books

Home shows the next thing to do, one at a time.

1. **Pick a chart of accounts.** Start from dbu6's starter chart, or describe
   your money in a sentence — "salaried in Bengaluru, rent, two children in
   school, a car loan, some freelance income" — and a coding agent proposes
   accounts that fit. Nothing is created until you accept.
2. **Add a bank or card.** On Home, or Settings → Banks and cards. Name the
   institution and which of your accounts its statements belong to.
3. **Import a recent statement for it.** Download one from your bank as a PDF,
   CSV or XLS and drop it on Import statements. dbu6 recognizes the layout,
   takes the account's starting balance from it, and shows you the rows it
   read. This is the step that tells dbu6 where your books start.
4. **Add your opening balances** (optional). What your cash, investments and
   loans held when the books start, so the balance sheet is true from day one.
5. **Review what it categorized, and add it to your books.** Home says when
   drafts are waiting. Review is where you reclassify what needs it, check for
   duplicates against earlier imports, see the balance checks, and post.
   Nothing reaches your books until you post.

Steps 3 and 5 are worth reading up on: [Importing
statements](statements.md) and [Categorization](categorization.md).

## Try it with sample data

```sh
npx dbu6 seed          # with dbu6 dev running
```

A year of sample personal finances for a demo account: the months up to now
are posted, and the current month is left as drafts to review. Sign in as
`demo@example.com` with `demo-password`. Running it again replaces that
account's data.

## Every day

```sh
npx dbu6 dev           # serve, with reload: what you use while setting up
npx dbu6 start         # serve for real, after a restart or a reboot
npx dbu6 upgrade       # move to a newer dbu6, then migrate and check
npx dbu6 check         # report everything an upgrade could have broken
npx dbu6 docs          # list the guides that ship with this version
```

In the folder, `npm run dev`, `npm start`, `npm run check` and
`npm run upgrade` do the same.

## Coding agents

dbu6 hands prompts to a coding agent — to categorize what your rules did not,
to propose a chart of accounts, or to write a parser for a statement it cannot
read. Two things make such a prompt work: the skill below, installed once for
the agents on this machine, and the CLI, which arrives in the folder with dbu6.

**The Sapporta skill.** dbu6 applications are built on
[Sapporta](https://sapporta.com), and the skill teaches an agent how to work in
one. Install it once, for the agents on this machine:

```sh
npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
```

**The Sapporta CLI**, which the agent uses to read and change your books
through dbu6's HTTP API. Nothing to install: dbu6 ships it, so in this folder
`npx sapporta …` works, and it finds the app's address and the agent's token by
itself. Mint that token after your first sign-up:

```sh
npx dbu6 agent env
npx sapporta api get /api/auth-context
```

`agent env` writes `.env.agent` (gitignored; never commit it) with a token for
the account you signed up with, and revokes the token its previous run wrote.
It reads the project's database directly, so it needs no server; the second
command does, and proves the token works by naming the user and workspace it
acts as. If the project holds more than one account, say which one:
`npx dbu6 agent env --user you@example.com`.

An agent given a prompt does this for itself; the two commands are here so that
you can check its access before it starts, and
[DBU6-BOOKS.md](https://github.com/jasim/dbu6/blob/main/DBU6-BOOKS.md) is the
guide it reads next.

## Back up your books

`data/` holds your books. dbu6 keeps no other copy and makes no backup. Stop
dbu6, then copy the whole `data/` folder.

`user-config/` is not inside `data/`; it sits beside it, in the project root.
It holds your mapping rules and your custom categorization instructions, and
belongs in git.

## Where to next

* [Your books](your-books.md) — the folder, its accounts and journal entries.
* [Importing statements](statements.md) — parsers, and statements dbu6 cannot read.
* [Categorization](categorization.md) — mapping rules, and the LLM.
* [Reports](reports.md) — what ships, and reports of your own.
* [DBU6-BOOKS.md](https://github.com/jasim/dbu6/blob/main/DBU6-BOOKS.md) —
  the guide a coding agent reads: every common job and the call that does it.
* [DEPLOYMENT.md](https://github.com/jasim/dbu6/blob/main/DEPLOYMENT.md) —
  running your books on a server.
