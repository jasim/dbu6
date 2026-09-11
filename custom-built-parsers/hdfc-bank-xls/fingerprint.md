# HDFC Bank savings / current account — netbanking statement XLS

**Source:** HDFC Bank India, savings or current (incl. overdraft) account "Statement of accounts" download
**File type:** Excel 97–2003 BIFF8 / OLE Compound File (`.xls`), single sheet
**Input extensions:** `.xls`
**CC sign flip:** no

## Recognition signals (all structural anchors are enforced)

- File extension is `.xls`, file magic is OLE Compound File
  `D0 CF 11 E0 A1 B1 1A E1`, and the workbook reports BIFF8 (`biff_version == 80`).
- Exactly one worksheet, named `Sheet 1`, with exactly 7 populated columns
  (`A:G`). The HDFC credit-card XLS (`hdfc-cc-xls`) has one sheet named
  `Statement` with 24 columns, so each parser rejects the other's file at the
  first check.
- `A1` matches `HDFC BANK Ltd. … Page No .: <n> … Statement of accounts`.
- The letterhead (rows 2–19) contains exactly one cell each matching
  `Account No :<digits>`, `RTGS/NEFT IFSC :HDFC0…`, `Currency :INR`, and
  `Statement From  :  DD/MM/YYYY         To  :  DD/MM/YYYY`. Their exact row is
  not anchored because the address block is free text.
- Row 20 is a single long asterisk rule in `A`. Row 21 is the exact header
  `Date`, `Narration`, `Chq./Ref.No.`, `Value Dt`, `Withdrawal Amt.`,
  `Deposit Amt.`, `Closing Balance`. Row 22 is a per-column asterisk mask.
- Transactions start at row 23 and run until the first blank row. After it:
  the asterisk mask again, a shorter asterisk rule in `A`, a blank row, then
  `STATEMENT SUMMARY  :-`, a label row (`Opening Balance` in `A`, `Debits` in
  `E`, `Credits` in `F`, `Closing Bal` in `G`), a value row, a blank row, a
  `Dr Count` / `Cr Count` label row in `E`/`F`, and their value row.
- The final populated row of the sheet is `---  End Of Statement ---`.

## Source columns → Abacus mapping

| Source cell / column | Abacus field | Notes |
| --- | --- | --- |
| STATEMENT SUMMARY `Opening Balance` | `opening` | Exact value; negative for overdrawn accounts |
| STATEMENT SUMMARY `Closing Bal` | `closing` | Exact value; must equal the walked running balance |
| `Date` (A) | `date` | `dd/mm/yy`, pivot `yy < 50 → 20yy`, converted to ISO |
| `Narration` (B) | `narration` | Verbatim, untrimmed; the importer's semantic identity key and the user's `exact` mappings key on this text |
| `Withdrawal Amt.` (E) | `withdrawal` | Blank → 0 |
| `Deposit Amt.` (F) | `deposit` | Blank → 0 |
| `Closing Balance` (G) | `balance` | Printed running balance, required on every row |
| `Chq./Ref.No.` (C) | `source_reference` | The bank reference (16 characters, 22 for RTGS); `null` for the all-zero placeholder on interest rows or a blank cell |
| `Value Dt` (D) | — | Validated as `dd/mm/yy`, not emitted (Abacus has no value date) |

With `source_reference` present the importer keys the row as
`ref:sha256(account|reference|date|direction|amount|occurrence)`, so identity
no longer depends on the narration text. Interest rows (`INTEREST PAID TILL
…`, `INTEREST DEBITED TILL …`) print `000000000000000` in `Chq./Ref.No.`;
that placeholder is mapped to `null` so two interest rows on the same day
never share a fabricated reference, and they fall back to the
narration-based `semantic:` key instead.

Rows imported through the retired TypeScript parser (deleted; was
`packages/api/bank-importer/parsers/hdfc-bank.ts`) carry `semantic:` keys,
so re-importing one of those statements through this parser would not
recognise them as duplicates. Old statements are not expected to be
re-imported, so no key migration is shipped.

## Quirks / pitfalls

- Amount cells are numeric in the tested exports (`xlrd` returns floats).
  The parser converts through `Decimal(repr(value))` and insists on at most
  two decimals; formatted money text with Western or Indian grouping is also
  accepted. Booleans, dates, and error cells are rejected.
- Overdraft accounts print **negative** running balances. This is a bank
  account, so there is no sign flip: the ledger asset balance genuinely dips
  below zero.
- HDFC books month-end interest (`INTEREST PAID TILL …`, `INTEREST DEBITED
  TILL …`) with a `Date` on the 1st of the **next** month and a `Value Dt`
  inside the statement period. The row is kept on its posting `Date`,
  matching the old importer. Consequence: a June statement's last row is
  dated 1 July and the July statement's first row is also 1 July, so the
  universal importer's multi-file overlap check (`minDate <= previousMaxDate`
  in `mergeStatements`) rejects June + July uploaded **together**. Import
  HDFC statements one file at a time; the emitted `opening` lets the
  reconciliation filter trim the shared boundary day correctly.
- Rows are physically oldest-first with same-day rows in posting order. The
  parser rejects any date going backwards instead of sorting, because the
  printed running balance only chains in physical order.
- The summary's `Opening Balance`, `Debits`, `Credits`, `Closing Bal`,
  `Dr Count`, and `Cr Count` are all cross-checked against the transaction
  rows, and every printed `Closing Balance` is checked against the walked
  running balance to the paisa.
- Untested: statements long enough for HDFC to paginate the sheet. The old
  parser silently skipped any non-date row; this one rejects a repeated
  header inside the table (`invalid Date 'Date'`). If that ever happens,
  extend the parser deliberately rather than loosening it.

## Validation enforced by the parser

- Every physical row between the mask row and the first blank row must
  parse as a transaction; nothing is skipped.
- Every transaction has a `dd/mm/yy` `Date` and `Value Dt`, a non-empty
  narration, exactly one positive amount, and a printed balance.
- `opening + Σ deposits − Σ withdrawals` reproduces every printed balance and
  the summary `Closing Bal` exactly.
- `Σ withdrawals == Debits`, `Σ deposits == Credits`, withdrawal row count ==
  `Dr Count`, deposit row count == `Cr Count`.
- Output is written only after every check succeeds.

## Fixture

`fixtures/sanitized-statement.xls` is synthetic, generated by
`fixtures/generate_fixture.py` (xlwt) with invented names, account numbers,
and amounts in the exact cell layout of the real export. `parser_test.py`
imports the generator to build mutated workbooks in memory and asserts each
one is rejected, and asserts the generator still reproduces the committed
fixture. Regenerate with:

    uv run custom-built-parsers/hdfc-bank-xls/fixtures/generate_fixture.py

## Emitted account identifier

- `account: {"kind": "bank", "identifier": "<digits>"}` — the 9–20 digits
  after `Account No :` in the letterhead, e.g.
  `Account No :05050505050505   Preferred Customer` → `05050505050505`.
  Rejected when the cell is missing, non-numeric, or shorter than 9 digits.

## How to run

    uv run custom-built-parsers/hdfc-bank-xls/parser.py <Acct_Statement_XXXXXXXX1234_DDMMYYYY.xls>

Writes `<input-basename>.abacus.json` next to the input. `uv` installs the
pinned `xlrd==2.0.2` dependency declared in the script metadata.

    uv run --python 3.9 custom-built-parsers/hdfc-bank-xls/parser_test.py
