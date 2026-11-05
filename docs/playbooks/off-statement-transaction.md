# A transaction no statement shows

## When

An asset or liability's history in the books shows one side of its
account and not the entry that started it. In double-entry terms the
statements give the repayments or the payouts, and the originating entry,
the other side, passed through no account the user gets a statement for.
You find these while categorizing (the run guide's phase 6), and ask about
them in the opening block of the question round, by name, with what you
saw. The run guide's "Accounts with no statements" and "Order of
operations" (`npx dbu6 docs run`) are the frame; this is the method.

## Read

- The account's movement, posted entries and drafts:
  `npx sapporta api get /api/accounts/<id>/activity --query '{"from":"<from>","to":"<to>"}'`,
  or with SQL (`sqlite3 -readonly`): the drafts categorized to it
  (`account_id`), with date, amount and the statement they come from.
- Its opening: `npx sapporta api get /api/opening-balances`, the account in
  `unanswered`, its `first_activity_date` and `default_date`; and
  `wrong_side`, which shows a loan with only repayments as a liability in
  debit.
- The patterns:

| Pattern in the statements | Likely nature | What is missing |
| --- | --- | --- |
| A liability (loan) receives only repayments: instalments debited from a bank, no inflow of principal anywhere | a loan disbursed directly to a third party (car dealer, builder, college, merchant): a financed purchase | the disbursement: Cr the loan, Dr what it bought (a vehicle, property, an expense such as fees) |
| A card or BNPL line converts a purchase into instalments | an EMI conversion; the purchase is on the card statement | usually nothing; categorize the purchase as usual |
| An asset is only ever paid out of (redemptions, maturity proceeds, dividends, interest), never paid into | an asset held before the books start, or bought with money outside the statements (cash, a gift, an inheritance) | an opening balance, or the funding entry if it was bought in the period |
| Income arrives net (salary credited after deductions) | gross-to-net deductions: employer and employee retirement contributions, tax deducted at source | only if the user tracks the gross figure: the payslip, not a statement, is the source; not recorded in this release |
| Money lent or received back with no outgoing leg | a loan given (a receivable) before the books start, or in cash | an opening balance, or the cash leg |

## Change

1. **Ask,** as one row of the opening block in Message 2, naming the
   account, the evidence (the rows you saw, with dates and amounts), the
   nature you suspect, and exactly what you need:

   ```
     7  Car loan (new)   owed   9 instalments of 18,000 to SAMPLE BANK from
                                5 May, but no statement shows the loan paid
                                out: it was probably disbursed straight to
                                the dealer. When was it paid out, how much,
                                and what did it buy (the car, or something
                                else)? Or, if it was paid out before
                                2025-04-01, what you still owed then.
   ```

2. **Record the answer,** on the user's yes, by when the originating entry
   falls, in the run guide's order of operations (create, categorize,
   open, then this):
   - **Before the books start:** the opening is the principal outstanding
     on the day the books start, from the loan's statement or amortisation
     schedule, or worked back from an outstanding the user knows on a
     later date (the balance less the account's movement up to that date).
     No disbursement entry.
   - **Inside the period:** an opening of 0 dated the day before the
     disbursement ("started here"), then the disbursement as a journal on
     its date, by hand ("Add a transaction by hand" in
     `npx dbu6 docs books`): credit the loan with the principal, debit the
     asset it bought.

     ```
     npx sapporta rows create journals --values '{"date":"2025-03-12","description":"Car loan paid out to the dealer","$details":{"table":"journal_entries","fk":"journal_id","rows":[{"account_id":<vehicle>,"debit":300000,"comment":"Financed purchase"},{"account_id":<car loan>,"credit":300000,"comment":"Disbursement"}]}}'
     ```

     The asset (Vehicle, under Assets, created on the same yes) is new
     too: its opening is 0 dated the day before, with this journal as its
     first event. If the user doesn't want the purchase on the balance
     sheet, the debit goes to an expense instead, and only the loan is
     opened.
   - **An asset held before the books start:** its opening, the amount
     the user gives, on `default_date`.
   - **An asset bought in the period with money no statement shows:** an
     opening of 0 the day before, then the funding journal the user
     describes (debit the asset, credit Cash or the account it came from).

3. Read `GET /api/opening-balances` again: the account is off `unanswered`,
   and a loan with its disbursement posted is off `wrong_side`.

Instalments stay all principal: splitting the interest out needs the
amortisation schedule, and is not done here.

## Never

- Invent the principal, the date or the counter-account. Each is the
  user's answer, or a document they point you to.
- Record a 0 opening on a loan whose disbursement is not in the books or
  in the answer: that leaves a liability in debit, the failure this
  playbook exists for.
- Post the journal before the account's opening, or before its drafts are
  categorized.
- Change a draft or a statement's balance to make the account look right.

## Report

- **Recorded:** each account, its opening (an amount, or "started here"
  with the day), and each off-statement journal you posted, with its date,
  amount and both accounts.
- **Still open:** each account still on `unanswered`, and what you still
  need from the user.
