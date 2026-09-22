# Standard Chartered Bank (savings/current) — CSV download

**Source:** Standard Chartered Bank India, savings/current account
**File type:** CSV (direct download from netbanking, not PDF-extracted)
**Input extensions:** `.csv`
**CC sign flip:** no

## Recognition signals (any 2+ → this parser)
- File extension is `.csv`; the tested export is UTF-8/ASCII text with LF line endings.
- Physical line 1 has four CSV fields: an account name ending in `Savings a/c` or `Current a/c`, an 8–20 digit account number prefixed with `'`, `INR`, and a signed `CR`/`DR` current balance.
- After one blank line, physical line 3 is exactly two fields: `Account transactions shown:` and `DD/MM/YYYY To DD/MM/YYYY`.
- After a second blank line, physical line 5 is exactly `\tDate,Transaction,Currency,Deposit,Withdrawal,Running Balance`.
- Every data row is prefixed with two tabs and has exactly 6 CSV fields: date, narration, `INR`, deposit, withdrawal, and running balance.
- A blank separator is followed by exactly `\tCurrent Balance,"INR <amount> CR|DR"` and `\tAvailable Balance,"INR <amount> CR|DR"`.
- Dates use `DD/MM/YYYY`; monetary values have exactly two decimal places, may use comma thousands separators, and use an empty cell for the inactive deposit/withdrawal direction.

## Source columns → Abacus mapping
| Source column     | Abacus field   | Notes                                  |
|-------------------|----------------|----------------------------------------|
| `Date`            | `date`         | `DD/MM/YYYY` → ISO                     |
| `Transaction`     | `narration`    | Verbatim                               |
| `Deposit`         | `deposit`      | Comma thousands; empty → 0             |
| `Withdrawal`      | `withdrawal`   | Comma thousands; empty → 0             |
| `Running Balance` | `balance`      | Post-transaction balance               |

## Quirks
- Running balance is **after** the transaction (top row balance == Current Balance).
- `closing` is extracted from the trailer `Current Balance` line and must equal both the line-1 account balance and the newest transaction's running balance.
- `opening` is left `null` because the statement does not print it. The parser derives the pre-oldest-row balance only for whole-statement arithmetic validation; it never emits that derived value.
- Rows are listed newest-first; preserve order in output (the schema doesn't care, and ordering matches statement).
- `Available Balance` can legitimately differ from `Current Balance`; parse and fingerprint it, but do not use it as `closing`.
- Preserve narration exactly as decoded by the CSV reader, including case, punctuation, reference numbers, and internal spaces.
- `CR` balances are positive assets and `DR` balances are negative. This is a bank-account export, so there is no credit-card sign flip.

## Validation enforced by the parser
- No line between the exact header and trailer is skipped: every two-tab source row must parse as one output row, so source and output row counts match.
- Every row must have exactly one positive direction amount, a valid date within the printed statement period, `INR` currency, and a printed running balance.
- Dates must remain newest-first.
- For every adjacent newest-first pair, `newer balance = older balance + newer deposit - newer withdrawal` must hold exactly to the cent.
- The line-1 balance, trailer `Current Balance`, and newest running balance must agree.
- Computed deposit and withdrawal totals must reconcile the implied pre-period opening to the printed closing exactly to the cent.
- Validation uses decimal arithmetic. JSON amounts are emitted as ordinary JSON numbers only after all checks pass.

## Emitted account identifier
- `account: {"kind": "bank", "identifier": "<digits>"}` — the line-1 account number with its leading `'` stripped, e.g. `'0505050505` → `0505050505`. Rejected when the field is missing, unquoted, or not 8–20 digits.
- `institution: null` — the export prints the product name (`... Savings a/c`) but not the bank's name.

## How to run
    PYTHONPATH=.. uv run parser.py <stanc-csv-path>

Writes `<basename>.abacus.json` next to the input.
