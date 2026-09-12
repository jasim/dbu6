# Importing freeform transactions

Use this when the user pastes transactions that no saved parser reads: text
copied out of a PDF or a web page, an HTML fragment, CSV, a hand-typed list, or
anything partly formatted. Where the content came from does not matter. What
matters is that it contains the transactions themselves: a date, a
description, and an amount for each.

The user starts from the app's **Import freeform transactions** screen, which
gives them a prompt naming the bank and the import preset for the account. They
paste the content after the prompt, or give you a file path.

You turn the content into one Abacus JSON statement, get the opening and
closing balances from the user, import the statement into Drafts through the
API, and show the user the result. This is a one-off conversion: do not write a
parser for it.

## 1. Read the transactions

- Find every transaction in the content, in whatever shape it arrives. Ignore
  everything else: headers, totals, navigation, markup, and styling.
- If the content has no transactions you can read with confidence (no dates,
  no amounts, or columns you cannot tell apart), say what is missing and ask
  instead of guessing.
- Leave out rows the content marks as pending, authorised, on hold, or
  processing: they can still change or disappear. Ask when you cannot tell.
- If the content covers more than one account or card, ask which one to
  import.
- Keep the content out of the repository except under `tmp/`, which is
  gitignored. Never put any of it in fixtures, tests, docs, or commits; see
  `AGENTS.md`.

Before going on, tell the user how many transactions you kept, their date
range, and anything you left out and why.

## 2. Ask for the opening and closing balances

Always ask the user for both balances, and do not import until you have them:

- **Opening**: the balance immediately before the earliest transaction you kept.
- **Closing**: the balance immediately after the latest transaction you kept.

If the content shows a balance, offer it only as a suggestion for the user to
confirm: a balance shown next to transactions often includes pending activity
or amounts outside the rows that were pasted. For a credit card, ask for the
amount owed as the bank shows it.

Then check the arithmetic in ledger terms (step 3): opening plus deposits minus
withdrawals must equal closing. If it does not, stop and show the user the
difference. The usual causes are a missing row, a pending row, or a balance
taken at a different moment. Never change rows or balances to make the numbers
agree.

## 3. Write the request

Follow the "Abacus JSON Contract" in `custom-built-parsers/README.md`. For
freeform transactions specifically:

- `opening` and `closing` are required: the two balances from step 2, in
  ledger semantics. A bank balance is written as the bank shows it, negative
  when overdrawn. A credit card's amount owed is negative; a card in credit is
  positive.
- `rows`: one per transaction you kept.
  - `date`: `YYYY-MM-DD`. When the content shows both a transaction date and a
    posting date, use the one the bank's statements for this account use. If
    the preset has a `custom_statement_parser_path`, that parser shows which
    date and narration form the statements carry; match it where the content
    gives you the same information.
  - `narration`: the description exactly as the content shows it.
  - `withdrawal` and `deposit`: both non-negative, exactly one positive. On a
    credit card, purchases and fees are withdrawals; payments and refunds are
    deposits.
  - `balance`: the running balance the content shows after the row, in ledger
    semantics, or `null`. Never compute it.
  - `source_reference`: the bank's reference number for the row (a UPI
    reference, a transaction ID) when the content shows one; otherwise omit it.
    A reference is what lets a later statement import recognise these rows as
    already imported even when the statement words the narration differently.
- `institution`: the bank's name as the content prints it, or the bank name
  from the prompt when the content prints none.
- `account`: only when the content prints the account or card number, in the
  canonical form described under "Emitted account identifier" in
  `custom-built-parsers/import-statement-parser-guide.md`. Otherwise omit it;
  never guess.

Write the request body to
`tmp/freeform-transactions/<bank>-<first-date>-<last-date>.json`:

```json
{
  "preset": "Sample Card",
  "source_name": "sample-card-2026-09-01-2026-09-12",
  "statement": {
    "kind": "abacus",
    "institution": "Sample Bank",
    "opening": -2500,
    "closing": -4000,
    "rows": [
      {
        "date": "2026-09-03",
        "narration": "SAMPLE MERCHANT",
        "withdrawal": 1500,
        "deposit": 0,
        "balance": null
      }
    ]
  }
}
```

`preset` is the `name` of the entry in `data/user-config/import-presets.json`
that the prompt names. If the prompt says the account has no preset yet, ask
the user for a display name, the ledger account (`base_account`), whether it is
a credit card, and which `custom_mappings_filenames` to use, then add the entry
following `user-config.example/import-presets.json`. A preset used only for
freeform transactions needs no `custom_statement_parser_path`. `source_name` is
a short label that appears in the result and in error messages.

## 4. Import

With the dev server running, post the request. `SAPPORTA_API_URL` and
`SAPPORTA_API_TOKEN` come from the repository's mise environment. If the token
is empty, ask the user to create an agent access token from their account page
in the app.

```bash
curl -sS -X POST "$SAPPORTA_API_URL/api/import-draft/abacus" \
  -H "Authorization: Bearer $SAPPORTA_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @tmp/freeform-transactions/<file>.json
```

The import only creates Draft transactions; it never posts to the books. It
runs the same checks as a statement file import: the balances must add up,
rows already in Drafts or in the books are skipped, and rows on or before the
account's last confirmed balance are skipped.

## 5. Show the result

The response is JSON; read it and tell the user what happened in plain words.

- **200**: `preset_name`, `base_account`, `is_credit_card`, and `result`. In
  `result`, `draft_transaction_count` is the number of new drafts and
  `transaction_count` the number of rows sent. The other counts say why the
  remaining rows were skipped. `balance_metadata` gives the opening and closing
  used, `statement_period` the date range, `reconciliation_checkpoint` the
  account's last confirmed balance, and `hledger_journal` the draft entries.
  Show a credit card's balances as amounts owed. Point the user to Draft entries
  in the app to review the new rows.
- **400 with `code: "BAD_REQUEST"`**: the request does not match the contract;
  `details` lists each problem with its path. Fix the JSON and post again.
- **Any other error**: the body has an `error` code, a `message`, and often
  `detail`, `hint`, and the numbers behind the failure. Explain it to the user.
  After a balance mismatch, go back to step 2 with the user instead of adjusting
  the rows. Do not retry with changed data unless the user agrees to the change.
