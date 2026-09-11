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
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared import abacus  # noqa: E402


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


def build(pdf: Path) -> tuple[abacus.AbacusStatement, str]:
    if pdf.suffix.lower() != ".pdf":
        raise ValueError(f"expected a .pdf input file: {pdf}")
    if not pdf.is_file():
        raise ValueError(f"not found: {pdf}")
    csv_path = extract_csv(pdf)
    rows, opening, closing = parse_csv(csv_path)
    statement = abacus.statement(
        rows=[abacus.row(**r) for r in rows],
        opening=opening,
        closing=closing,
        # The extract-table CSV carries neither the account number nor the
        # bank's name, so neither can be reported.
        account=None,
        institution=None,
    )
    return statement, f"{len(rows)} rows, opening={opening}, closing={closing}"


if __name__ == "__main__":
    abacus.run_cli(build, usage="<stanc-statement.pdf>", error_types=(subprocess.CalledProcessError,))
