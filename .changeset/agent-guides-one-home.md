---
"@dbu6/app": patch
---

The run now picks up the rule requests you left in Review when you drop new
statements: it lists them in its first message and encodes them before
categorizing, so it doesn't ask again what you already answered.

Fix these on one account asks about opening balances only for the accounts
its drafts go to. Its report still names the others with no starting
balance.

A balance check that a transfer could explain can now be worked from the
Balance checks tab while other accounts still have uncategorized drafts: only
a run waits for those. `categorize` now holds how to treat a transfer, and a
rule's limits live only in `npx dbu6 docs books`.
