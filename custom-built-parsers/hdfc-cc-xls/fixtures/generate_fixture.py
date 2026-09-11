#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlwt==1.3.0"]
# ///
from __future__ import annotations

"""Build the sanitized HDFC credit-card billed-statement XLS fixture.

The real download is a BIFF8 workbook with one sheet named `Statement`, so
the fixture has to be one too. This script lays out the same cells the bank
emits (name/address block, masked card number, due dates, Account Summary,
transaction table, Reward Points Summary) with invented data, and
`parser_test.py` imports it to build mutated variants in memory.

Usage: uv run generate_fixture.py            # rewrites sanitized-statement.xls
"""

from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import xlwt


HERE = Path(__file__).resolve().parent
FIXTURE_PATH = HERE / "sanitized-statement.xls"

COLUMN_COUNT = 24  # A:X, matching the populated extent of the real export
CARD_NUMBER_CELL = "Credit Card No.: 050505XXXXXX0505"
ALTERNATE_ACCOUNT_CELL = "Alternate Account Number: 0505050505050505"

# Transaction rows as (type, date & time, description, rewards, amount, Debit / Credit).
# Anonymized per AGENTS.md: whole-number amounts, `050505` in every numeric
# identifier, `sample` / `NOPII` for stripped text. Domestic rows come first,
# then International, each group oldest-first, as the bank prints them.
SAMPLE_TRANSACTIONS: list[tuple[str, str, str, str, str, str]] = [
    ("Domestic", "15/05/2026 / 10:00", "SAMPLE MERCHANT ONE BANGALORE", "+ 20", "1,000.00", ""),
    (
        "Domestic",
        "20/05/2026 / 00:00",
        "NOPII PAYMENT RECEIVED (Ref# 05050500000000000000001)",
        "",
        "500.00",
        "Cr",
    ),
    (
        "Domestic",
        "18/06/2026 / 00:00",
        "OFFUS EMI,INT NBR:01,0 0000050505050 (Ref# 05050500000000000000002)",
        "",
        "30.00",
        "",
    ),
    ("International", "16/05/2026 / 09:00", "Sample Online www.sample  USD2.40", "+ 4", "200.00", "Dr"),
    (
        "International",
        "10/06/2026 / 00:00",
        "SAMPLE REFUND AMSTERDAM (Ref# VT050505000000000000004)",
        "- 2",
        "100.00",
        "Cr",
    ),
]
SAMPLE_SUMMARY = {
    "opening": "1,000.37",
    "payment_credit": "600.00",
    "purchases_debits": "1,200.00",
    "finance_charges": "30.00",
    # Exact closing 1,630.37 is displayed rounded to the rupee.
    "total_dues": "1,630.00",
}
SAMPLE_STATEMENT_DATE = "18 Jun, 2026"
SAMPLE_PAYMENT_DUE_DATE = "08 Jul, 2026"
SAMPLE_CUSTOMER = "SAMPLE CARDHOLDER"


def blank_row() -> list[Any]:
    return [""] * COLUMN_COUNT


def row_with(cells: dict[int, Any]) -> list[Any]:
    row = blank_row()
    for column, value in cells.items():
        row[column] = value
    return row


def statement_rows(
    transactions: list[tuple[str, str, str, str, str, str]],
    *,
    summary: dict[str, str] = SAMPLE_SUMMARY,
    statement_date: str = SAMPLE_STATEMENT_DATE,
    payment_due_date: str = SAMPLE_PAYMENT_DUE_DATE,
    card_number_cell: str = CARD_NUMBER_CELL,
) -> list[list[Any]]:
    """Return the full A:X grid for a billed statement."""
    rows: list[list[Any]] = [
        row_with({0: "Name", 4: SAMPLE_CUSTOMER}),
        row_with({0: "Address", 4: "1 SAMPLE STREET SAMPLE LAYOUT"}),
        row_with({0: "Address", 4: "BANGALORE-560001 KAR", 13: card_number_cell}),
        row_with({13: ALTERNATE_ACCOUNT_CELL}),
        blank_row(),
        row_with({0: "Payment Due Date", 4: payment_due_date}),
        row_with({0: "Statement Date", 4: statement_date}),
        row_with({0: "Total Amount Due", 4: summary["total_dues"]}),
        row_with({0: "Minimum Amount Due", 4: "100.00"}),
        row_with({0: "Credit Limit", 4: "5,00,000.00"}),
        row_with({0: "Available Limit", 4: "4,98,370.00"}),
        row_with({0: "Available Cash limit", 4: "2,00,000.00"}),
        blank_row(),
        row_with({0: "Account Summary"}),
        row_with(
            {
                0: "Opening Bal",
                5: "Payment / Credit",
                9: "+",
                10: "Purchases / Debits",
                14: "+",
                15: "Finance Charges",
                19: "=",
                20: "Total Dues",
            }
        ),
        row_with(
            {
                0: summary["opening"],
                5: summary["payment_credit"],
                10: summary["purchases_debits"],
                15: summary["finance_charges"],
                20: summary["total_dues"],
            }
        ),
        blank_row(),
        row_with({0: "Domestic / International Transactions"}),
        row_with(
            {
                0: "Transaction type",
                4: "Primary / Addon Customer Name",
                9: "Date & Time",
                12: "Description",
                18: "REWARDS",
                20: "AMT",
                23: "Debit / Credit",
            }
        ),
    ]
    for transaction_type, timestamp, description, rewards, amount, direction in transactions:
        rows.append(
            row_with(
                {
                    0: transaction_type,
                    4: SAMPLE_CUSTOMER,
                    9: timestamp,
                    12: description,
                    18: rewards,
                    20: amount,
                    23: direction,
                }
            )
        )
    rows.append(blank_row())
    rows.append(row_with({0: "Reward Points Summary"}))
    rows.append(
        row_with(
            {
                0: "Opening Balance",
                4: "Feature + Bonus Reward Points Earned",
                9: "Disbursed",
                12: "Adjusted/Lapsed",
                18: "Closing Balance",
            }
        )
    )
    rows.append(row_with({0: "500", 4: "22", 9: "0", 12: "0", 18: "522"}))
    rows.append(blank_row())
    rows.append(row_with({0: "State account branch GSTN: 050505NOPII0000 [ State code : sample ]"}))
    rows.append(
        row_with(
            {
                0: "Registered Office Address: HDFC Bank Cards Division, "
                "Door No 050505, sample Road, sample City - 050505."
            }
        )
    )
    return rows


def workbook_bytes(rows: list[list[Any]], *, sheet_name: str = "Statement") -> bytes:
    """Serialize a grid to BIFF8 bytes; empty strings are left as blank cells."""
    book = xlwt.Workbook()
    sheet = book.add_sheet(sheet_name)
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if value == "" or value is None:
                continue
            sheet.write(r, c, value)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def sample_rows() -> list[list[Any]]:
    return statement_rows(SAMPLE_TRANSACTIONS)


def main() -> None:
    FIXTURE_PATH.write_bytes(workbook_bytes(sample_rows()))
    print(f"wrote {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
