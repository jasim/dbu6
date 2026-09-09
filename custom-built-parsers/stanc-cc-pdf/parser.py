#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
from __future__ import annotations

"""Standard Chartered credit-card PDF statement -> Abacus JSON.

Usage: uv run parser.py <statement.pdf>
Writes <input-basename>.abacus.json next to the input.
"""
import json
import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path


HEADER_RE = re.compile(
    r"^\s*Date\s+Description\s+Transaction Reference\s+.*Amount \(INR\)\s*$"
)
END_RE = re.compile(r"^\s*REWARDS POINTS SUMMARY\b")
AMOUNT_CELL_RE = re.compile(r"^[\d,]+\.\d{2}(\s+CR)?$", re.IGNORECASE)
TRANSACTION_LINE_RE = re.compile(
    r"^\s*(?P<date>\d{6})\s+(?P<body>.*?)\s+"
    r"(?P<amount>[\d,]+\.\d{2}(?:\s+CR)?)\s*$",
    re.IGNORECASE,
)
DATE_LINE_RE = re.compile(r"^\s*\d{6}\b")
COLUMN_GAP_RE = re.compile(r"\s{2,}")
REFERENCE_CELL_RE = re.compile(r"(?=.*\d)[A-Z0-9]{12,}", re.IGNORECASE)
SUMMARY_LABEL_RE = re.compile(
    r"Previous Balance \(INR\)\s+Payments/Credits \(INR\)\s+Total Payment Due \(INR\)"
)
NUM_RE = re.compile(r"[\d,]+\.\d{2}")
FOOTNOTE_RE = re.compile(
    r"^(?:note\b|important\b|transactions?\s+(?:marked|converted|made)|"
    r"international\s+transactions?\b|forex\b|\*+|#+)",
    re.IGNORECASE,
)


def run_pdftotext(pdf: Path) -> str:
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        subprocess.run(
            ["pdftotext", "-layout", str(pdf), str(tmp_path)],
            check=True,
        )
        return tmp_path.read_text()
    finally:
        tmp_path.unlink(missing_ok=True)


def parse_amount(s: str) -> tuple[float, bool]:
    s = s.strip()
    is_credit = False
    if s.lower().endswith("cr"):
        is_credit = True
        s = s[:-2].strip()
    return float(s.replace(",", "")), is_credit


def parse_ddmmyy(s: str) -> str:
    d, m, y = int(s[0:2]), int(s[2:4]), int(s[4:6])
    return date(2000 + y, m, d).isoformat()


def parse_summary(text: str) -> tuple[float | None, float | None]:
    """(opening, closing) from the summary block — pre-flip, statement convention."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if SUMMARY_LABEL_RE.search(line):
            for j in range(i + 1, min(i + 6, len(lines))):
                nums = NUM_RE.findall(lines[j])
                if len(nums) >= 3:
                    return (
                        float(nums[0].replace(",", "")),
                        float(nums[2].replace(",", "")),
                    )
    return None, None


def parse_transactions(text: str) -> list[dict]:
    lines = text.splitlines()
    start = end = None
    for i, line in enumerate(lines):
        if HEADER_RE.match(line):
            start = i + 1
            break
    if start is None:
        raise ValueError("transaction table header not found")
    for i in range(start, len(lines)):
        if END_RE.match(lines[i]):
            end = i
            break
    if end is None:
        raise ValueError("transaction table terminator (REWARDS POINTS SUMMARY) not found")

    rows: list[dict] = []
    description_start: int | None = None
    may_have_wrapped_narration = False
    for line in lines[start:end]:
        stripped = line.strip()
        if not stripped:
            may_have_wrapped_narration = False
            continue
        match = TRANSACTION_LINE_RE.match(line)
        if match:
            columns = [
                value.strip()
                for value in COLUMN_GAP_RE.split(match.group("body").strip())
                if value.strip()
            ]
            narration = columns[0] if columns else ""
            amount_cell = match.group("amount")
            reference = next(
                (
                    value
                    for value in columns[1:]
                    if REFERENCE_CELL_RE.fullmatch(value)
                ),
                None,
            )
            if not narration or not AMOUNT_CELL_RE.match(amount_cell):
                raise ValueError(f"unrecognized transaction line: {line!r}")
            amount, is_credit = parse_amount(amount_cell)
            rows.append(
                {
                    "date": parse_ddmmyy(match.group("date")),
                    "narration": narration,
                    "withdrawal": 0.0 if is_credit else amount,
                    "deposit": amount if is_credit else 0.0,
                    "balance": None,
                    "source_reference": reference,
                }
            )
            description_start = match.start("body")
            may_have_wrapped_narration = True
            continue
        if DATE_LINE_RE.match(line):
            raise ValueError(f"unrecognized transaction line: {line!r}")
        if (
            may_have_wrapped_narration
            and rows
            and description_start is not None
            and not FOOTNOTE_RE.match(stripped)
            and not COLUMN_GAP_RE.search(stripped)
            and abs((len(line) - len(line.lstrip())) - description_start) <= 1
        ):
            rows[-1]["narration"] = (
                rows[-1]["narration"] + " " + stripped
            ).strip()
        may_have_wrapped_narration = False
    return rows


def validate(
    rows: list[dict], opening: float | None = None, closing: float | None = None
) -> None:
    if not rows:
        raise ValueError("no transactions parsed")
    for i, r in enumerate(rows):
        w, d = r["withdrawal"], r["deposit"]
        if w < 0 or d < 0:
            raise ValueError(f"row {i}: negative withdrawal/deposit ({w}, {d})")
        pos = (w > 0, d > 0)
        if pos == (False, False) or pos == (True, True):
            raise ValueError(f"row {i}: withdrawal/deposit XOR violated ({w}, {d})")
        date.fromisoformat(r["date"])
    if opening is not None and closing is not None:
        activity = sum(r["deposit"] - r["withdrawal"] for r in rows)
        computed = round(opening + activity, 2)
        if abs(computed - closing) > 0.005:
            raise ValueError(
                "statement arithmetic mismatch: "
                f"opening {opening} + activity {activity:.2f} = {computed}, "
                f"but closing is {closing}"
            )


def main() -> None:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <statement.pdf>", file=sys.stderr)
        sys.exit(2)
    pdf = Path(sys.argv[1]).resolve()
    if pdf.suffix.lower() != ".pdf":
        sys.exit(f"expected a .pdf input file: {pdf}")
    if not pdf.is_file():
        sys.exit(f"not found: {pdf}")
    text = run_pdftotext(pdf)
    rows = parse_transactions(text)
    opening_raw, closing_raw = parse_summary(text)
    # Liabilities are negative in the ledger; statement prints them as positive.
    opening = -opening_raw if opening_raw is not None else None
    closing = -closing_raw if closing_raw is not None else None
    validate(rows, opening, closing)
    out = {
        "kind": "abacus",
        "opening": opening,
        "closing": closing,
        "rows": rows,
    }
    out_path = pdf.with_suffix(".abacus.json")
    out_path.write_text(json.dumps(out, indent=2))
    print(
        f"wrote {out_path} ({len(rows)} rows, "
        f"opening={opening}, closing={closing})"
    )


if __name__ == "__main__":
    main()
