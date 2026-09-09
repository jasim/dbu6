#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.10"
# dependencies = ["pdfplumber"]
# ///
"""Parse Standard Chartered Bank PDF statement → Abacus JSON.

Usage: uv run parser.py <stanc-statement.pdf>
Writes <basename>.abacus.json next to the input PDF.
"""
import csv
import json
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

EXTRACT_TOOL = Path.home() / "m/a/code/tools/pdf-extract/extract-table-from-pdf.py"


def num(s: str) -> float:
    s = (s or "").strip().replace(",", "")
    return float(s) if s else 0.0


def collapse(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()


def parse_date(s: str) -> str:
    return datetime.strptime(s.strip(), "%d %b %Y").date().isoformat()


def extract_csv(pdf: Path) -> Path:
    subprocess.run(
        ["uv", "run", str(EXTRACT_TOOL), str(pdf)],
        check=True,
        cwd=pdf.parent,
    )
    csv_path = pdf.with_name(f"{pdf.stem}-1.csv")
    if not csv_path.exists():
        raise FileNotFoundError(f"extract-table did not produce {csv_path}")
    return csv_path


def parse_csv(csv_path: Path):
    rows = []
    opening = None
    closing = None
    with csv_path.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        # Sanity: shape we expect
        if len(header) != 7 or header[2].strip().lower() != "description":
            raise ValueError(f"unexpected header: {header}")
        for r in reader:
            if len(r) != 7:
                continue
            txn_date, _value_date, desc, _cheque, deposit, withdrawal, balance = r
            desc_clean = collapse(desc)
            if desc_clean == "BALANCE FORWARD":
                opening = num(balance)
                continue
            if desc_clean.lower() == "total":
                continue
            if not txn_date.strip():
                continue
            d = num(deposit)
            w = num(withdrawal)
            bal = num(balance) if balance.strip() else None
            row = {
                "date": parse_date(txn_date),
                "narration": desc_clean,
                "withdrawal": w,
                "deposit": d,
                "balance": bal,
            }
            rows.append(row)
            closing = bal if bal is not None else closing
    return rows, opening, closing


def validate(rows):
    if not rows:
        raise ValueError("no transactions parsed")
    for i, r in enumerate(rows):
        w, d = r["withdrawal"], r["deposit"]
        if w < 0 or d < 0:
            raise ValueError(f"row {i}: negative w/d ({w}, {d})")
        pos = (w > 0, d > 0)
        if pos == (False, False) or pos == (True, True):
            raise ValueError(f"row {i}: XOR violated ({w}, {d}) — {r['narration'][:60]}")
        date.fromisoformat(r["date"])


def main():
    if len(sys.argv) != 2:
        print("usage: parser.py <stanc-statement.pdf>", file=sys.stderr)
        sys.exit(2)
    pdf = Path(sys.argv[1]).resolve()
    if pdf.suffix.lower() != ".pdf":
        sys.exit(f"expected a .pdf input file: {pdf}")
    if not pdf.is_file():
        sys.exit(f"not found: {pdf}")
    csv_path = extract_csv(pdf)
    rows, opening, closing = parse_csv(csv_path)
    validate(rows)
    out = {"kind": "abacus", "opening": opening, "closing": closing, "rows": rows}
    out_path = pdf.with_suffix(".abacus.json")
    out_path.write_text(json.dumps(out, indent=2))
    print(f"wrote {out_path} — {len(rows)} rows, opening={opening}, closing={closing}")


if __name__ == "__main__":
    main()
