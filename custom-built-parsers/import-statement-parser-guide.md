# Deterministic statement parsers

The Import statements screen imports a statement only when a deterministic parser recognises it: one in the project's `custom-built-parsers/`, or one bundled with dbu6 (`dbu6 docs parsers` lists those and gives the full conventions). For a statement format no parser reads yet, ask a coding agent to create one. The agent should inspect the real source file, identify a stable fingerprint, write a standalone `parser.py`, and validate row counts, totals, opening and closing balances, and every running balance it can check.

- Check the existing parser fingerprints first, the project's and the bundled ones.
- Create or update `custom-built-parsers/<parser-name>/fingerprint.md` in the project. Never write under `node_modules`.
- Create `custom-built-parsers/<parser-name>/parser.py` beside it.
- Build the output through the bundled `shared` package (`from shared import abacus`): rows with `abacus.row`, the document with `abacus.statement`, and the command line with `abacus.run_cli`, which writes `<input-basename>.abacus.json` next to the input.
- Keep parser output in the Abacus JSON shape accepted by the importer; the shared module (`shared/abacus.py`) is its Python definition, and dbu6's importer validates the same shape.
- For credit cards, pass printed balances through `abacus.ledger_balance` so the emitted values are ledger-semantic.
- Make the parser emit the account or card number the statement prints about itself as a top-level `account` object, and the institution's name as printed as a top-level `institution` string (see below).

## Emitted account identifier

Every deterministic parser reports which account or card the statement belongs to, so an import can be matched to the right account in the import presets and a statement can never be imported into the wrong account by mistake. The parser already validates that the number is printed as part of its fingerprint; it emits the same value in one canonical form, produced by `abacus.bank_account(...)` or `abacus.card_account(...)`:

```json
{ "kind": "abacus", "account": { "kind": "bank", "identifier": "050505000012" }, "rows": [] }
{ "kind": "abacus", "account": { "kind": "card", "identifier": "050505XXXXXX0505" }, "rows": [] }
```

- `kind` is `bank` for a savings, current, or overdraft account and `card` for a credit card.
- A bank account emits the full printed account number with digits only: strip labels, quotes, spaces, and punctuation.
- A card emits the masked number exactly as printed, with spaces removed and the mask letter uppercased, so `1234 56XX XXXX 7890` becomes `123456XXXXXX7890`. Never unmask or shorten it.
- A parser that cannot see an identifier omits `account` rather than guessing.

## Emitted institution name

Alongside `account`, a parser emits the bank or card issuer's name as a top-level `institution` string:

```json
{ "kind": "abacus", "institution": "HDFC BANK Ltd.", "account": { "kind": "bank", "identifier": "050505000012" }, "rows": [] }
```

- Copy the name exactly as the statement prints it, trimmed of surrounding whitespace only. Keep its case, punctuation, and any suffix such as `Ltd.` or `Cards Division`. Do not normalize it to a canonical bank name.
- Two statements from the same institution may print slightly different names, so `institution` is lookup text for finding a preset, never an identifier. Matching on it must tolerate those variations; the `account` identifier is the exact match.
- Emit `null` (or omit the field) when the statement prints no institution name. Never infer it from the parser's own knowledge of which bank it handles.

The import presets group accounts by institution: each institution lists the `parsers` that read its statements and its `accounts`, and each account lists the identifiers its statements print in `account_identifiers`, in this same canonical form. A statement goes to the institution that lists its parser, then to the account there that lists the identifier it reported. When an institution has several accounts, for example two cards from the same bank, every account needs its identifiers so the importer can tell the statements apart; an institution with one account and no identifiers takes every statement its parsers read. A statement whose identifier no account of its institution lists is rejected.

After the parser works, tie it to its account in the import presets (`dbu6 docs books` gives the calls, under "Import presets"):

- Add the parser's directory name alone, such as `stanc-bank-pdf-table`, to the institution with `add_parser`, or create the institution with `add_institution` and its account with `add_account`. The project's `custom-built-parsers/` is searched before the parsers bundled with dbu6.
- Put the identifier the parser emits in the account's `account_identifiers`, with `update_account` (sending the whole list) when the account is already there.
- Drop the statement into the Import statements screen again.

The server scans only subdirectories that contain both `fingerprint.md` and `parser.py`, tries each parser whose fingerprint lists the upload's extension against a temporary copy of the file, and validates any generated Abacus JSON. A file imports only when exactly one parser recognises it, one institution lists that parser, and one of its accounts claims the account the statement reports. Otherwise nothing in the batch is imported, and each file that could not be placed says why.

The first parser build is still agentic and investigative. Later imports of that account's statements are deterministic.
