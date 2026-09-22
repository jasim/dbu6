# AGENTS.md

This folder is a person's books, kept with dbu6.
The program is the `dbu6` package in `node_modules`; everything else here is
theirs: `user-config/`, `custom-built-parsers/`, `reports/`, and the ledger in
`data/sqlite.db`.

## Before you start

- dbu6 is a [Sapporta](https://sapporta.com) application. Install the Sapporta
  skill if you do not have it:

  ```bash
  npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
  ```

- Read `npx dbu6 docs books` before you read or change the ledger. It maps each
  common job to its endpoint. `npx dbu6 docs` lists every guide; each is the
  one written for the installed version.

## Rules

- Never edit anything under `node_modules/dbu6`. An install or an upgrade
  replaces it.
- Never copy, move or delete `data/sqlite.db`, and never open it with a tool
  that writes. It is the only copy of the books, and dbu6 makes no backup.
  Change the books through the HTTP API.
- Never commit `data/` or `.env`.
- Upgrade with `npx dbu6 upgrade`, then fix everything `npx dbu6 check`
  reports. Only dbu6 migrates the database (`upgrade`, `start` and `migrate`
  do it, on a verified copy); never run SQL that changes its schema.

## Changing what dbu6 does

Use the first of these that does the job. The first three need no wiring: a
file in the right folder is found.

1. **Configure.** Edit `user-config/`: the mapping rules, the import presets
   and the categorization prompt. Each file explains itself.
2. **Write a parser** for a statement dbu6 cannot read, in
   `custom-built-parsers/<name>/`. Guides: `parser-guide`, then `parsers`.
   For transactions that are not a statement: `freeform-guide`.
3. **Write a report** in `reports/<id>/`, with its own route and screen.
   Guide: `reports`.
4. **Ask through the API.** A one-off question or a bulk fix goes through the
   HTTP API and leaves no code behind. Guide: `books`.
5. **`dbu6.config.ts`**, for a named seam (the categorizer) or server routes
   that are not reports. Guide: `customizing`.
6. **`frontend.tsx`**, for pages and navigation entries that are not reports.
   Guide: `customizing`.
7. **Fork dbu6**, for anything deeper. Say so to the person first.

Everything in 3, 5 and 6 adds to dbu6. A route, report id, page or navigation
entry that dbu6 already has is an error, not a replacement.

After any change to a parser, a report, `dbu6.config.ts` or `frontend.tsx`, run
`npx dbu6 check`. It typechecks the project's TypeScript, runs each report's
and parser's tests, builds the web app, and reads `user-config/` the way dbu6
does; every failing line comes with the tool's output, and nothing is changed.
