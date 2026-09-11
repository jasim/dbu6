# Standard Chartered Credit Card PDF

**Source:** Standard Chartered Bank, credit card (e.g. Super Value Titanium Mastercard)
**File type:** PDF (parsed via `pdftotext -layout`)
**Input extensions:** `.pdf`
**CC sign flip:** yes

## Recognition signals (any 2+ → this parser)
- PDF header text contains "Credit Card Statement".
- Header rows include labels: "Credit Card Account Number", "Statement Date", "Statement Period", "Payment Due Date", "Total Payment Due (INR)", "Minimum Payment Due (INR)".
- Card number printed in 4×4 masked form, e.g. `050505XXXXXX0505`.
- A summary block line reads: `Previous Balance (INR)   Payments/Credits (INR)   Total Payment Due (INR)`.
- Transaction-table header line is exactly: `Date   Description   Transaction Reference   ...   Amount (INR)`.
- Section after transactions is titled `REWARDS POINTS SUMMARY`.

## Source columns → Abacus mapping
| Source column           | Abacus field   | Notes                                          |
|-------------------------|----------------|------------------------------------------------|
| `Date`                  | `date`         | Format `DDMMYY`, no separators (assumes 20YY)  |
| `Description`           | `narration`    | Verbatim; multi-line wraps joined with a space |
| `Transaction Reference` | `source_reference` | Stable issuer reference when present       |
| `Amount (INR)`          | `withdrawal`   | When no `CR` suffix → liability increases      |
| `Amount (INR)` with `CR`| `deposit`      | `CR` suffix → payment to the card              |
| (none — no per-row bal.)| `balance`      | Always `null`                                  |
| `Previous Balance`      | `opening`      | Pre-flip; parser negates                       |
| `Total Payment Due`     | `closing`      | Pre-flip; parser negates                       |

## Quirks / pitfalls
- No per-row running balance — `balance` is always `null`.
- Description wraps to a second line for some merchants (e.g. `NONPII MERCH, INC, SAMPLE` then `NONPII CITY01`); the parser appends the continuation to the previous row's narration.
- Forex rows have an extra "International Amount" sub-column like `USD 1.50`; do NOT include it in the narration.
- Reference column, rewards earned, rewards type, intl-amount may be absent on fee/IGST rows — the parser keys off `cells[0]` (date) and `cells[-1]` (amount), so column count varies safely.
- Transaction table ends at `REWARDS POINTS SUMMARY`; everything after is summary / MITC text and must not be parsed as transactions.
- Wrapped narration is accepted only from the Description column; known footnote markers immediately before the rewards section are excluded.
- CC sign flip: parser negates `opening` and `closing`; `withdrawal`/`deposit` are direction-classified and are not flipped.
- When both statement anchors are present, the parser requires `opening + deposits - withdrawals = closing` to the cent.
- The script declares Python 3.9+ metadata and uses postponed annotations so the `uv run` path remains compatible with Python 3.9.

## Emitted account identifier
- `account: {"kind": "card", "identifier": "<16 chars>"}` — the masked card number printed on or just below the `Credit Card Account Number` label line, with spaces removed and the mask uppercased, e.g. `0505 05XX XXXX 0505` → `050505XXXXXX0505`. The parser rejects the text when the label is absent or when it cannot find exactly one masked number near it.
- `institution` — the first printed `Standard Chartered …` phrase, verbatim, including a directly attached `Bank` / `India` / `Limited` suffix (`Standard Chartered Bank` in the fixture); `null` when the text never prints it.

## How to run
    uv run parser.py <input.pdf>

Writes `<input-basename>.abacus.json` next to the input.
