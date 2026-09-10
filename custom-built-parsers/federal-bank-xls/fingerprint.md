# Federal Bank savings account — FedNet transaction history XLS

**Source:** Federal Bank India, savings account "Operative account transaction history" download (`OpTransactionHistoryTprDD-MM-YYYY.xls`)
**File type:** Excel 97–2003 BIFF8 / OLE Compound File (`.xls`), single sheet
**Input extensions:** `.xls`
**CC sign flip:** no

## Recognition signals (all structural anchors are enforced)

- File extension is `.xls`, file magic is OLE Compound File
  `D0 CF 11 E0 A1 B1 1A E1`, and the workbook reports BIFF8 (`biff_version == 80`).
- Exactly one worksheet, named `OpTransactionHistoryTpr`, with exactly 10
  populated columns (`A:J`). The HDFC bank XLS (`hdfc-bank-xls`, sheet
  `Sheet 1`, 7 columns) and the HDFC credit-card XLS (`hdfc-cc-xls`, sheet
  `Statement`, 24 columns) are rejected at this check, and this parser
  rejects theirs.
- `A1` is exactly `Name and address of the account holder:`; rows 1–8 are
  the holder's name and address, one text cell per row in `A` (merged `A:J`).
- Row 9 is the account row: `Account No :` in `A`, digits in `C`,
  `CustomerId:` in `D`, digits in `E`, `Account Currency:` in `F`, `INR` in
  `G`, `Account Category:` in `H`, digits in `I`.
- Row 10 carries the period selection in `A:G` (`Last` / `One` /
  `Month Transactions` in the tested export; only required to be text) and
  `Statement Date:` in `H` with a `dd-mm-yyyy HH:MM:SS` stamp in `I`.
- Row 11 is the exact header `Sl. No.`, `Tran Date`, `Particulars` (merged
  `C:D`), `Value Date`, `Tran Type`, `Cheque Details`, `Withdrawal`,
  `Deposit`, `Balance Amount`.
- Transactions start at row 12 and run until the footer row, whose `A` cell
  starts with `This is a computer generated statement`. No blank rows or
  summary block sit between the table and the footer, and nothing follows it.

## Source columns → Abacus mapping

| Source column | Abacus field | Notes |
| --- | --- | --- |
| `Tran Date` (B) | `date` | `dd-mm-yyyy` text, converted to ISO |
| `Particulars` (C) | `narration` | Trimmed, then `clean_narration` (see below) |
| `Withdrawal` (H) | `withdrawal` | Formatted text with Indian grouping (`1,00,000.00`); blank → 0 |
| `Deposit` (I) | `deposit` | Same format; blank → 0 |
| `Balance Amount` (J) | `balance` | Printed running balance, required on every row |
| `Sl. No.` (A) | — | Validated as the 1-based running sequence, not emitted |
| `Value Date` (E) | — | Validated as `dd-mm-yyyy`, not emitted (Abacus has no value date) |
| `Tran Type` (F) | — | Validated as non-empty text (`UPI`, `ATM`, `IMPS`, …), not emitted |
| `Cheque Details` (G) | — | Validated as blank or text, not emitted |

`opening` and `closing` are emitted as `null`: the export labels neither. The
per-row balances give the importer a `per-row` closing, and deriving an
opening from the first row would change how the reconciliation filter
treats the checkpoint day, so nothing is synthesized.

`source_reference` is emitted as `null` on every row on purpose. The retired
TypeScript parser (`packages/api/bank-importer/parsers/federal-bank.ts`)
never emitted one, so every existing Federal draft/journal row carries a
narration-based `semantic:` transaction key. Emitting the UPI reference from
`Particulars` would switch identity to a `ref:` key and make previously
imported statements re-import as new drafts. Promoting the reference is
Phase 5.1 of `PLAN.md` and needs a key migration first.

## Narration is deliberately not verbatim

This parser reproduces the retired TypeScript parser's `cleanNarration`
byte for byte, which deviates from the verbatim-narration rule in
`custom-built-parsers/README.md`:

- `Particulars` is trimmed.
- For **withdrawals** whose trimmed text starts with `UPIOUT` and contains at
  least three `/`-delimited fields, the narration is the third field (the
  payee VPA): `UPIOUT/<ref>/<vpa>/UPI/0000` → `<vpa>`.
- Deposits (including `UPIOUT/<ref>/UPI…/<code>` refund credits), `UPI IN/…`,
  `TO ATM/…`, `FT IMPS/…`, and every other row keep the trimmed text.

The importer's semantic transaction key hashes this narration and
`data/user-config/transaction_mappings.mjs` has many `exact` keys that are
bare VPAs, so the cleaning must stay identical to keep both stable. Moving
the cleaning out of the parser is Phase 5.4 of `PLAN.md`, after 5.1.

One safe divergence: the TypeScript parser would have emitted `0` for a blank
`Balance Amount` cell and an empty narration for degenerate `Particulars`;
this parser rejects both instead of importing them.

## Quirks / pitfalls

- Every amount cell is **text** with two decimals and Indian digit grouping
  (`1,00,000.00`, `2,500.00`, `75.00`). Numeric cells are also accepted;
  anything else (booleans, dates, bare integers) is rejected.
- `Sl. No.` is a numeric cell (`1.0`, `2.0`, …) and is checked to be the
  unbroken 1-based sequence; a repeated header or any foreign row inside the
  table therefore fails on `Sl. No.` instead of being skipped.
- Rows are physically oldest-first with same-day rows in posting order. The
  parser rejects any date going backwards instead of sorting, because the
  printed running balance only chains in physical order.
- A bank account can print a negative `Balance Amount` (overdraft). There is
  no sign flip: the ledger asset balance genuinely dips below zero.
- The period-selection cells in row 10 (`Last` / `One` / `Month
  Transactions`) presumably change when a different range is chosen in
  FedNet; they are only required to be text. Untested: a date-range export.
- Untested: statements long enough for FedNet to paginate or split the sheet.
  If that ever happens, extend the parser deliberately rather than loosening it.

## Validation enforced by the parser

- Every physical row between the header and the footer must parse as a
  transaction; nothing is skipped.
- Every transaction has a sequential `Sl. No.`, `dd-mm-yyyy` `Tran Date` and
  `Value Date`, non-empty `Particulars` and `Tran Type`, exactly one positive
  amount, a blank spill column `D`, and a printed balance.
- Each printed `Balance Amount` equals the previous row's balance plus
  deposit minus withdrawal, to the paisa.
- Output is written only after every check succeeds.

## Fixture

`fixtures/sanitized-statement.xls` is synthetic, generated by
`fixtures/generate_fixture.py` (xlwt) with invented names, account numbers,
and amounts in the exact cell layout of the real export, including the
merged ranges. `parser_test.py` imports the generator to build mutated
workbooks in memory and asserts each one is rejected, and asserts the
generator still reproduces the committed fixture. Regenerate with:

    uv run custom-built-parsers/federal-bank-xls/fixtures/generate_fixture.py

## How to run

    uv run custom-built-parsers/federal-bank-xls/parser.py <OpTransactionHistoryTprDD-MM-YYYY.xls>

Writes `<input-basename>.abacus.json` next to the input. `uv` installs the
pinned `xlrd==2.0.2` dependency declared in the script metadata.

    uv run --python 3.9 custom-built-parsers/federal-bank-xls/parser_test.py
