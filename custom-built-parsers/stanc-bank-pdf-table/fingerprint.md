# Standard Chartered Bank (savings/current) — PDF, tabular

**Source:** Standard Chartered Bank India, savings/current account
**File type:** PDF → CSV via `extract_table_from_pdf.py`, which ships beside the parser
**Input extensions:** `.pdf`
**CC sign flip:** no

## Recognition signals (any 2+ → this parser)
- PDF transaction table header (post-extraction): `['', 'value\ndate', 'description', 'cheque', 'deposit', 'withdrawal', '']` — 7 columns, transaction date in col 0, value date in col 1, balance in col 6.
- First data row narration is `BALANCE FORWARD` with only the balance column populated.
- Date cells formatted `DD MMM YYYY` (e.g. `01 Feb 2026`).
- Last row: `,,Total,,<deposit-sum>,<withdrawal-sum>,` (no balance).
- Narrations include multi-line UPI/IMPS reference blocks within a single cell (newlines inside the cell, not across rows).

## Source columns → Abacus mapping
| Source column   | Abacus field   | Notes                                              |
|-----------------|----------------|----------------------------------------------------|
| col 0 txn date  | `date`         | `DD MMM YYYY` → ISO                                |
| col 2 desc      | `narration`    | Internal newlines collapsed to single spaces       |
| col 4 deposit   | `deposit`      | Comma thousands; empty → 0                         |
| col 5 withdrawal| `withdrawal`   | Comma thousands; empty → 0                         |
| col 6 balance   | `balance`      | Comma thousands                                    |

## Quirks
- `BALANCE FORWARD` row → not a transaction. Its balance is `opening`.
- `Total` row at bottom → drop. Closing is the last transaction row's balance.
- Description cell has newlines from pdfplumber's cell extraction; collapse whitespace runs.

## How to run
    PYTHONPATH=.. uv run parser.py <stanc-statement.pdf>

Internally calls `extract_table_from_pdf.py`, then parses the resulting CSV. Writes `<basename>.abacus.json` next to the PDF.
