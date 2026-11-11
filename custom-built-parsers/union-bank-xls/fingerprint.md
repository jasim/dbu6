# Union Bank of India savings / current account — netbanking transaction history XLS

**Source:** Union Bank of India, savings or current account "Statement of Account" download (`OpTransactionHistoryUX3_XLS...xls`)
**File type:** Excel 97–2003 BIFF8 / OLE Compound File (`.xls`), single sheet
**Input extensions:** `.xls`
**CC sign flip:** no

## Recognition signals (all structural anchors are enforced)

- File extension is `.xls`, file magic is OLE Compound File `D0 CF 11 E0 A1 B1 1A E1`, and the workbook reports BIFF8 (`biff_version == 80`).
- Exactly one worksheet, named `OpTransactionHistoryUX3_XLS`, with exactly 10 populated columns (`A:J`, indexed 0 to 9).
- Row 0 (Excel row 1): `B1` is `Statement of Account`.
- Row 1 (Excel row 2): `G2` contains `Union Bank of India`.
- Rows 1–11 contain customer metadata: `Customer Id` in `G4`, `A/C Number` in `G5`, `Currency` `INR` in `G6`/`H6`, `Account Type` in `G7` (`Current Account` or `Savings Account`), `Statement Date` in `B12`, `Statement From` in `G12`, `To` in `I12`.
- Row 12 (Excel row 13): `B13` matches `Records from <start> to <end>.` and `E13` is `No more records available.`.
- Row 13 (Excel row 14) is the exact table header: `Date` in `B`, `Tran Id` in `C`, `Remarks` in `D`, `UTR Number` in `F`, `Instr. Id` in `G`, `Withdrawals` in `H`, `Deposits` in `I`, `Balance` in `J` (with columns `A` and `E` blank).
- Transactions start at row 14 and continue until the sheet ends or the first blank row.

## Source columns → Abacus mapping

| Source column | Abacus field | Notes |
| --- | --- | --- |
| `Date` (B) | `date` | `DD-MM-YYYY HH:MM:SS` text, converted to ISO `YYYY-MM-DD` |
| `Remarks` (D) | `narration` | Verbatim, untrimmed statement text |
| `Tran Id` (C) | `source_reference` | Bank transaction ID (e.g. `Y82340026`), unique per transaction |
| `Withdrawals` (H) | `withdrawal` | Numeric cell or formatted money text; blank -> 0 |
| `Deposits` (I) | `deposit` | Numeric cell or formatted money text; blank -> 0 |
| `Balance` (J) | `balance` | Printed running balance, required on every row |
| `UTR Number` (F) | — | Validated as `'-` or text, not emitted |
| `Instr. Id` (G) | — | Validated as blank or text, not emitted |

`opening` and `closing` are emitted as `null`: the export labels neither. The per-row balances give the importer a `per-row` closing, and deriving an opening from the first row would change how the reconciliation filter treats the checkpoint day, so nothing is synthesized.

## Bank and Account Identification

- `institution`: Emitted as `Union Bank of India` (trimmed from `G2`).
- `account`: `abacus.bank_account(account_number)` where account number is extracted from `H5` (digits only).

## Quirks / pitfalls

- Amount cells are numeric floats in the tested export; formatted text with two decimals is also accepted.
- Date cells in the transaction table are formatted as `DD-MM-YYYY HH:MM:SS`. The time component is ignored and the date is normalized to ISO `YYYY-MM-DD`.
- Header row has columns A and E blank; table columns are B through J (columns 1, 2, 3, 5, 6, 7, 8, 9).
- `Records from 1 to N.` in row 12 is verified to match the count of parsed transaction rows (`N - 1 + 1 == len(rows)`).
- Every printed running balance is verified against the previous row's balance + deposit - withdrawal to the paisa.

## How to run

    npx dbu6 parser run union-bank-xls <statement.xls>
