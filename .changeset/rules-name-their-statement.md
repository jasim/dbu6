---
"@dbu6/app": minor
---

Categorization rules name the statement they read.
`user-config/transaction_mappings.mjs` exports `exact` and `contains` as
lists of rules, each
`{ statement, money, narrations | contains, amount?, mapToAccount }`:
`statement` is the account whose statement prints the row (a name, a list,
or `"*"` for every statement), and `money` is `"in"`, `"out"` or
`"either"`, relative to it. The rules read the row's statement, as the AI
does, so a rule never claims a row on a statement it doesn't name, and
never answers with the row's own statement account: that row goes on to
the next rule or the AI.

The old format (`includes`, and `exact` keyed by narration) is refused at
load, with a message saying so; the file is rewritten by hand in the new
one. `dbu6 check` reports "N exact and M contains rule(s)", and fails on a
rule's statement the ledger doesn't hold and on a `"*"` rule whose account
has statements of its own (a transfer rule must name the statement it
reads).

`POST /api/categorization-rules/preview` runs one rule through the
categorizer's own matching over the drafts and the books, and answers what
it catches per statement and where those rows sit now. The guides have the
agent preview a rule before proposing it, and propose it statement first.

The Categorization rules page shows each rule's statement before its
limits and flags a transfer rule on every statement.
`GET /api/import-presets/transaction-mappings` answers the new shape.
`LoadCategorizer`'s `classify` takes the whole row,
`StatementTransaction { transaction, statementAccount }`, instead of the
transaction alone: a project that replaces the categorizer changes its
classifier's signature.

Upgrade note for the version commit: rewrite `transaction_mappings.mjs` in
the new format, giving each transfer rule the statements it reads, then run
`npx dbu6 check`.
