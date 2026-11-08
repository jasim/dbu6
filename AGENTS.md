# AGENTS.md

Guidance for AI agents and contributors. See also
[CODING-PRINCIPLES.md](CODING-PRINCIPLES.md), [DEVELOPMENT.md](DEVELOPMENT.md),
[custom-built-parsers/README.md](custom-built-parsers/README.md).

## Sapporta skill and CLI

dbu6 is a [Sapporta](https://github.com/jasim/sapporta) application. Work on it
needs the `sapporta` agent skill. If it is not available to you, install it (or
ask the user to) before making changes:

```bash
npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
```

Load it for any change to the schema, API, auth, or UI.

The `sapporta` command is part of this package: `bin/sapporta.mjs` is declared
as a bin, beside `dbu6`, and forwards to the `@sapporta/server` CLI this dbu6
depends on. In a project that installed dbu6, run it as `npx sapporta …`, which
runs that bin. Here, where dbu6 is the root package and a package manager links
a package's dependencies into it but never its own bins, `npx sapporta` reaches
`@sapporta/server`'s own bin instead, which is the same CLI. The CLI finds a
running app by itself, from `SAPPORTA_API_PORT` in the environment or else in
the project's `.env.development`, the same rule dbu6 binds by, and its token
from `--api-token`, `SAPPORTA_API_TOKEN`, or else the project's `.env.agent`;
the wrapper adds nothing.

The Sapporta documentation lists the variables that the server, the frontend
build and the CLI read, in
[Environment variables](https://sapporta.com/docs/reference/project/environment-variables).
[DEPLOYMENT.md](DEPLOYMENT.md) describes how dbu6 uses them. Some defaults are
different in dbu6, for example `SAPPORTA_DATA_DIR` has no default in Sapporta
and defaults to `data/` in dbu6.

The project's own token is in the gitignored `.env.agent`, written by
`dbu6 agent env` (`src/cli/agent.ts`) and, when the folder has no working
token, by the app as it hands a prompt to the coding agent
(`src/server/modules/coding-agent/agent-access.ts`); the prompts dbu6 hands a person's
agent name that command and the CLI rather than installation steps, and
`dbu6 check` reports the bin, the project's link to it, and whether
`.env.agent` holds a token the app accepts. The Sapporta skill is the agent's own and lives on the
machine, not in the project: the agent installs it when it is missing, as
`template/AGENTS.md` tells it to. `dbu6 check` does not look for it.

## This repository is the package

The tracked tree is the source of the `@dbu6/app` npm package; a person's books
live in a folder made by `npm init @dbu6`, with dbu6 in `node_modules`. This
checkout is not such a folder and holds no books: `pnpm dev` here only keeps
`dist/` compiled, and the app runs in a project folder beside it, such as
`../demo-dbu6`, whose `node_modules/@dbu6/app` links here
([DEVELOPMENT.md](DEVELOPMENT.md)). What a project may import is
`src/server/index.ts` and `src/frontend/index.ts`, and nothing is added to
either by accident. Guides, prompts and `template/AGENTS.md` are read from an
installed package, so they name guides by `npx dbu6 docs <name>`, never by a
path in this repository.

## Agent-native workflows

The person's coding agent runs the workflow, and the screens are for when
the person asks for them. Before you design, audit or review a workflow,
screen, agent prompt, playbook or guide, read
[AGENT-NATIVE.md](AGENT-NATIVE.md): the idea, how a run works today, and the
internals that decide a design.

## Immediate UI feedback

dbu6 should feel like a DOS program: every hover, click and keypress shows
its result at once. Add no transitions, animations, fades or delays
(`transition-*`, `duration-*`, `animate-*`, delayed tooltips) unless the
owner asks for one. A loading indicator for real work is fine; easing a
hover background in is not.

Lay values out to be scanned, not read: a date, amount or count goes in its
own aligned column under a label, not in a sentence such as "Imported until
19 Oct 2026". Keep prose for messages that need explaining.

## Working with the books

To answer questions about the user's accounts, review or post drafts, or fix
entries in a running dbu6, read [DBU6-BOOKS.md](DBU6-BOOKS.md) first. It maps
each common job to its endpoint, table or query, so skip OpenAPI discovery for
those and use the Sapporta skill for the rest.

## No personally identifying information (PII)

Tests, fixtures, documentation, comments, and code must never contain PII:
names, account/card/customer/reference numbers, phone numbers, emails,
addresses, or real amounts. This matters most in `custom-built-parsers/`,
which are built against real bank statements.

Anonymize as follows:

- **Amounts** — rounded whole numbers (`1000`, `2500`), never copied from a
  real statement.
- **Numbers and numeric strings** — include the marker `050505`, preferably
  at the start: `050505000012`, `0505055555`.
- **Text** — use `sample` or `NOPII` for the stripped parts:
  `NOPII CUSTOMER NAME`, `UPI-sample-payee-050505`, `sample@example.com`.
- **Structure** — keep the real input's columns, headers, delimiters,
  encoding, and quirks so the parser is exercised faithfully; only values
  change. Prefer generating fixtures from a script (see `generate_fixture.py`).

Before committing, run `pnpm pii-scan` (the rules above as code, over the
tracked tree; CI runs it too) and read the diff for names or narrations not
based on `sample` / `NOPII`.
Real statements never enter the tracked tree. An upload the importer could
not read is staged under `tmp/statement-uploads/`, which is gitignored and is
where an import prompt points you: read the statement there, and copy nothing
from it into a tracked file.
