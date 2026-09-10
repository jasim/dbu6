# custom-built-parsers

Saved parsers for known bank-statement layouts. Each subdir has a
`fingerprint.md` describing recognition signals plus a `parser.py` that emits
`<input>.abacus.json`.

If a new statement matches a fingerprint exactly (same bank, same layout), reuse
the parser. Otherwise add a new one.

The Import Statement screen can auto-detect these parsers. A directory becomes
an auto-detection candidate only when it contains `parser.py` and a non-empty
`fingerprint.md` with an `**Input extensions:**` line such as `.csv` or `.pdf`
(write each extension in backticks). The extension list cheaply narrows the
candidates; the parser itself is the executable fingerprint. It must reject the
wrong layout, reject malformed rows instead of skipping them, and write valid
Abacus JSON only after all validation succeeds. Auto-detection requires exactly
one matching parser.

## Index

- [stanc-bank-pdf-table](stanc-bank-pdf-table/) — Standard Chartered savings/current PDF, tabular (extracted via `extract-table-from-pdf.py`)
- [stanc-bank-csv](stanc-bank-csv/) — Standard Chartered savings/current CSV download (direct netbanking export)
- [stanc-cc-pdf](stanc-cc-pdf/) — Standard Chartered credit card PDF (parsed via `pdftotext -layout`); applies CC sign flip
- [hdfc-cc-xls](hdfc-cc-xls/) — HDFC credit card billed-statement BIFF8 XLS; applies CC sign flip and preserves exact paise closing
- [hdfc-cc-csv](hdfc-cc-csv/) — HDFC credit card billed-statement CSV (`~|~` delimited); applies CC sign flip and preserves exact paise closing
- [hdfc-bank-xls](hdfc-bank-xls/) — HDFC Bank savings/current account netbanking BIFF8 XLS; no sign flip, surfaces STATEMENT SUMMARY opening/closing and checks every running balance

## Goal

Produce one `<input-basename>.abacus.json` file next to each statement input, in
the wire shape accepted by `packages/api/bank-importer/parsers/abacus-json.ts`.
The generated JSON can then be uploaded through the Import Statement UI.

Do not call the import API from a parser workflow. Stop after writing the JSON
and report the output path, row count, opening/closing values, and whether a
saved parser was reused or a new parser was added.

## Abacus JSON Contract

Target shape:

```json
{
  "kind": "abacus",
  "opening": -12345.67,
  "closing": -23456.78,
  "rows": [
    {
      "date": "2026-03-04",
      "narration": "AMAZON INDIA",
      "withdrawal": 199.0,
      "deposit": 0.0,
      "balance": -10000.0
    }
  ]
}
```

Rules:

- `date`: ISO date string, `YYYY-MM-DD`.
- `narration`: verbatim statement text. If it wraps across lines, join with a
  single space. Preserve case, punctuation, reference numbers, and merchant text.
- `withdrawal` and `deposit`: both present, both non-negative, exactly one
  strictly positive.
- `balance`: running balance printed after the row, or `null` if the statement
  does not print per-row balances. Do not synthesize missing balances in a
  parser.
- `opening` and `closing`: statement opening/closing balances if explicitly
  labeled; otherwise `null` or omitted.
- Sign convention: ledger semantics. Asset balances are normally positive.
  Liability balances, including credit cards, are negative.

## Parser Workflow

1. Identify the input type with its extension plus a quick `file`/`head`/text
   inspection.
   - `.json`: already in Abacus shape; validate it.
   - `.pdf`: use the PDF workflow below.
   - `.csv`, `.tsv`, `.xls`, `.xlsx`: use the tabular workflow below.
   - `.txt` or readable text: use the freeform text workflow below.
2. Check this directory first. Read this README and each existing
   `fingerprint.md`. Reuse a parser only when the match is unambiguous: same
   bank, same account type, same file type, same layout.
3. Determine bank vs credit card before writing output.
4. If no parser matches and the layout is reusable, create a new subdirectory
   with `parser.py` and `fingerprint.md`.
5. Run the parser on the actual input and validate the generated JSON.
6. Spot-check representative rows against the source statement.

A wrong fingerprint match silently corrupts money data. If a layout is close but
not exact, add a new parser instead of stretching an existing one.

## Bank vs Credit Card

Credit-card statements usually print amounts owed as positive values, but the
ledger stores liabilities as negative balances. For a credit-card parser:

- Flip `balance` on every row: `balance -> -balance`.
- Flip `opening` and `closing`.
- Leave `withdrawal` and `deposit` as non-negative direction fields.

Infer credit card only when the source is clear. Strong signals include:
`Credit Card Statement`, `Total Amount Due`, `Minimum Amount Due`, `Payment Due
Date`, card-like account number formatting, no per-row balance column, or a
summary box such as `Previous Balance / Payments / Purchases / New Balance`.

Strong bank signals include a bank-account number, IFSC/branch data, per-row
running balances, and headers like `Withdrawal`, `Deposit`, or `Closing
Balance`.

If the statement is ambiguous, ask before generating JSON.

## PDF Workflow

Try `extract-table` for clean table PDFs:

```bash
uv run ~/m/a/code/tools/pdf-extract/extract-table-from-pdf.py statement.pdf
```

Use the dry-run headers to identify the transaction table. Then run with a
header filter and output prefix when needed:

```bash
uv run ~/m/a/code/tools/pdf-extract/extract-table-from-pdf.py \
  -o statement \
  -f '["date", "description", "withdrawal", "deposit", "balance"]' \
  statement.pdf
```

The generated CSV feeds the tabular workflow.

Use `pdftotext -layout` for prose PDFs, wrapped narrations, or mixed layouts:

```bash
pdftotext -layout statement.pdf statement.txt
```

The generated TXT feeds the freeform text workflow.

## Tabular Workflow

For CSV/TSV/XLS/XLSX:

1. Inspect the first roughly 30 rows. Find the real header row, summary rows,
   empty separator rows, and transaction boundaries.
2. Decide whether the layout is stable enough for a parser. It is stable when
   every transaction row has the same populated columns, date and amount columns
   are unambiguous, and narration is not split across arbitrary rows.
3. Write `custom-built-parsers/<bank-slug>/parser.py`.
4. Map source fields to Abacus fields.
5. Extract opening/closing balances from explicit labels when present.
6. Validate rows before writing JSON.
7. Document the fingerprint.

For XLS/XLSX, inspect with Python first:

```python
import pandas as pd
df = pd.read_excel("statement.xlsx", sheet_name=0, header=None)
print(df.head(30))
```

One-off hand-edited exports do not need a saved parser. A throwaway converter is
fine if the shape is not expected to recur.

## Freeform Text Workflow

Use a saved parser only when the text has a repeatable structure, for example
every transaction starts with a date at the same column and narration continues
until the next date row.

If the text is genuinely unstructured, do not create fragile regex soup. Use the
app's Import Statement freeform path directly, or manually produce Abacus JSON
after reading every transaction and reconciling the row count against the source.

## Directory Layout

```text
custom-built-parsers/
  README.md
  <bank-slug>/
    fingerprint.md
    parser.py
    sample-input.<ext>      # optional, anonymized
    sample-output.json      # optional
```

## Fingerprint Template

```markdown
# <Bank> <Account-type> <File-type>

**Source:** <bank name>, <account type: savings / current / credit card / loan>
**File type:** <CSV / XLS / XLSX / PDF-via-extract-table / PDF-via-pdftotext / TXT>
**CC sign flip:** <yes / no>

## Recognition signals (any 2+ -> this parser)
- File is a `.csv` / `.xlsx` / `.pdf` / `.txt`.
- Header row contains exactly: `<col1>`, `<col2>`, `<col3>`.
- First transaction date format: `<DD/MM/YYYY | DD-MMM-YY | ...>`.
- Account, branch, IFSC, or issuer marker visible in the first N rows.
- Other unique marker: `<footer/header text>`.

## Source columns -> Abacus mapping
| Source column | Abacus field | Notes |
| --- | --- | --- |
| `Txn Date` | `date` | Format `DD/MM/YYYY` |
| `Narration` | `narration` | Verbatim |
| `Withdrawal Amt.` | `withdrawal` | Empty or zero -> 0 |
| `Deposit Amt.` | `deposit` | Empty or zero -> 0 |
| `Closing Balance` | `balance` | Printed running balance |

## Quirks / pitfalls
- Opening-balance rows are not transactions; surface them as `opening`.
- Amount columns may contain thousands separators, `CR`/`DR`, or parentheses.
- Closing/total rows are not transactions; surface as `closing` or skip.

## How to run

    uv run parser.py <input-path>

Writes `<input-basename>.abacus.json` next to the input.
```

## Parser Conventions

Keep parsers small and dependency-light. Prefer stdlib `csv`, `re`, `json`,
`datetime`, plus `pandas`/`openpyxl` only when needed for spreadsheets. Run
parsers through `uv run` when they need Python dependencies.

Each parser should:

- Read exactly one input path from the CLI.
- Exit non-zero with a readable error on validation failure.
- Write no JSON if validation fails.
- Write `<input-basename>.abacus.json` next to the input.
- Avoid importing application code; keep the parser runnable as a standalone
  utility.

Minimum row validation:

```python
from datetime import date


def validate_abacus_rows(rows):
    if not rows:
        raise ValueError("no transactions parsed")
    for i, row in enumerate(rows):
        withdrawal = row["withdrawal"]
        deposit = row["deposit"]
        if withdrawal < 0 or deposit < 0:
            raise ValueError(f"row {i}: negative withdrawal/deposit")
        positive = (withdrawal > 0, deposit > 0)
        if positive == (False, False) or positive == (True, True):
            raise ValueError(
                f"row {i}: withdrawal/deposit XOR violated "
                f"({withdrawal}, {deposit})"
            )
        date.fromisoformat(row["date"])
```

## Hand-Off Checklist

When a parser run is complete, report:

- Output path.
- Row count.
- Opening and closing balances, after any credit-card sign flip.
- Bank vs credit-card decision and the evidence.
- Whether an existing parser was reused or a new parser/fingerprint was added.

## Common Mistakes

- Forgetting the credit-card sign flip for JSON output.
- Synthesizing missing per-row balances in the parser.
- Emitting opening, closing, total, or summary rows as transactions.
- Populating both `withdrawal` and `deposit` on one row.
- Rewriting narrations instead of preserving statement text.
- Reusing a close-but-not-identical parser.
