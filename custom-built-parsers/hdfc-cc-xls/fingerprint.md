# HDFC Bank credit card — billed-statement XLS

**Source:** HDFC Bank India, credit card billed-statement download
**File type:** Excel 97–2003 BIFF8 / OLE Compound File (`.xls`)
**Input extensions:** `.xls`
**CC sign flip:** yes

## Recognition signals (all structural anchors are enforced)

- File extension is `.xls`, file magic is OLE Compound File
  `D0 CF 11 E0 A1 B1 1A E1`, and the workbook reports BIFF8 (`biff_version == 80`).
- Workbook has exactly one worksheet named `Statement`. `xlrd` exposes exactly
  24 populated columns (`A:X`); some readers expand the styled/merged extent to
  blank column Y.
- `N3` matches `Credit Card No.: 050505XXXXXX0505` structurally: six digits,
  six `X` mask characters, and four trailing digits. `N4` is an HDFC
  `Alternate Account Number` marker followed by 16–24 digits.
- Fixed header anchors include `A6 = Payment Due Date`, `A7 = Statement Date`,
  `A8 = Total Amount Due`, and `A14 = Account Summary`.
- The account-summary labels are fixed at row 15: `Opening Bal`,
  `Payment / Credit`, `Purchases / Debits`, `Finance Charges`, and `Total Dues`.
  Their values occupy `A16`, `F16`, `K16`, `P16`, and `U16`.
- Transaction row 19 has exact anchor cells: `Transaction type` (A),
  `Primary / Addon Customer Name` (E), `Date & Time` (J), `Description` (M),
  `REWARDS` (S), `AMT` (U), and `Debit / Credit` (X).
- Transaction rows use `Domestic` or `International` in column A,
  `DD/MM/YYYY / HH:MM` in J, a description in M, an INR amount with exactly
  two decimals in U, and blank/`Dr`/`Cr` in X.
- The transaction table is followed by one blank separator row and then
  `Reward Points Summary` in column A.

## Source columns → Abacus mapping

| Source cell / column | Abacus field | Notes |
| --- | --- | --- |
| Account Summary `Opening Bal` (`A16`) | `opening` | Exact paise value, negated for liability semantics |
| Account Summary equation | `closing` | Exact `opening - credits + debits + finance charges`, negated |
| `Date & Time` (J) | `date` | Date portion converted to ISO `YYYY-MM-DD`; time is validated but Abacus has no time field |
| `Description` (M) | `narration` | Preserved verbatim, including bank-supplied spacing and `Ref#` text |
| `AMT` (U) with blank/`Dr` (X) | `withdrawal` | Card purchase/debit; liability increases |
| `AMT` (U) with `Cr` (X) | `deposit` | Payment/refund/credit; liability decreases |
| `Ref#` inside Description | `source_reference` | Extracted while remaining present in narration |
| No source column | `balance` | Always `null`; the XLS prints no per-row running balance |

## Quirks / pitfalls

- All monetary cells in the tested exports are strings, using either Western
  grouping (`12,345.67`) or Indian grouping (`1,23,456.78`).
- Rows are grouped `Domestic` first and `International` second. Dates are
  oldest-first within each group, so the sheet is not globally chronological.
  The parser stable-sorts all output rows by the validated source timestamp;
  identical timestamps retain physical source order. This hands the importer a
  single chronological sequence.
- HDFC's displayed `Total Amount Due` / `Total Dues` is rounded to the nearest
  whole rupee. The exact ledger closing is the account-summary equation at
  paise precision. This is demonstrated across the supplied pair: June's exact
  computed closing is July's printed opening to the paisa, while June's amount
  due is the corresponding whole-rupee rounded value.
- The parser therefore validates both values: exact transaction/account-summary
  arithmetic to the paisa and displayed `Total Dues` after half-up rupee
  rounding. Abacus `closing` receives the exact value, not the payment rounding.
- Credit-card balances use ledger semantics: statement opening and exact
  closing are negated. Direction amounts remain non-negative.
- The layout has no per-row running balance. The parser emits `balance: null`
  and reports `running_balance_checks=0`; it never synthesizes row balances.

## Validation enforced by the parser

- Every physical row between the exact transaction header and blank terminator
  must parse; no malformed or unexpected transaction row is skipped.
- Every transaction has a positive amount, a valid date no later than the
  statement date, a non-empty customer and narration, and a valid direction.
- Domestic/International grouping and oldest-first dates within each group are
  checked.
- Transaction credit total equals Account Summary `Payment / Credit` exactly.
- Transaction debit total equals `Purchases / Debits + Finance Charges`
  exactly.
- Positive statement-convention closing equals
  `opening - deposits + withdrawals` to the paisa; after the CC sign flip, the
  emitted ledger balances satisfy `opening + deposits - withdrawals = closing`.
- `Total Amount Due` equals Account Summary `Total Dues`, and both equal the
  exact closing rounded half-up to the nearest rupee.
- Output is written only after every check succeeds.

## Emitted account identifier

- `account: {"kind": "card", "identifier": "<16 chars>"}` — the masked number
  in `N3` with its `Credit Card No.: ` label removed, e.g.
  `Credit Card No.: 050505XXXXXX0505` → `050505XXXXXX0505`. The `N4`
  alternate account number is validated but not emitted. Rejected when `N3`
  is missing or not six digits, six `X`, four digits.
- `institution` — the issuer's name opening a `Registered Office Address:`
  cell in column `A` below the table, up to the first comma, verbatim
  (`HDFC Bank Cards Division`, mirroring the CSV export's footer); `null`
  when no such cell exists. The layout prints no other bank name.

## Fixture

`fixtures/sanitized-statement.xls` is generated by
`fixtures/generate_fixture.py` (anonymized per `AGENTS.md`); `parser_test.py`
imports the generator to build mutated workbooks in memory.

## How to run

    uv run custom-built-parsers/hdfc-cc-xls/parser.py <hdfc-billed-statement.xls>

Writes `<input-basename>.abacus.json` next to the input. `uv` installs the
pinned `xlrd==2.0.2` dependency declared in the script metadata.
