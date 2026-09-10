# AGENTS.md

Guidance for AI agents and contributors. See also
[CODING-PRINCIPLES.md](CODING-PRINCIPLES.md), [DEVELOPMENT.md](DEVELOPMENT.md),
[custom-built-parsers/README.md](custom-built-parsers/README.md).

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
Real statements stay outside the repo.
