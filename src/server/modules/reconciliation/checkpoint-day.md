# Decision: which rows on the checkpoint day are new

Decided 2026-09-24. Code: `since-checkpoint.ts` (`newOnDateByKey`) and
`journals/last-reconciled.ts` (`loadPostedKeysOn`).

## Context

Statements overlap: people pull a custom date range, so a new statement
repeats rows the books already hold. The books remember one fact per account,
the checkpoint: "on this date the balance was this much" (the last posted
balance check).

- Rows dated before the checkpoint are in the books. Skip them.
- Rows dated after it are new. Import them.
- Rows on the checkpoint date are the hard part. The last statement may have
  ended partway through that day: it was downloaded that day, or it is an
  HDFC statement whose interest row is dated the 1st of the next month.

## The old rule, and why it was not enough

Walk the day in the new statement's order and cut after the last row whose
balance equals the checkpoint.

If the balance comes back to the checkpoint later that day, the cut lands too
late. A salary +1000 and rent -1000, or a failed UPI debit and its reversal,
are then dropped. The rows dropped always add up to zero, because both cut
points sit at the same balance, so no balance check can notice. The error is
silent by construction. Only the rows' identity can tell the two cuts apart.

## The rule now

Every imported row has a source key (the bank reference, or account, date,
direction, amount, narration and occurrence). Posted journals keep it on the
category line, in both the one-row-per-journal form and the older grouped
form.

On the checkpoint day:

1. Collect the keys of every posted journal that day touching the account.
2. A statement row whose key is among them is in the books. Every other row
   that day is new.

This is trusted only when all three checks pass:

- **Every journal that day has a key.** A journal entered by hand, or
  imported before rows were keyed, has none, and keys can't vouch for it.
- **Nothing posted is missing.** If the statement starts before the
  checkpoint day, it holds the whole day, so every key posted that day must be
  among its rows. If it starts on the day (a paste or mini-statement), it may
  start partway through, so earlier posted rows may be absent.
- **The balances agree.** The statement's balance before its first row that
  day, plus the rows found in the books, must equal the checkpoint balance.
  This is a sum, so the order of rows within the day doesn't matter.

If any check fails, the old balance rule decides, unchanged.

## What it handles

- A mid-day cut followed by rows that return to the checkpoint balance.
- A failed debit and its same-day reversal.
- A statement or paste whose opening equals the checkpoint, where a later row
  lands on it again. The old rule let that row win and dropped everything
  before it.
- The bank printing the day's rows in a different order than last time. Keys
  and the sum ignore order, while the old rule refused or cut in the wrong
  place.
- Identical rows without a reference. The occurrence number keeps them
  apart, and keys are assigned before this filter so a mid-day cut doesn't
  renumber them (`statement-import.ts`).
- A day the books hold whole: nothing on it is new.

## What it does not handle

These go to the old balance rule, with its old behavior.

- **An unkeyed checkpoint day** (legacy imports, hand-entered journals, an
  opening-balance journal). If a row there returns to the checkpoint
  balance, a new round trip can still be dropped silently. This happens at
  most once per account: after the next import is posted, the checkpoint day
  is keyed.
- **A row the bank reworded or re-dated** between the two statements on the
  checkpoint day. Its key changed, so the rule can't prove it is in the books.
- **A statement that starts on the checkpoint day** in which two posted rows
  netting to zero were both reworded. The sum still holds, so they would be
  re-imported. This needs two rewordings at once and is not guarded.
- **Anything outside the checkpoint day.** For example, a gap between
  statements whose missing rows net to zero (see `assemble.ts`).

## Rejected alternatives

- **Anchor on the first matching row instead of the last.** It re-imports
  instead of dropping. Keys catch those duplicates on keyed days, and on
  unkeyed days they become silent zero-sum duplicates. The key rule is
  strictly better where keys exist.
- **Refuse whenever the balance matches more than once.** This blocks the
  common, correct case: a full-day overlap with an earlier round trip. The
  user would have no way through.
- **Store more at the checkpoint** (the boundary row, its position, a count).
  The books already hold each posted row's key. A position breaks when the
  bank reorders rows, and nothing can be stored for past imports.

## Possible follow-up

On an unkeyed checkpoint day where more than one row lands on the
checkpoint, stop the import and let the user pick the boundary row, instead
of taking the last. Not built: the case is rare and needs a new refusal and
an import option.
