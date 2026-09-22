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
| `Particulars` (C) | `narration` | Verbatim, untrimmed |
| `Particulars` (C) | `source_reference` | The numeric bank reference at a fixed slash field (see below); `null` for layouts without one |
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

## Bank reference → `source_reference`

`Particulars` embeds the bank's transaction reference (12 digits in every
tested row) at a fixed `/`-delimited field, depending on the prefix:

| Prefix | Layout | Reference field |
| --- | --- | --- |
| `UPIOUT` | `UPIOUT/<ref>/<vpa or payee>/<remark>/<code>` | 2nd |
| `UPI IN` | `UPI IN/<ref>/<vpa>/<remark>/<code>` | 2nd |
| `TO ATM` | `TO ATM/<ref>/<location>` | 2nd |
| `FT IMPS` | `FT IMPS/IFI/<ref>/<name>/<remark>` | 3rd |

A known prefix whose reference field is not numeric is rejected as a layout
change. Any other prefix (`NEFT`, charges, interest, …) yields
`source_reference: null` and the importer falls back to its narration-based
identity key for that row. With a reference present the importer keys the
row as `ref:sha256(account|reference|date|direction|amount|occurrence)`, so
identity no longer depends on the narration text at all.

## Narration is verbatim; VPA matching lives in the mapping layer

The retired TypeScript parser (deleted) reduced `UPIOUT` withdrawals to the bare payee VPA, which is why
`user-config/transaction_mappings.mjs` has many `exact` keys that are
bare VPAs. This parser emits `Particulars` untouched. Those keys keep
working because `exact` keys containing `@` are matched against any UPI VPA
embedded in the narration (see `categorization/mapping-rules.ts`), for every
bank, not only Federal.

Consequence for anything imported through the old path: those drafts and
journal rows carry narration-hashed `semantic:` keys built from the shortened
narration, so re-importing an old statement through this parser would not
recognise them as duplicates. Old statements are not expected to be
re-imported (they would fail the running-balance checks against the ledger
anyway), so no key migration is shipped.

The TypeScript parser would also have emitted `0` for a blank `Balance
Amount` cell; this parser rejects the row instead.

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
- Every `UPIOUT`, `UPI IN`, `TO ATM`, and `FT IMPS` row has a numeric bank
  reference in its expected field.
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

## Emitted account identifier

- `account: {"kind": "bank", "identifier": "<digits>"}` — the digit string in
  `C9`, next to the `Account No :` label, e.g. `050505000012`. The customer id
  and account category on the same row are validated but not emitted. Rejected
  when `C9` is blank, numeric rather than text, or contains anything but
  digits.
- `institution: null` — the FedNet export prints no bank name.

## How to run

    PYTHONPATH=custom-built-parsers uv run custom-built-parsers/federal-bank-xls/parser.py <OpTransactionHistoryTprDD-MM-YYYY.xls>

Writes `<input-basename>.abacus.json` next to the input. `uv` installs the
pinned `xlrd==2.0.2` dependency declared in the script metadata.

    PYTHONPATH=custom-built-parsers uv run --python 3.9 custom-built-parsers/federal-bank-xls/parser_test.py
