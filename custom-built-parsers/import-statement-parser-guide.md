# Deterministic statement parsers

The Import statements screen imports a statement only when a deterministic parser under `custom-built-parsers/` recognises it. For a statement format no parser reads yet, ask a coding agent to create one. The agent should inspect the real source file, identify a stable fingerprint, write a standalone `parser.py`, and validate row counts, totals, opening and closing balances, and every running balance it can check.

- Check the existing parser fingerprints in `custom-built-parsers/` first.
- Create or update `custom-built-parsers/<parser-name>/fingerprint.md`.
- Create `custom-built-parsers/<parser-name>/parser.py`.
- Build the output through `custom-built-parsers/shared/abacus.py`: rows with `abacus.row`, the document with `abacus.statement`, and the command line with `abacus.run_cli`, which writes `<input-basename>.abacus.json` next to the input.
- Keep parser output in the Abacus JSON shape accepted by the importer; the shared module is its Python definition and `packages/api/modules/statement/` its TypeScript one.
- For credit cards, pass printed balances through `abacus.ledger_balance` so the emitted values are ledger-semantic.
- Make the parser emit the account or card number the statement prints about itself as a top-level `account` object, and the institution's name as printed as a top-level `institution` string (see below).

## Emitted account identifier

Every deterministic parser reports which account or card the statement belongs to, so an import can be matched to the right preset and a statement can never be imported into the wrong account by mistake. The parser already validates that the number is printed as part of its fingerprint; it emits the same value in one canonical form, produced by `abacus.bank_account(...)` or `abacus.card_account(...)`:

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

The same canonical value goes into `statement_account_identifier` on the matching preset in `data/user-config/import-presets.json`. When several presets share one parser, for example two cards from the same bank, each preset needs its identifier so the importer can tell the statements apart. When a preset carries an identifier and a parsed statement reports a different one, the upload is rejected.

After the parser works, add its path to the matching preset in `data/user-config/import-presets.json`:

- Set `custom_statement_parser_path` to the parser file path, such as `custom-built-parsers/stanc-bank-pdf-table/parser.py`.
- Drop the statement into the Import statements screen again.

The server scans only subdirectories that contain both `fingerprint.md` and `parser.py`, tries each parser whose fingerprint lists the upload's extension against a temporary copy of the file, and validates any generated Abacus JSON. A file imports only when exactly one parser recognises it and one preset claims that parser and the account it reports. Otherwise nothing in the batch is imported, and each file that could not be placed says why.

The first parser build is still agentic and investigative. Later imports with that preset are deterministic.
