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
one. A rule whose `statement` names an account the books don't have is
refused too: imports, reclassification and the preview refuse the file,
naming the rule, until it is fixed, and the Categorization rules page shows
it as unreadable. `dbu6 check` reports "N exact and M contains rule(s)", or
the same refusal.

`POST /api/categorization-rules/preview` runs one rule, on its own, through
the categorizer's own matching over the drafts and the books, and answers
what it matches per statement and where those rows sit now. A body not in
the file's shape is a 400; a rule the file would refuse is a 422. The
guides have the agent preview a rule before proposing it, and propose it
statement first.

The Categorization rules page shows each rule's statement before its
limits.
`GET /api/import-presets/transaction-mappings` answers the new shape.
`LoadCategorizer`'s `classify` takes the whole row,
`StatementTransaction { transaction, statementAccount }`, instead of the
transaction alone, and its settings carry `accountNames`, the books'
account names: a project that replaces the categorizer changes its
classifier's signature.

Upgrade note for the version commit: rewrite `transaction_mappings.mjs` in
the new format, naming each rule's statements by their exact names in
Accounts, then run `npx dbu6 check`.
