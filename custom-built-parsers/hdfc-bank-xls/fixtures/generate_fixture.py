#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlwt==1.3.0"]
# ///
from __future__ import annotations

"""Build the sanitized HDFC bank-statement XLS fixture.

The real netbanking export is a BIFF8 workbook, so the fixture has to be one
too. This script lays out the same cells the bank emits (letterhead, asterisk
frame, header, mask row, transactions, STATEMENT SUMMARY, footer) with
invented data, and `parser_test.py` imports it to build mutated variants in
memory.

Usage: uv run generate_fixture.py            # rewrites sanitized-statement.xls
"""

from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import xlwt


HERE = Path(__file__).resolve().parent
FIXTURE_PATH = HERE / "sanitized-statement.xls"

MASK_ROW = [
    "********",
    "**********************************",
    "************",
    "********",
    "******************",
    "******************",
    "******************",
]
TOP_RULE = "*" * 188
BOTTOM_RULE = "*" * 129

# Withdrawal/deposit rows as (Date, Narration, Chq./Ref.No., Value Dt, withdrawal, deposit).
# Anonymized per AGENTS.md: whole-number amounts, `050505` in every numeric
# identifier, `NOPII` / `sample` for stripped text. The opening balance and
# every running balance stay positive.
SAMPLE_TRANSACTIONS: list[tuple[str, str, str, str, Optional[str], Optional[str]]] = [
    ("01/07/26", "IB BILLPAY DR-HDFCSI-050505XXXXXX0505", "050505050505ABCD", "01/07/26", "20000", None),
    ("05/07/26", "IMPS-050505050505-NOPII PAYER-FDRL-XXXXXXXXXX0505-sample", "050505050505", "05/07/26", None, "50"),
    (
        "10/07/26",
        "RTGS CR-FDRL0050505-NOPII PAYER-NOPII CUSTOMER-FDRLR050505050505050505",
        "FDRLR050505050505050505",
        "10/07/26",
        None,
        "30000",
    ),
    ("24/07/26", "IMPS-050505050506-NOPII CUSTOMER-SCBL-XXXXXXX0505-IMPS P2A", "050505050506", "24/07/26", None, "1000"),
    (
        "24/07/26",
        "IMPS-050505050507-NOPII CUSTOMER-FDRL-XXXXXXXXXX0505-IMPS TRANSACTION",
        "050505050507",
        "24/07/26",
        "15000",
        None,
    ),
    (
        "26/07/26",
        "UPI-sample merchant-sample@okhdfcbank-HDFC0050505-050505050505-sample payment",
        "0505050505050505",
        "26/07/26",
        "250",
        None,
    ),
    # HDFC books month-end interest on the 1st of the next month with a
    # value date inside the statement period and an all-zero Chq./Ref.No.
    # placeholder (the real export's quirk, not an anonymized value).
    ("01/08/26", "INTEREST PAID TILL 31-JUL-2026", "000000000000000", "31/07/26", None, "12"),
    ("01/08/26", "INTEREST DEBITED TILL 31-JUL-2026", "000000000000000", "31/07/26", "33", None),
]
SAMPLE_OPENING = Decimal("100000")
SAMPLE_PERIOD = ("01/07/2026", "31/07/2026")


def letterhead_rows(period_from: str, period_to: str) -> list[list[Any]]:
    def row(left: str = "", right: str = "") -> list[Any]:
        return [left, "", "", "", right, "", ""]

    return [
        [
            "HDFC BANK Ltd.                                      Page No .:   1"
            "                                          Statement of accounts",
            "", "", "", "", "", "",
        ],
        row(),
        row(),
        row(),
        row("", "Account Branch :NOPII BRANCH"),
        row("MR.     NOPII CUSTOMER NAME", "Address :NOPII Street,"),
        row("NOPII APARTMENTS", "sample Cross,"),
        row("NOPII MAIN ROAD", "sample Nagar"),
        row("NOPII LAYOUT", "City :sample City 050505"),
        row("sample City 050505", "State :sample State"),
        row("sample State INDIA", "Phone no. :0505055555/0505055555"),
        row("", "Email :sample@example.com"),
        row("JOINT HOLDERS :", "OD Limit :50,000.00   Currency :INR"),
        row("", "Cust ID :05050500"),
        row("Nomination  :  Registered", "Account No :05050505050505   Preferred Customer"),
        row(
            f"Statement From  :  {period_from}         To  :  {period_to}",
            "A/C Open Date :05/05/2015",
        ),
        row("", "Account Status :Regular"),
        row("", "RTGS/NEFT IFSC :HDFC0050505   MICR :050505000"),
        row(),
    ]


def statement_rows(
    transactions: list[tuple[str, str, str, str, Optional[str], Optional[str]]],
    *,
    opening: Decimal,
    period: tuple[str, str] = SAMPLE_PERIOD,
) -> list[list[Any]]:
    """Return the full 7-column grid for a statement with computed balances."""
    rows: list[list[Any]] = letterhead_rows(*period)
    rows.append([TOP_RULE, "", "", "", "", "", ""])
    rows.append(
        ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]
    )
    rows.append(list(MASK_ROW))

    running = opening
    debits = Decimal("0.00")
    credits = Decimal("0.00")
    debit_count = 0
    credit_count = 0
    for txn_date, narration, reference, value_date, withdrawal, deposit in transactions:
        w = Decimal(withdrawal) if withdrawal is not None else None
        d = Decimal(deposit) if deposit is not None else None
        if w is not None:
            running -= w
            debits += w
            debit_count += 1
        if d is not None:
            running += d
            credits += d
            credit_count += 1
        rows.append(
            [
                txn_date,
                narration,
                reference,
                value_date,
                float(w) if w is not None else "",
                float(d) if d is not None else "",
                float(running),
            ]
        )

    rows.append(["", "", "", "", "", "", ""])
    rows.append(list(MASK_ROW))
    rows.append([BOTTOM_RULE, "", "", "", "", "", ""])
    rows.append(["", "", "", "", "", "", ""])
    rows.append(["STATEMENT SUMMARY  :-", "", "", "", "", "", ""])
    rows.append(["Opening Balance", "", "", "", "Debits", "Credits", "Closing Bal"])
    rows.append([float(opening), "", "", "", float(debits), float(credits), float(running)])
    rows.append(["", "", "", "", "", "", ""])
    rows.append(["", "", "", "", "Dr Count", "Cr Count", ""])
    rows.append(["", "", "", "", float(debit_count), float(credit_count), ""])
    rows.append(["", "", "", "", "", "", ""])
    rows.append(["", "", "", "", "", "", ""])
    rows.append(
        ["Generated On:", "05-Aug-2026 10:00", "Generated By:", "05050500", "Requesting Branch Code:", "NET", ""]
    )
    rows.append(["", "", "", "", "", "", ""])
    rows.append(["State account branch GSTN:", "050505NOPII0000", "", "", "", "", ""])
    rows.append(
        [
            "HDFC Bank GSTIN number details are available at \n"
            "https://www.hdfcbank.com/personal/making-payments/online-tax-payment/goods-and-service-tax.",
            "", "", "", "", "", "",
        ]
    )
    rows.append(
        ["Registered Office Address: HDFC Bank House, Senapati Bapat Marg, Lower Parel, Mumbai 400013", "", "", "", "", "", ""]
    )
    rows.append(["---  End Of Statement ---", "", "", "", "", "", ""])
    return rows


def workbook_bytes(rows: list[list[Any]], *, sheet_name: str = "Sheet 1") -> bytes:
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
    return statement_rows(SAMPLE_TRANSACTIONS, opening=SAMPLE_OPENING)


def main() -> None:
    FIXTURE_PATH.write_bytes(workbook_bytes(sample_rows()))
    print(f"wrote {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
