#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2"]
# ///
from __future__ import annotations

"""Union Bank of India savings/current account statement XLS -> Abacus JSON.

Usage: uv run parser.py <OpTransactionHistoryUX3_XLS...xls>
Writes <statement-basename>.abacus.json next to the input.

The Union Bank of India netbanking "Statement of Account" export is a genuine
BIFF8 (.xls) workbook with one worksheet named 'OpTransactionHistoryUX3_XLS',
ten columns, customer metadata blocks, a record summary row, a table header,
and transaction rows. Every structural anchor below is enforced so that a
different layout is rejected rather than misread.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

import xlrd

from shared import abacus, xls
from shared.xls import (
    cell_value,
    excel_location,
    is_blank,
    require_digits,
    row_is_blank,
)

SHEET_NAME = "OpTransactionHistoryUX3_XLS"
EXPECTED_COLUMN_COUNT = 10

RECORDS_RE = re.compile(r"^Records from (?P<from>[0-9]+) to (?P<to>[0-9]+)\.$")
ROW_DATE_RE = re.compile(
    r"^(?P<d>[0-9]{2})-(?P<m>[0-9]{2})-(?P<y>[0-9]{4})(?: [0-9]{2}:[0-9]{2}:[0-9]{2})?$"
)
MONEY_TEXT_RE = re.compile(
    r"^-?(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+|"
    r"[1-9][0-9]?(?:,[0-9]{2})*,[0-9]{3})\.[0-9]{2}$"
)
CENT = Decimal("0.01")


def require_stripped_text(sheet: xlrd.sheet.Sheet, row: int, column: int, expected: str) -> None:
    actual = cell_value(sheet, row, column)
    if not isinstance(actual, str) or actual.strip() != expected.strip():
        raise ValueError(
            f"{excel_location(row, column)}: fingerprint mismatch; "
            f"expected {expected!r}, got {actual!r}"
        )


def parse_money(value: Any, *, location: str, field: str, allow_negative: bool) -> Decimal:
    """Accept a numeric cell (float/int) or a formatted money string."""
    if isinstance(value, bool):
        raise ValueError(f"{location}: invalid {field} amount {value!r}")
    if isinstance(value, (int, float)):
        amount = Decimal(repr(value))
    elif isinstance(value, str) and MONEY_TEXT_RE.fullmatch(value.strip()):
        try:
            amount = Decimal(value.strip().replace(",", ""))
        except InvalidOperation as exc:
            raise ValueError(f"{location}: invalid {field} amount {value!r}") from exc
    else:
        raise ValueError(
            f"{location}: invalid {field} amount {value!r}; expected a number "
            "or a formatted amount with exactly two decimal places"
        )
    if amount != amount.quantize(CENT):
        raise ValueError(
            f"{location}: {field} amount {value!r} has more than two decimal places"
        )
    if amount < 0 and not allow_negative:
        raise ValueError(f"{location}: negative {field} amount {value!r}")
    return amount.quantize(CENT)


def parse_row_date(value: Any, *, location: str, field: str) -> date:
    """Parse the DD-MM-YYYY [HH:MM:SS] transaction-table dates."""
    if not isinstance(value, str):
        raise ValueError(f"{location}: invalid {field} {value!r}; expected date text")
    match = ROW_DATE_RE.fullmatch(value.strip())
    if not match:
        raise ValueError(f"{location}: invalid {field} {value!r}; expected DD-MM-YYYY format")
    try:
        return date(int(match.group("y")), int(match.group("m")), int(match.group("d")))
    except ValueError as exc:
        raise ValueError(f"{location}: invalid {field} {value!r}: {exc}") from exc


def validate_workbook(book: xlrd.book.Book) -> xlrd.sheet.Sheet:
    sheet = xls.require_single_sheet(book, SHEET_NAME)
    xls.require_column_count(sheet, EXPECTED_COLUMN_COUNT)
    if sheet.nrows < 15:
        raise ValueError(f"expected at least 15 rows, got {sheet.nrows}; fingerprint mismatch")
    return sheet


def parse_metadata(sheet: xlrd.sheet.Sheet) -> dict[str, Any]:
    require_stripped_text(sheet, 0, 1, "Statement of Account")
    institution_raw = cell_value(sheet, 1, 6)
    if not isinstance(institution_raw, str) or institution_raw.strip() != "Union Bank of India":
        raise ValueError(
            f"{excel_location(1, 6)}: expected 'Union Bank of India', got {institution_raw!r}"
        )

    require_stripped_text(sheet, 2, 6, "Branch")
    require_stripped_text(sheet, 3, 6, "Customer Id")
    customer_id = require_digits(sheet, 3, 7, "customer id")

    require_stripped_text(sheet, 4, 1, "CKYC Number")
    require_stripped_text(sheet, 4, 6, "A/C Number")
    account_number = require_digits(sheet, 4, 7, "account number")

    require_stripped_text(sheet, 5, 1, "City")
    require_stripped_text(sheet, 5, 6, "Currency")
    require_stripped_text(sheet, 5, 7, "INR")

    require_stripped_text(sheet, 6, 1, "State")
    require_stripped_text(sheet, 6, 6, "Account Type")
    account_type = cell_value(sheet, 6, 7)
    if not isinstance(account_type, str) or account_type.strip() not in (
        "Current Account",
        "Savings Account",
    ):
        raise ValueError(f"{excel_location(6, 7)}: unexpected account type {account_type!r}")

    require_stripped_text(sheet, 7, 1, "Country")
    require_stripped_text(sheet, 8, 1, "Zip")
    require_stripped_text(sheet, 9, 1, "Mobile No.")
    require_stripped_text(sheet, 10, 1, "Email")
    require_stripped_text(sheet, 11, 1, "Statement Date")
    require_stripped_text(sheet, 11, 6, "Statement From")
    require_stripped_text(sheet, 11, 8, "To")

    rec_val = cell_value(sheet, 12, 1)
    if not isinstance(rec_val, str):
        raise ValueError(f"{excel_location(12, 1)}: expected Records from text, got {rec_val!r}")
    rec_match = RECORDS_RE.fullmatch(rec_val.strip())
    if not rec_match:
        raise ValueError(f"{excel_location(12, 1)}: invalid Records text {rec_val!r}")
    expected_count = int(rec_match.group("to")) - int(rec_match.group("from")) + 1
    require_stripped_text(sheet, 12, 4, "No more records available.")

    # Header row (row 13)
    require_stripped_text(sheet, 13, 1, "Date")
    require_stripped_text(sheet, 13, 2, "Tran Id")
    require_stripped_text(sheet, 13, 3, "Remarks")
    require_stripped_text(sheet, 13, 5, "UTR Number")
    require_stripped_text(sheet, 13, 6, "Instr. Id")
    require_stripped_text(sheet, 13, 7, "Withdrawals")
    require_stripped_text(sheet, 13, 8, "Deposits")
    require_stripped_text(sheet, 13, 9, "Balance")

    return {
        "institution": institution_raw.strip(),
        "account_number": account_number,
        "customer_id": customer_id,
        "expected_count": expected_count,
    }


def parse_transactions(sheet: xlrd.sheet.Sheet, expected_count: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    row = 14
    previous_date: Optional[date] = None

    while row < sheet.nrows and not row_is_blank(sheet, row):
        # Columns 0 (A) and 4 (E) must be blank
        if not is_blank(cell_value(sheet, row, 0)):
            raise ValueError(
                f"{excel_location(row, 0)}: expected blank column A in transaction row"
            )
        if not is_blank(cell_value(sheet, row, 4)):
            raise ValueError(
                f"{excel_location(row, 4)}: expected blank column E in transaction row"
            )

        txn_date = parse_row_date(
            cell_value(sheet, row, 1), location=excel_location(row, 1), field="Date"
        )
        if previous_date is not None and txn_date < previous_date:
            raise ValueError(
                f"{excel_location(row, 1)}: transaction dates are not oldest-first "
                f"({txn_date.isoformat()} after {previous_date.isoformat()})"
            )

        tran_id = cell_value(sheet, row, 2)
        if not isinstance(tran_id, str) or not tran_id.strip():
            raise ValueError(f"{excel_location(row, 2)}: empty or non-text Tran Id")
        source_reference = tran_id.strip()

        remarks = cell_value(sheet, row, 3)
        if not isinstance(remarks, str) or not remarks.strip():
            raise ValueError(f"{excel_location(row, 3)}: empty Remarks")

        utr = cell_value(sheet, row, 5)
        if not is_blank(utr) and not isinstance(utr, str):
            raise ValueError(f"{excel_location(row, 5)}: expected UTR Number text, got {utr!r}")
        instr_id = cell_value(sheet, row, 6)
        if not is_blank(instr_id) and not isinstance(instr_id, (str, int, float)):
            raise ValueError(
                f"{excel_location(row, 6)}: expected Instr. Id text, got {instr_id!r}"
            )

        w_val = cell_value(sheet, row, 7)
        d_val = cell_value(sheet, row, 8)
        withdrawal = (
            Decimal("0.00")
            if is_blank(w_val)
            else parse_money(
                w_val,
                location=excel_location(row, 7),
                field="Withdrawals",
                allow_negative=False,
            )
        )
        deposit = (
            Decimal("0.00")
            if is_blank(d_val)
            else parse_money(
                d_val,
                location=excel_location(row, 8),
                field="Deposits",
                allow_negative=False,
            )
        )
        if (withdrawal > 0) == (deposit > 0):
            raise ValueError(
                f"row {row + 1}: expected exactly one positive amount across "
                f"Withdrawals / Deposits, got ({w_val!r}, {d_val!r})"
            )

        balance = parse_money(
            cell_value(sheet, row, 9),
            location=excel_location(row, 9),
            field="Balance",
            allow_negative=True,
        )

        rows.append(
            {
                "source_row": row + 1,
                "date": txn_date,
                "narration": remarks,
                "source_reference": source_reference,
                "withdrawal": withdrawal,
                "deposit": deposit,
                "balance": balance,
            }
        )
        previous_date = txn_date
        row += 1

    if not rows:
        raise ValueError("row 15: no transaction rows found")
    if len(rows) != expected_count:
        raise ValueError(
            f"parsed {len(rows)} transactions, but header declared {expected_count} records"
        )
    return rows


def parse_workbook(book: xlrd.book.Book) -> dict[str, Any]:
    sheet = validate_workbook(book)
    meta = parse_metadata(sheet)
    rows = parse_transactions(sheet, meta["expected_count"])
    return {"meta": meta, "rows": rows}


def parse_bytes(data: bytes) -> dict[str, Any]:
    book = xls.open_biff8_workbook(data)
    try:
        return parse_workbook(book)
    finally:
        book.release_resources()


def parse(path: Path) -> dict[str, Any]:
    if path.suffix.lower() != ".xls":
        raise ValueError("expected a .xls input file")
    if not path.is_file():
        raise ValueError(f"input is not a file: {path}")
    return parse_bytes(path.read_bytes())


def validate(meta: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Cross-check every running balance against the previous row to the paisa."""
    first = rows[0]
    implied_opening = first["balance"] - first["deposit"] + first["withdrawal"]
    running = first["balance"]
    for row in rows[1:]:
        running = running + row["deposit"] - row["withdrawal"]
        if running != row["balance"]:
            raise ValueError(
                f"row {row['source_row']}: running balance mismatch; walked "
                f"{running:.2f} but statement prints {row['balance']:.2f}"
            )
    withdrawals = sum((r["withdrawal"] for r in rows), Decimal("0.00"))
    deposits = sum((r["deposit"] for r in rows), Decimal("0.00"))
    return {
        "row_count": len(rows),
        "deposit_total": deposits,
        "withdrawal_total": withdrawals,
        "implied_opening": implied_opening,
        "closing": rows[-1]["balance"],
        "running_balance_checks": len(rows) - 1,
        "first_date": rows[0]["date"],
        "last_date": rows[-1]["date"],
    }


def to_abacus(meta: dict[str, Any], rows: list[dict[str, Any]]) -> abacus.AbacusStatement:
    return abacus.statement(
        rows=[
            abacus.row(
                date=r["date"],
                narration=r["narration"],
                withdrawal=r["withdrawal"],
                deposit=r["deposit"],
                balance=r["balance"],
                source_reference=r["source_reference"],
            )
            for r in rows
        ],
        opening=None,
        closing=None,
        account=abacus.bank_account(meta["account_number"]),
        institution=meta["institution"],
    )


def build(source: Path) -> tuple[abacus.AbacusStatement, str]:
    parsed = parse(source)
    meta = parsed["meta"]
    rows = parsed["rows"]
    audit = validate(meta, rows)
    summary = (
        f"{audit['row_count']} rows, "
        f"date_range={audit['first_date'].isoformat()} to {audit['last_date'].isoformat()}; "
        f"deposits={audit['deposit_total']:.2f}; "
        f"withdrawals={audit['withdrawal_total']:.2f}; "
        f"implied_opening={audit['implied_opening']:.2f}; closing={audit['closing']:.2f}; "
        f"running_balance_checks={audit['running_balance_checks']}"
    )
    return to_abacus(meta, rows), summary


if __name__ == "__main__":
    abacus.run_cli(build, usage="<statement.xls>", error_types=(xlrd.XLRDError,))
