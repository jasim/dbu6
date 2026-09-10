#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlwt==1.3.0"]
# ///
from __future__ import annotations

"""Build the sanitized Federal Bank statement XLS fixture.

The real FedNet export is a BIFF8 workbook, so the fixture has to be one too.
This script lays out the same cells the bank emits (name/address block,
account row, statement-date row, header, transactions, footer) with invented
data, and `parser_test.py` imports it to build mutated variants in memory.

Usage: uv run generate_fixture.py            # rewrites sanitized-statement.xls
"""

from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import xlwt


HERE = Path(__file__).resolve().parent
FIXTURE_PATH = HERE / "sanitized-statement.xls"

COLUMN_COUNT = 10
HEADER = [
    "Sl. No.",
    "Tran Date",
    "Particulars",
    "",
    "Value Date",
    "Tran Type",
    "Cheque Details",
    "Withdrawal",
    "Deposit",
    "Balance Amount",
]
FOOTER = (
    "This is a computer generated statement which need not normally be signed. "
    "Contents of this statement will be considered correct if no error is "
    "reported within 21 days of the statement date."
)

# Transactions as (Tran Date, Particulars, Tran Type, withdrawal, deposit).
# Anonymized per AGENTS.md: whole-number amounts, `050505` in every numeric
# identifier, `NOPII` / `sample` for stripped text. Every running balance
# stays positive. The mix covers every known reference layout (`UPIOUT`,
# `UPI IN`, `TO ATM`, `FT IMPS/IFI`), a UPIOUT deposit, and rows with no
# recognised reference at all.
SAMPLE_TRANSACTIONS: list[tuple[str, str, str, Optional[str], Optional[str]]] = [
    ("01-07-2026", "UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505", "UPI", "500", None),
    ("01-07-2026", "TO ATM/050505000002/sample CITY 050505\\sample", "ATM", "5000", None),
    ("03-07-2026", "UPIOUT/050505000003/UPI050505sample/0505", "UPI", None, "250"),
    ("05-07-2026", "FT IMPS/IFI/050505000004/NOPII CUSTOMER/sample remark", "IMPS", None, "40000"),
    ("05-07-2026", "UPIOUT/050505000005/q050505@ybl/UPI/0505", "UPI", "1200", None),
    ("10-07-2026", "UPIOUT/050505000006/sample-cafe@okhdfcbank//0000", "UPI", "300", None),
    ("12-07-2026", "UPI IN/050505000007/sample-shop@okicici/sample/0000", "UPI", None, "75"),
    ("20-07-2026", "SMS CHARGES sample", "CHG", "60", None),
    ("31-07-2026", "NEFT/050505000009/NOPII EMPLOYER/sample salary", "NEFT", None, "10000"),
]
SAMPLE_OPENING = Decimal("100000")
SAMPLE_STATEMENT_DATE = "05-08-2026 10:00:00"


def indian_money(value: Decimal) -> str:
    """Format like the export: two decimals, Indian digit grouping (1,00,000.00)."""
    sign = "-" if value < 0 else ""
    whole, fraction = f"{abs(value):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}{whole}.{fraction}"


def letterhead_rows(statement_date: str) -> list[list[Any]]:
    def row(*cells: Any) -> list[Any]:
        return list(cells) + [""] * (COLUMN_COUNT - len(cells))

    return [
        row("Name and address of the account holder:"),
        row("MR."),
        row("NOPII CUSTOMER NAME"),
        row("NOPII HOUSE,sample STREET"),
        row("sample CITY"),
        row("sample STATE"),
        row("INDIA"),
        row("."),
        row(
            "Account No :", "", "050505000012", "CustomerId:", "0505055555",
            "Account Currency:", "INR", "Account Category:", "050505",
        ),
        row("Last", "", "", "One", "Month Transactions", "", "", "Statement Date:", statement_date),
    ]


def statement_rows(
    transactions: list[tuple[str, str, str, Optional[str], Optional[str]]],
    *,
    opening: Decimal,
    statement_date: str = SAMPLE_STATEMENT_DATE,
) -> list[list[Any]]:
    """Return the full 10-column grid for a statement with computed balances."""
    rows: list[list[Any]] = letterhead_rows(statement_date)
    rows.append(list(HEADER))

    running = opening
    for serial, (txn_date, particulars, tran_type, withdrawal, deposit) in enumerate(
        transactions, start=1
    ):
        w = Decimal(withdrawal) if withdrawal is not None else None
        d = Decimal(deposit) if deposit is not None else None
        if w is not None:
            running -= w
        if d is not None:
            running += d
        rows.append(
            [
                float(serial),
                txn_date,
                particulars,
                "",
                txn_date,
                tran_type,
                "",
                indian_money(w) if w is not None else "",
                indian_money(d) if d is not None else "",
                indian_money(running),
            ]
        )

    rows.append([FOOTER] + [""] * (COLUMN_COUNT - 1))
    return rows


def workbook_bytes(rows: list[list[Any]], *, sheet_name: str = "OpTransactionHistoryTpr") -> bytes:
    """Serialize a grid to BIFF8 bytes; empty strings are left as blank cells.

    The merged ranges mirror the real export (name/address block across A:J,
    Particulars across C:D); the parser reads values only, so they are
    cosmetic but keep the fixture structurally faithful.
    """
    book = xlwt.Workbook()
    sheet = book.add_sheet(sheet_name)
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if value == "" or value is None:
                continue
            if c == 0 and r <= 7 and len(row) == COLUMN_COUNT:
                sheet.write_merge(r, r, 0, COLUMN_COUNT - 1, value)
            elif c == 2 and r >= 10 and len(row) == COLUMN_COUNT and row[3] == "":
                sheet.write_merge(r, r, 2, 3, value)
            else:
                sheet.write(r, c, value)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def sample_rows() -> list[list[Any]]:
    return statement_rows(SAMPLE_TRANSACTIONS, opening=SAMPLE_OPENING)


def main() -> None:
    FIXTURE_PATH.write_bytes(workbook_bytes(sample_rows()))
    print(f"wrote {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
