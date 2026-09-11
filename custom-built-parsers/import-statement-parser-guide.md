# Deterministic statement parsers

The Import Statement screen can start with any PDF, Excel, CSV, TXT, or JSON statement. If no preset parser is selected, the import uses Nuabase LLM calls to find opening and closing balances, then convert statement lines into Abacus JSON rows.

For recurring statement formats, ask a coding agent to create a deterministic parser under `custom-built-parsers/`. The agent should inspect the real source file, identify a stable fingerprint, write a standalone `parser.py`, and validate row counts, totals, opening and closing balances, and every running balance it can check.

- Check the existing parser fingerprints in `custom-built-parsers/` first.
- Create or update `custom-built-parsers/<parser-name>/fingerprint.md`.
- Create `custom-built-parsers/<parser-name>/parser.py`.
- Make the parser accept one input file and write `<input-basename>.abacus.json`.
- Keep parser output in the Abacus JSON shape accepted by the importer.
- For credit cards, make the parser emit ledger-semantic balances.
- Make the parser emit the account or card number the statement prints about itself as a top-level `account` object (see below).

## Emitted account identifier

Every deterministic parser reports which account or card the statement belongs to, so an import can be matched to the right preset and a statement can never be imported into the wrong account by mistake. The parser already validates that the number is printed as part of its fingerprint; it emits the same value in one canonical form:

```json
{ "kind": "abacus", "account": { "kind": "bank", "identifier": "050505000012" }, "rows": [] }
{ "kind": "abacus", "account": { "kind": "card", "identifier": "050505XXXXXX0505" }, "rows": [] }
```

- `kind` is `bank` for a savings, current, or overdraft account and `card` for a credit card.
- A bank account emits the full printed account number with digits only: strip labels, quotes, spaces, and punctuation.
- A card emits the masked number exactly as printed, with spaces removed and the mask letter uppercased, so `1234 56XX XXXX 7890` becomes `123456XXXXXX7890`. Never unmask or shorten it.
- A parser that cannot see an identifier omits `account` rather than guessing.

The same canonical value goes into `statement_account_identifier` on the matching preset in `data/user-config/import-presets.json`. When several presets share one parser, for example two cards from the same bank, each preset needs its identifier so the importer can tell the statements apart. When a preset carries an identifier and a parsed statement reports a different one, the upload is rejected.

After the parser works, add its path to the matching preset in `data/user-config/import-presets.json`:

- Set `custom_statement_parser_path` to the parser file path, such as `custom-built-parsers/stanc-bank-pdf-table/parser.py`.
- Reopen the Import Statement screen and choose that preset.
- Leave the custom parser checkbox enabled to use deterministic parsing from the UI.

Alternatively, enable **Auto-detect a saved deterministic parser** after selecting files. The server scans only subdirectories that contain both `fingerprint.md` and `parser.py`, tries each parser against a temporary copy of every upload, and validates any generated Abacus JSON. Import continues only when exactly one parser matches each file. No match or multiple matches stop with an actionable error; auto-detection never silently falls back to LLM extraction.

The first parser build is still agentic and investigative. Later imports with that preset are deterministic.
