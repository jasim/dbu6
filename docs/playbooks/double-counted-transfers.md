# A transfer counted twice

## When

An account's balance check fails by an amount that a transfer or card
payment between two of the user's accounts could explain. In a run, this
waits until every statement is imported and categorized. The failing check
is the only way in: nothing here starts from a guess that two rows match.

## Read

- The account's failing checks, oldest first:
  `npx sapporta api get /api/review/accounts/<id>`, `failing` (date, draft,
  running balance, statement balance, `diff`), and how its running balance
  adds up around them:
  `npx sapporta api get /api/accounts/<id>/activity --query '{"from":"<from>","to":"<to>"}'`.
- The other statements' records of a movement on this account near a date,
  for `diff`'s amount: their drafts categorized to it, and entries already
  in the books from their statements (on this account, an entry carrying a
  `source_transaction_key` came from another account's statement). Replace
  `<id>`, `<amount>` and `<date>`:

  ```sql
  SELECT 'draft' AS kind, d.id, d.date, a.name AS statement,
         d.withdrawal, d.deposit, d.source_narration AS text
  FROM draft_transactions d JOIN accounts a ON a.id = d.base_account_id
  WHERE d.account_id = <id> AND <amount> IN (d.withdrawal, d.deposit)
    AND d.date BETWEEN date('<date>', '-5 days') AND date('<date>', '+5 days')
  UNION ALL
  SELECT 'posted', je.id, j.date, NULL, je.debit, je.credit, je.source_narration
  FROM journal_entries je JOIN journals j ON j.id = je.journal_id
  WHERE je.account_id = <id> AND je.source_transaction_key IS NOT NULL
    AND <amount> IN (je.debit, je.credit)
    AND j.date BETWEEN date('<date>', '-5 days') AND date('<date>', '+5 days');
  ```

  (`sqlite3 -readonly`, as "Reading the database" in `npx dbu6 docs books`
  says.) `withdrawal` and `deposit` are the other statement's. Then this
  account's own drafts of that amount, the other way, in the same days.
  Which way money moved is the row's withdrawal or deposit, which its
  statement's balances confirm, not words in the narration such as "CR".

## Change

**The goal** is clean books that represent the bank statements accurately.
Every rule below serves it. A case this playbook doesn't name, such as a
transfer fee, a currency conversion, or the other side categorized to an
income or expense account, you untangle as a competent accountant would,
within the Never list, and say what you did. Where the fix needs a change to
the books, say which change and ask.

**Intent.** A transfer between two of the user's accounts is on both
statements. When one side is categorized to the other account, that draft
already records the movement on both accounts, so the other statement's
draft of it counts it a second time. Remove the second copy, and keep
everything the statements say checkable.

**A draft is safe to delete when** another record of the same movement on
its account comes from the other account's statement: an entry in the
books, or that account's draft categorized to this one. It is the same
amount, the other way from the other side's point of view, a few days apart
at most. And deleting the draft removes the failing check's difference, not
just changes it. When it is the day's only draft and carries that day's
balance, the balance goes with it, which is fine as long as the choice
below holds.

**When the two dates differ,** the copy that stays dates the movement on
both accounts. The account whose copy was deleted printed balances, on the
days between the two dates, that don't include the money yet. Blank the
fewest of those balance checks: only the ones that still fail after the
delete, only by the transfer's amount, and only between the two dates.
Leave every other check alone. A same-day transfer needs no blanking.

**Which copy to delete: keep a balance after the transfer on both
statements.** A statement's balance lives only on its rows, so deleting a
row deletes the balance printed on it. Delete the copy that leaves each of
the two accounts a balance check from its own statement within one to three
days after the transfer, posted or draft: then reconciliation still covers
the movement on both. Count the days on each statement from its own row
for the transfer, not from the date the kept copy gives it. Prefer the
later-dated copy when either choice keeps one. On the same day, delete the
copy that loses no balance (it carries none, or another draft that day
takes it); when both would lose one, either will do. When neither keeps a
balance after the transfer (both copies are the last row of their statements),
delete the later copy anyway, and say in the report that the account's next
statement confirms the transfer. Don't stop to ask: the next statement's
first balance includes the money, so the confirmation is late, not lost.

**Sketch, not steps.** Start from the earliest failing check on an account
and its difference. Look on the other statements, posted and draft, for a
movement of that amount the other way within a few days, categorized to
this account. Deleting the later-dated copy usually leaves the fewest
checks to blank, unless it carries its statement's last balance. After each
fix, read the account's checks again before the next.

The commands: `npx sapporta rows delete draft_transactions <id>`, which moves
a balance the draft carries onto the day's new last draft; a balance
blanked with
`npx sapporta rows update draft_transactions <id> --values '{"balance_assertion_base_account":null}'`.

Once the second copy is gone, the account whose copy was deleted counts the
other account's draft (its `relies_on` names that account, which stays
empty while a check fails), so the two go into the books together: Review's Add
all adds them in one go, and Add on either alone is refused, naming the
other. Name no order.

## Never

- Delete or change anything already in the books.
- Blank a balance check that the transfer's amount between its two dates
  doesn't explain, or change a balance to another number.
- Delete a draft when two records match it equally and the statements' own
  references don't decide between them: ask.

## Report

- **Transfers:** each fixed, by date, amount and the two accounts.
- **Drafts deleted:** each by account, date, description and amount.
- **Balance checks blanked:** each by account and date.
- **Confirmed later:** each transfer no balance confirms yet, and the
  statement that will.
- **Left for you:** anything you couldn't settle, and why.
