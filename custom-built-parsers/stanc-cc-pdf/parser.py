#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
from __future__ import annotations

"""Standard Chartered credit-card PDF statement -> Abacus JSON.

Usage: uv run parser.py <statement.pdf>
Writes <input-basename>.abacus.json next to the input.
"""
import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared import abacus  # noqa: E402


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
# The header prints the card number next to (or on the lines just below) the
# "Credit Card Account Number" label as a 16-character masked number, with or
# without the 4-4-4-4 spacing. The emitted identifier is the spaced-out form
# collapsed, e.g. `0505 05XX XXXX 0505` -> `050505XXXXXX0505`.
CARD_ACCOUNT_LABEL_RE = re.compile(r"Credit Card Account Number", re.IGNORECASE)
CARD_NUMBER_RE = re.compile(
    r"(?<![0-9X])[0-9]{4} ?[0-9]{2}X{2} ?X{4} ?[0-9]{4}(?![0-9X])", re.IGNORECASE
)
CARD_NUMBER_WINDOW_LINES = 4
# The issuer's printed name, emitted verbatim as `institution`: the first
# occurrence of "Standard Chartered" with any directly attached suffix such
# as "Bank" or "Bank, India". Absent text yields null rather than a guess.
INSTITUTION_RE = re.compile(
    r"Standard Chartered(?: Bank)?(?:,? (?:India|Limited|Ltd\.?))*", re.IGNORECASE
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


def parse_institution(text: str) -> str | None:
    match = INSTITUTION_RE.search(text)
    return match.group(0) if match else None


def parse_card_number(text: str) -> abacus.AbacusAccount:
    """The masked card number printed by the "Credit Card Account Number" label.

    Exactly one distinct masked number must appear on the label line or within
    the next few lines; anything else is a fingerprint mismatch.
    """
    lines = text.splitlines()
    label_lines = [i for i, line in enumerate(lines) if CARD_ACCOUNT_LABEL_RE.search(line)]
    if not label_lines:
        raise ValueError("'Credit Card Account Number' label not found")
    found: list[str] = []
    for i in label_lines:
        for line in lines[i : i + 1 + CARD_NUMBER_WINDOW_LINES]:
            for match in CARD_NUMBER_RE.finditer(line):
                identifier = abacus.card_account(match.group(0)).identifier
                if identifier not in found:
                    found.append(identifier)
    if len(found) != 1:
        raise ValueError(
            "expected exactly one masked card number near the 'Credit Card Account "
            f"Number' label, found {len(found)}"
        )
    return abacus.card_account(found[0])


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
    """Statement arithmetic in ledger semantics; row shape is checked by `abacus.row`."""
    if not rows:
        raise ValueError("no transactions parsed")
    if opening is not None and closing is not None:
        activity = sum(r["deposit"] - r["withdrawal"] for r in rows)
        computed = round(opening + activity, 2)
        if abs(computed - closing) > 0.005:
            raise ValueError(
                "statement arithmetic mismatch: "
                f"opening {opening} + activity {activity:.2f} = {computed}, "
                f"but closing is {closing}"
            )


def to_abacus(
    rows: list[dict],
    opening: float | None,
    closing: float | None,
    account: abacus.AbacusAccount,
    institution: str | None,
) -> abacus.AbacusStatement:
    return abacus.statement(
        rows=[abacus.row(**r) for r in rows],
        opening=opening,
        closing=closing,
        account=account,
        institution=institution,
    )


def build(pdf: Path) -> tuple[abacus.AbacusStatement, str]:
    if pdf.suffix.lower() != ".pdf":
        raise ValueError(f"expected a .pdf input file: {pdf}")
    if not pdf.is_file():
        raise ValueError(f"not found: {pdf}")
    text = run_pdftotext(pdf)
    account = parse_card_number(text)
    institution = parse_institution(text)
    rows = parse_transactions(text)
    opening_raw, closing_raw = parse_summary(text)
    # Liabilities are negative in the ledger; statement prints them as positive.
    opening = -opening_raw if opening_raw is not None else None
    closing = -closing_raw if closing_raw is not None else None
    validate(rows, opening, closing)
    statement = to_abacus(rows, opening, closing, account, institution)
    return statement, f"{len(rows)} rows, opening={opening}, closing={closing}"


if __name__ == "__main__":
    abacus.run_cli(build, usage="<statement.pdf>", error_types=(subprocess.CalledProcessError,))
