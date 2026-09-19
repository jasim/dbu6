#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlwt==1.3.0", "reportlab==4.2.5"]
# ///
"""Draw the sample statements `pnpm seed --statements <dir>` describes.

Reads <dir>/statements.json, written by scripts/seed-sample-data.mjs, and
writes each statement next to it in its bank's layout:

- hdfc-bank-xls: the HDFC netbanking BIFF8 workbook, laid out by the
  hdfc-bank-xls parser's own fixture generator.
- hdfc-cc-csv: the HDFC credit card `~|~` CSV that hdfc-cc-csv reads.
- sbi-pdf: a savings-account PDF in a layout no saved parser reads, for the
  agent to write one.

Every name, address and number is a placeholder, per AGENTS.md.

Usage: uv run scripts/sample-statements/render.py <dir>/statements.json
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "custom-built-parsers" / "hdfc-bank-xls" / "fixtures"))
import generate_fixture as hdfc_bank_fixture  # noqa: E402

CENT = Decimal("0.01")


def money(value: float) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def indian(value: Decimal) -> str:
    """12,34,567.89: the last three digits, then pairs."""
    whole, fraction = f"{value:.2f}".split(".")
    sign = "-" if whole.startswith("-") else ""
    whole = whole.lstrip("-")
    head, tail = whole[:-3], whole[-3:]
    pairs = []
    while len(head) > 2:
        pairs.insert(0, head[-2:])
        head = head[:-2]
    grouped = ",".join(([head] if head else []) + pairs + [tail])
    return f"{sign}{grouped}.{fraction}"


def iso(value: str) -> date:
    return date.fromisoformat(value)


def require_ascii(statement: dict[str, Any]) -> None:
    for row in statement["rows"]:
        if not row["narration"].isascii():
            raise ValueError(f"{statement['file']}: non-ASCII narration {row['narration']!r}")


# ── HDFC Bank savings, netbanking XLS ─────────────────────────────────────


def hdfc_bank_xls(statement: dict[str, Any], generated: date) -> bytes:
    short = lambda d: iso(d).strftime("%d/%m/%y")  # noqa: E731
    long = lambda d: iso(d).strftime("%d/%m/%Y")  # noqa: E731
    transactions = [
        (
            short(row["date"]),
            row["narration"],
            row["reference"],
            short(row["date"]),
            f"{money(row['withdrawal'])}" if row["withdrawal"] else None,
            f"{money(row['deposit'])}" if row["deposit"] else None,
        )
        for row in statement["rows"]
    ]
    grid = hdfc_bank_fixture.statement_rows(
        transactions,
        opening=money(statement["opening"]),
        period=(long(statement["from"]), long(statement["to"])),
    )
    for row in grid:
        if row[0] == "Generated On:":
            row[1] = generated.strftime("%d-%b-%Y 10:00")
    closing = grid[[r[0] for r in grid].index("Opening Balance") + 1][6]
    if money(closing) != money(statement["closing"]):
        raise ValueError(f"{statement['file']}: closes on {closing}, expected {statement['closing']}")
    return hdfc_bank_fixture.workbook_bytes(grid)


# ── HDFC credit card, billed-statement CSV ────────────────────────────────


def hdfc_cc_csv(statement: dict[str, Any], generated: date) -> bytes:
    d = "~|~"
    statement_date = iso(statement["to"])
    opening = money(statement["opening"])
    payments = sum((money(r["deposit"]) for r in statement["rows"]), Decimal("0.00"))
    purchases = sum((money(r["withdrawal"]) for r in statement["rows"]), Decimal("0.00"))
    total = opening - payments + purchases
    if total != money(statement["closing"]):
        raise ValueError(f"{statement['file']}: dues {total}, expected {statement['closing']}")
    minimum = max(Decimal("0.00"), (total * Decimal("0.05")).quantize(Decimal("1"), rounding=ROUND_HALF_UP).quantize(CENT))
    limit = Decimal("500000.00")
    cardholder = "NOPII CARDHOLDER "

    rows = []
    earned = 0
    per_day: dict[str, int] = {}
    for row in statement["rows"]:
        nth = per_day.get(row["date"], 0)
        per_day[row["date"]] = nth + 1
        when = f"{iso(row['date']).strftime('%d/%m/%Y')} {10 + nth:02d}:00:00"
        if row["deposit"]:
            amount, kind, reward = money(row["deposit"]), "Cr", ""
        else:
            amount, kind = money(row["withdrawal"]), ""
            points = int(amount // 100)
            earned += points
            reward = f"+ {points}"
        rows.append(d.join(["Domestic", cardholder, when, row["narration"], indian(amount), kind, reward, ""]))

    lines = [
        f"Name{d}{cardholder}",
        f"Address{d}NOPII STREET SAMPLE LAYOUT ",
        f"Address{d}SAMPLE CITY-050505 KAR",
        f"Customer GSTN{d} ",
        f"Payment Due Date{d}{(statement_date + timedelta(days=20)).strftime('%d/%m/%Y')} ",
        f"Statement Date{d}{statement_date.strftime('%d/%m/%Y')} ",
        f"Total Amount Due{d}{indian(total)} ",
        f"Minimum Amount Due{d}{indian(minimum)} ",
        f"Credit Limit{d}{indian(limit)} ",
        f"Available Limit{d}{indian(limit - total)} ",
        f"Available Cash limit{d}{indian(Decimal('200000.00'))} ",
        "",
        "Account Summary ",
        d.join(["Opening Bal", "-", "Payment / Credit", "+", "Purchases / Debits", "+", "Finance Charges", "=", "Total Dues "]),
        d.join([indian(opening), "-", indian(payments), "+", indian(purchases), "+", "0.00", "=", f"{indian(total)} "]),
        "",
        "Card No: 0505 05XX XXXX 0505 ",
        "",
        "AAN: 0505050505050505050 ",
        "",
        "Past Dues (if any) ",
        d.join(["Overlimit", "3 Months", "2 Months", "1 Month", " Current Dues", "Minimum Amount Due "]),
        d.join(["0.00", "0.00", "0.00", "0.00", indian(total), f"{indian(minimum)} "]),
        "",
        "Domestic / International Transactions",
        d.join(["Transaction type", "Primary / Addon Customer Name", "DATE", "Description", "AMT", "Debit /Credit", "REWARDS", ""]),
        *rows,
        "",
        "Reward Points Summary",
        d.join([
            "Opening Balance", "Feature + Bonus Reward Points Earned", "Disbursed", "Adjusted/Lapsed",
            "Closing Balance", "Points expiring in next 30 days", "Points expiring in next 60 days ",
        ]),
        d.join(["1,000", f"{earned:,}", "0", "0", f"{1000 + earned:,}", "0", "0 "]),
        "",
        "Registered Office Address: HDFC Bank Cards Division, NOPII Street, sample City - 050505. ",
    ]
    return ("\r\n".join(lines) + "\r\n").encode("ascii")


# ── SBI savings, account statement PDF ────────────────────────────────────


def sbi_pdf(statement: dict[str, Any], generated: date) -> bytes:
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    day = lambda d: iso(d).strftime("%-d %b %Y")  # noqa: E731
    title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=14, spaceAfter=2)
    subtitle = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=10, spaceAfter=8)
    small = ParagraphStyle("small", fontName="Helvetica", fontSize=7.5, textColor=colors.HexColor("#555555"))

    opening = money(statement["opening"])
    details = [
        ["Account Name", ": NOPII CUSTOMER NAME"],
        ["Address", ": NOPII Street, sample Nagar, sample City - 050505"],
        ["Date", f": {generated.strftime('%-d %b %Y')}"],
        ["Account Number", ": 00000050505050505"],
        ["Account Description", ": SAVINGS ACCOUNT"],
        ["Branch", ": NOPII BRANCH"],
        ["IFS Code", ": SBIN0050505"],
        ["MICR Code", ": 050505002"],
        ["Balance as on " + day(statement["from"]), f": {indian(opening)}"],
    ]
    header = ["Txn Date", "Value\nDate", "Description", "Ref No./Cheque\nNo.", "Branch\nCode", "Debit", "Credit", "Balance"]
    body = [
        [
            day(row["date"]),
            day(row["date"]),
            row["narration"],
            row["reference"],
            "05050",
            indian(money(row["withdrawal"])) if row["withdrawal"] else "",
            indian(money(row["deposit"])) if row["deposit"] else "",
            indian(money(row["balance"])),
        ]
        for row in statement["rows"]
    ]

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4), leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
        title="Account Statement", author="State Bank of India",
    )
    details_table = Table(details, colWidths=[45 * mm, 150 * mm], hAlign="LEFT")
    details_table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
    ]))
    txns = Table([header, *body], colWidths=[24 * mm, 24 * mm, 84 * mm, 34 * mm, 16 * mm, 26 * mm, 26 * mm, 30 * mm], repeatRows=1)
    txns.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef7")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9aa7b8")),
        ("ALIGN", (5, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    doc.build([
        Paragraph("State Bank of India", title),
        Paragraph(
            f"Account Statement from {day(statement['from'])} to {day(statement['to'])}", subtitle
        ),
        details_table,
        Spacer(1, 6 * mm),
        txns,
        Spacer(1, 5 * mm),
        Paragraph("**This is a computer generated statement and does not require a signature.", small),
        Paragraph("Please do not share your ATM, debit or credit card number, PIN or OTP with anyone.", small),
    ])
    return buffer.getvalue()


LAYOUTS: dict[str, Callable[[dict[str, Any], date], bytes]] = {
    "hdfc-bank-xls": hdfc_bank_xls,
    "hdfc-cc-csv": hdfc_cc_csv,
    "sbi-pdf": sbi_pdf,
}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1]).resolve()
    for statement in json.loads(source.read_text()):
        require_ascii(statement)
        # Downloaded two days after the period closes.
        generated = iso(statement["to"]) + timedelta(days=2)
        (source.parent / statement["file"]).write_bytes(LAYOUTS[statement["layout"]](statement, generated))
        print(f"  wrote {statement['file']}")


if __name__ == "__main__":
    main()
