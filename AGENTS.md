# AGENTS.md

Guidance for AI agents and contributors. See also
[CODING-PRINCIPLES.md](CODING-PRINCIPLES.md), [DEVELOPMENT.md](DEVELOPMENT.md),
[custom-built-parsers/README.md](custom-built-parsers/README.md).

## Sapporta skill

dbu6 is a [Sapporta](https://github.com/jasim/sapporta) application. Work on it
needs the `sapporta` agent skill. If it is not available to you, install it (or
ask the user to) before making changes:

```bash
npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes
```

Load it for any change to the schema, API, auth, or UI.

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

Before committing, scan the diff for non-round amounts, long digit strings
without `050505`, and names or narrations not based on `sample` / `NOPII`.
Real statements never enter the tracked tree. An upload the importer could
not read is staged under `tmp/statement-uploads/`, which is gitignored and is
where an import prompt points you: read the statement there, and copy nothing
from it into a tracked file.
