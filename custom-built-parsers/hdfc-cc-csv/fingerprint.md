# HDFC Bank credit card — billed-statement CSV

**Source:** HDFC Bank India, credit card billed-statement download
**File type:** CSV with `~|~` field delimiters (netbanking "Billed statements" export)
**Input extensions:** `.csv`
**CC sign flip:** yes

## Recognition signals (all structural anchors are enforced)

- File extension is `.csv`, fields are separated by `~|~`, and nothing is
  quoted. The tested exports are ASCII with CRLF line endings; the parser reads
  lines newline-agnostically.
- Line 1 is `Name~|~<cardholder>`, followed by one or more `Address~|~…` lines.
- The head block then repeats, in this exact order, as `label~|~value` lines:
  `Customer GSTN`, `Payment Due Date`, `Statement Date`, `Total Amount Due`,
  `Minimum Amount Due`, `Credit Limit`, `Available Limit`,
  `Available Cash limit`. Dates are `DD/MM/YYYY`; amounts carry exactly two
  decimals with Western (`12,345.67`) or Indian (`1,23,456.78`) grouping.
- A blank line, then `Account Summary`, then the header
  `Opening Bal~|~-~|~Payment / Credit~|~+~|~Purchases / Debits~|~+~|~Finance Charges~|~=~|~Total Dues`,
  then a 9-field value line whose operator cells are literally `-`, `+`, `+`, `=`.
- A blank line, then `Card No: 1234 56XX XXXX 7890` structurally: four digits,
  two digits plus `XX`, `XXXX`, four digits.
- A blank line, then `AAN: ` followed by 16–24 digits.
- A blank line, then `Past Dues (if any)`, the header
  `Overlimit~|~3 Months~|~2 Months~|~1 Month~|~ Current Dues~|~Minimum Amount Due`,
  and six amounts.
- A blank line, then `Domestic / International Transactions`, then the header
  `Transaction type~|~Primary / Addon Customer Name~|~DATE~|~Description~|~AMT~|~Debit /Credit~|~REWARDS~|~`.
  Every transaction line ends with the delimiter, so the header and each row
  carry eight fields with an empty eighth field.
- Transaction rows use `Domestic` or `International`, a customer name,
  `DD/MM/YYYY HH:MM:SS`, a description, an amount with exactly two decimals,
  blank/`Dr`/`Cr`, and a blank or `+ N` / `- N` rewards cell.
- The transaction table is followed by one blank separator, then
  `Reward Points Summary` and its seven-column header. Trailer sections after
  that (`Rewards Program Points Summary`, `GST Summary`, `Loan Summary`,
  registered-office text) vary in length between statements and are ignored.

This layout is the CSV sibling of [hdfc-cc-xls](../hdfc-cc-xls/) and carries the
same statement. The column order differs (CSV puts `AMT` and `Debit /Credit`
before `REWARDS`), the timestamp has seconds rather than a `/` separator, and
the statement/due dates are `DD/MM/YYYY` rather than `DD Mon, YYYY`, so the two
parsers are kept apart.

## Source columns → Abacus mapping

| Source cell / column | Abacus field | Notes |
| --- | --- | --- |
| Account Summary `Opening Bal` | `opening` | Exact paise value, negated for liability semantics |
| Account Summary equation | `closing` | Exact `opening - credits + debits + finance charges`, negated |
| `DATE` | `date` | Date portion converted to ISO `YYYY-MM-DD`; the time is validated and used for ordering, and Abacus has no time field |
| `Description` | `narration` | Preserved verbatim, including the bank's fixed-width merchant padding and `Ref#` text |
| `AMT` with blank/`Dr` in `Debit /Credit` | `withdrawal` | Card purchase/debit; liability increases |
| `AMT` with `Cr` in `Debit /Credit` | `deposit` | Payment/refund/credit; liability decreases |
| `Ref#` inside `Description` | `source_reference` | Extracted while remaining present in narration |
| No source column | `balance` | Always `null`; the CSV prints no per-row running balance |

## Quirks / pitfalls

- Head and section lines usually carry one trailing space before the line
  break, and `Customer GSTN` can be a single space. Typed values are stripped
  before parsing; descriptions are not.
- Trailing and doubled spaces inside `Description` are genuine source data
  (`SAMPLE MERCHANT ONE BANGALORE `, `Sample Online www.sample  USD2.40`),
  so narration is emitted verbatim.
- Rows are grouped `Domestic` first and `International` second, oldest-first by
  date within each group, so the file is not globally chronological. Times
  within a single date are not sorted. The parser stable-sorts output rows by
  the validated timestamp; identical timestamps keep source order.
- A `Cr` row can carry a negative rewards adjustment (`- 2` on a refund).
- HDFC's displayed `Total Amount Due` / `Total Dues` is rounded to the nearest
  whole rupee. The exact ledger closing is the account-summary equation at
  paise precision, and it is the next statement's printed `Opening Bal`
  (verified across consecutive monthly exports). Abacus `closing` receives the
  exact value, not the payment rounding.
- Credit-card balances use ledger semantics: statement opening and exact
  closing are negated. Direction amounts stay non-negative.
- The layout has no per-row running balance. The parser emits `balance: null`
  and reports `running_balance_checks=0`; it never synthesizes row balances.

## Validation enforced by the parser

- Every line of the head, summary, card, AAN, past-dues, and transaction-table
  anchors must match; a foreign CSV (for example the Standard Chartered export,
  the other `.csv` parser) is rejected on line 1.
- Every physical line between the transaction header and the blank terminator
  must parse as one transaction; no malformed or unexpected row is skipped, and
  an empty table is an error.
- Every transaction has a positive amount, a valid timestamp no later than the
  statement date, a non-empty customer and description, a valid direction, and
  a blank or well-formed rewards cell.
- Domestic/International grouping and oldest-first dates within each group are
  checked.
- `Payment Due Date` must be after `Statement Date`; `Available Limit` and
  `Available Cash limit` must not exceed `Credit Limit`.
- Head `Total Amount Due` equals Account Summary `Total Dues`, and head
  `Minimum Amount Due` equals the Past Dues `Minimum Amount Due`.
- Transaction credit total equals Account Summary `Payment / Credit` exactly.
- Transaction debit total equals `Purchases / Debits + Finance Charges` exactly.
- Positive statement-convention closing equals
  `opening - deposits + withdrawals` to the paisa; after the CC sign flip the
  emitted ledger balances satisfy `opening + deposits - withdrawals = closing`.
- `Total Dues` equals the exact closing rounded half-up to the nearest rupee.
- Output is written only after every check succeeds.

## Emitted account identifier

- `account: {"kind": "card", "identifier": "<16 chars>"}` — the `Card No:`
  line with the label and spaces removed, e.g. `Card No: 0505 05XX XXXX 0505`
  → `050505XXXXXX0505`. The `AAN:` alternate account number is validated but
  not emitted. Rejected when the card line is missing or not in the
  `NNNN NNXX XXXX NNNN` shape.
- `institution` — the issuer's name opening the footer's
  `Registered Office Address:` line, up to the first comma, verbatim
  (`HDFC Bank Cards Division` in the tested export); `null` when that line
  is absent. The statement prints no other bank name.

## How to run

    uv run custom-built-parsers/hdfc-cc-csv/parser.py <hdfc-billed-statement.csv>

Writes `<input-basename>.abacus.json` next to the input. The parser is stdlib
only. Run its tests with:

    python3 -m unittest discover -s custom-built-parsers/hdfc-cc-csv -p 'parser_test.py'
