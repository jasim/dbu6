# Decision: which rows on the checkpoint day are new

Decided 2026-09-24. Code: `checkpoint-day.ts` (`newOnCheckpointDay`) and
`journals/last-reconciled.ts` (`loadPostedRowsOn`).

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

## The balance rule, and why it is not enough on its own

Walk the day in the new statement's order and cut after the last row whose
balance equals the checkpoint. This was the whole rule before 2026-09-24, and
it is still the fallback whenever the pairing below gives up.

If the balance comes back to the checkpoint later that day, the cut lands too
late. A salary +1000 and rent -1000, or a failed UPI debit and its reversal,
are then dropped. The rows dropped always add up to zero, because both cut
points sit at the same balance, so no balance check can notice. The error is
silent by construction. Only the rows' identity can tell the two cuts apart.

## The rule now

Line up two lists for the checkpoint day: the rows the books hold, and the
new statement's rows. Pair each row in the books with its statement row. The
statement rows left over are new.

The books hold three kinds of row that day (`loadPostedRowsOn`):

- **This account's imports.** Each carries the statement row's source key
  (the bank reference, or account, date, direction, amount, narration and
  occurrence), on its category line, in both the one-row-per-journal form
  and the older grouped form.
- **Another account's imports.** A card payment or a transfer that the other
  account's import posted with this account as its category. Its key is the
  other statement's, on this account's line, so it never matches a row here.
- **Unkeyed journals.** Entered by hand, or imported before rows were keyed.
  Each line on another account is one row, as the older grouped imports
  wrote them.

Pairing goes in three passes, each only over what is still unpaired:

1. By key.
2. By amount and wording (the narration, ignoring case and spacing).
3. By amount alone. When several statement rows move that amount and read
   differently, the pairing can't tell which is the one in the books and
   gives up. When they read alike, any of them will do: they are the same
   transaction as far as the books can tell.

Wording goes before amount alone so that a row with an exact match isn't
taken first by another row in the books that only shares its amount.

Then the balance check: the statement's balance before its first row that
day, plus the paired rows the checkpoint counted, must equal the checkpoint
balance. The posted balance check adds a day up in journal id order, so the
checkpoint counted exactly the journals up to and including its own. A card
payment posted later from the card's side is paired, so it isn't imported
again, but is left out of the sum. The sum ignores the order rows print in.

How far the pairing is trusted depends on whether the statement holds the
whole day:

- **It starts before the day.** Every row in the books must be paired, or
  the pairing gives up.
- **It starts on the day** (a paste or mini-statement). It may start partway
  through, so rows in the books may be missing from it. Only keys pair, since
  an amount could belong to a row before the paste. A row in the books with
  no statement row is taken to sit before the paste, and the sum checks that
  for the rows the checkpoint counted.

  A day with an unkeyed journal gives up. An unkeyed row can never pair in a
  paste, so if several of them are in the paste and net to zero (a failed
  debit and its reversal on a day posted before keys), the sum can't tell,
  and all of them would come in again. Rows from another account's import
  can't pair in a paste either, but they are few, usually one transfer, so
  the paste is trusted with them.

When the pairing gives up, the balance rule decides, unchanged.

## What this rests on

The pairing reads the books through facts other code keeps. Changing any of
them can break it silently. `JournalPlan.ts` and `running-balance.ts` point
back here.

- **An import keys the category line, never its own account's line**
  (`journal-plan/JournalPlan.ts`). That is how a row this account's import
  posted is told from one another account's import posted.
- **A key includes the statement's account** (`transaction-identity.ts`).
  That is why another account's key never matches a row here.
- **Posted balance checks add a day up in journal id order**
  (`running-balance.ts`). That is how `counted` knows which of the day's rows
  the checkpoint included.
- **Keys are assigned before this filter** (`statement-import.ts`), so a
  mid-day cut doesn't renumber identical rows.

## What it handles

- A mid-day cut followed by rows that return to the checkpoint balance.
- A failed debit and its same-day reversal.
- A statement or paste whose opening equals the checkpoint, where a later row
  lands on it again. The balance rule let that row win and dropped everything
  before it.
- The bank printing the day's rows in a different order than last time.
  Pairing and the sum ignore order, while the balance rule refused or cut in
  the wrong place.
- A card payment or transfer already posted from the other account's
  statement, whether the checkpoint counted it or it came after.
- A row the bank reworded, when no other row that day moves its amount.
- A day posted before rows were keyed, or with a journal entered by hand,
  when the statement holds the whole day.
- Identical rows. Keys are assigned before this filter so a mid-day cut
  doesn't renumber them (`statement-import.ts`), and identical rows the keys
  miss pair by amount and wording.
- A day the books hold whole: nothing on it is new.

## What it does not handle

These go to the balance rule. If a row there returns to the checkpoint
balance, a new round trip can still be dropped silently.

- **Two rows that could be the one in the books.** A reworded, unkeyed or
  other-account row whose amount another row that day also moves, with
  different wording.
- **A row the bank re-dated**, or a transfer the two banks date differently.
  The row in the books has no statement row that day.
- **A paste on a day with an unkeyed journal.**
- **A statement with no balance on the day's first row.**
- **Anything outside the checkpoint day.** For example, a gap between
  statements whose missing rows net to zero (see `assemble.ts`).

Pairing by amount can be wrong in two ways, neither of which the sum can
notice:

- A row in the books that no statement row that day stands for (an
  adjustment entered by hand, say), after the checkpoint, when a new row
  moves exactly its amount. That row is taken as already in the books.
- A row the bank re-dated off the day, when a new row that day moves exactly
  its amount.

Both need an exact coincidence of amounts on the one day, and neither is
guarded.

In a statement that starts on the day, rows already in the books can come in
again:

- Two posted rows netting to zero, both reworded. The sum still holds. This
  needs two rewordings at once and is not guarded.
- A row another account's import posted after the checkpoint, when the paste
  holds it. The sum leaves it out, so nothing notices here, but the day's
  draft balance check then counts it twice and fails, so it shows up in
  Review.

## Rejected alternatives

- **Anchor on the first matching row instead of the last.** It re-imports
  instead of dropping. Pairing catches those duplicates, and on days it gives
  up they become silent zero-sum duplicates. Pairing is strictly better where
  it works.
- **Refuse whenever the balance matches more than once.** This blocks the
  common, correct case: a full-day overlap with an earlier round trip. The
  user would have no way through.
- **Store more at the checkpoint** (the boundary row, its position, a count).
  The books already hold each posted row. A position breaks when the bank
  reorders rows, and nothing can be stored for past imports.
- **Refuse the import when the pairing gives up.** The balance rule handles
  those days as it always did, and refusing would block imports that work
  today, for cases that are rare.
- **Keys only.** The first version of this rule. It gave up on every day
  with a card payment or transfer posted from the other side, since that
  row's key comes from the other statement, and on every unkeyed day.
- **Ask an LLM to pair the rows.** Only ties need judgment, and a wrong
  answer there is silent. An LLM adds a network call and answers that can
  change between runs. Asking the user is better (below).

## Possible follow-up

When the pairing gives up because two rows could be the one in the books,
or when an unkeyed checkpoint day has more than one row landing on the
checkpoint, stop the import and show the day's two lists so the user picks.
Not built: the case is rare and needs a new refusal and an import option.
