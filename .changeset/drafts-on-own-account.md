---
"@dbu6/app": minor
---

A draft categorized to its own statement's account no longer posts. The
Drafts grid could set one (the categorizer and Set account refuse it), and
posting wrote both its lines on that account, netting to nothing, while its
balance checks counted only the statement's side, so a check that passed
before posting could fail after it. Now it blocks the categorization check:
the draft counts as `on_own_account` in the draft counts (Home, Review) and
among the block's `count` of drafts that need an account, and the block
carries `on_own_account`. Review says "1 transaction goes to the account it
came from". `POST /api/draft-transactions/post-to-journal` refuses with 422
`DRAFTS_ON_OWN_ACCOUNT`, `uncategorized_count` and `on_own_account_count`;
Add all leaves the account out with that block.
