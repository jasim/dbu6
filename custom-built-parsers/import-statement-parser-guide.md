# Deterministic statement parsers

The Import Statement screen can start with any PDF, Excel, CSV, TXT, or JSON statement. If no preset parser is selected, the import uses Nuabase LLM calls to find opening and closing balances, then convert statement lines into Abacus JSON rows.

For recurring statement formats, ask a coding agent to create a deterministic parser under `custom-built-parsers/`. The agent should inspect the real source file, identify a stable fingerprint, write a standalone `parser.py`, and validate row counts, totals, opening and closing balances, and every running balance it can check.

- Check the existing parser fingerprints in `custom-built-parsers/` first.
- Create or update `custom-built-parsers/<parser-name>/fingerprint.md`.
- Create `custom-built-parsers/<parser-name>/parser.py`.
- Make the parser accept one input file and write `<input-basename>.abacus.json`.
- Keep parser output in the Abacus JSON shape accepted by the importer.
- For credit cards, make the parser emit ledger-semantic balances.

After the parser works, add its path to the matching preset in `data/user-config/import-presets.json`:

- Set `custom_statement_parser_path` to the parser file path, such as `custom-built-parsers/stanc-bank-pdf-table/parser.py`.
- Reopen the Import Statement screen and choose that preset.
- Leave the custom parser checkbox enabled to use deterministic parsing from the UI.

Alternatively, enable **Auto-detect a saved deterministic parser** after selecting files. The server scans only subdirectories that contain both `fingerprint.md` and `parser.py`, tries each parser against a temporary copy of every upload, and validates any generated Abacus JSON. Import continues only when exactly one parser matches each file. No match or multiple matches stop with an actionable error; auto-detection never silently falls back to LLM extraction.

The first parser build is still agentic and investigative. Later imports with that preset are deterministic.
