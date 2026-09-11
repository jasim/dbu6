#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2"]
# ///
from __future__ import annotations

"""HDFC Bank credit-card billed-statement XLS -> Abacus JSON.

Usage: uv run parser.py <statement.xls>
Writes <statement-basename>.abacus.json next to the input.
"""

import json
import re
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Optional

import xlrd


OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
SHEET_NAME = "Statement"
EXPECTED_COLUMN_COUNT = 24  # A:X as exposed by xlrd; later merged/styled cells are blank
TRANSACTION_HEADER_ROW = 18  # zero-based; Excel row 19
TRANSACTION_START_ROW = 19  # zero-based; Excel row 20
MONEY_RE = re.compile(
    r"^(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+|"
    r"[1-9][0-9]?(?:,[0-9]{2})*,[0-9]{3})\.[0-9]{2}$"
)
# N3 prints the masked card number; the masked digits are the emitted card
# identifier (already contiguous and uppercase in this layout).
CARD_NUMBER_RE = re.compile(r"^Credit Card No\.: (?P<number>[0-9]{6}X{6}[0-9]{4})$")
CARD_NUMBER_ROW, CARD_NUMBER_COLUMN = 2, 13  # N3
ALTERNATE_ACCOUNT_RE = re.compile(r"^Alternate Account Number: [0-9]{16,24}$")
TRANSACTION_DATE_TIME_RE = re.compile(
    r"^(?P<date>[0-9]{2}/[0-9]{2}/[0-9]{4}) / "
    r"(?P<time>[0-9]{2}:[0-9]{2})$"
)
REWARD_RE = re.compile(r"^[+-] [0-9]+(?:,[0-9]{3})*$")
# A registered-office footer cell, when present, opens with the issuer's
# name, which is emitted verbatim as `institution` (up to the first comma).
REGISTERED_OFFICE_RE = re.compile(r"^Registered Office Address:\s*(?P<name>[^,]+?)\s*(?:,|$)")
REFERENCE_RE = re.compile(r"\(Ref#\s*([^)]+?)\)", re.IGNORECASE)
TRANSACTION_COLUMNS = {0, 4, 9, 12, 18, 20, 23}


def excel_location(row: int, column: int) -> str:
    """Return a compact A1-style location for zero-based row/column indexes."""
    letters = ""
    number = column + 1
    while number:
        number, remainder = divmod(number - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return f"{letters}{row + 1}"


def cell_value(sheet: xlrd.sheet.Sheet, row: int, column: int) -> Any:
    if row >= sheet.nrows or column >= sheet.ncols:
        return ""
    return sheet.cell_value(row, column)


def require_text(
    sheet: xlrd.sheet.Sheet, row: int, column: int, expected: str
) -> None:
    actual = cell_value(sheet, row, column)
    if actual != expected:
        raise ValueError(
            f"{excel_location(row, column)}: fingerprint mismatch; "
            f"expected {expected!r}, got {actual!r}"
        )


def require_matching_text(
    sheet: xlrd.sheet.Sheet,
    row: int,
    column: int,
    pattern: re.Pattern[str],
    label: str,
) -> re.Match[str]:
    value = cell_value(sheet, row, column)
    match = pattern.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise ValueError(
            f"{excel_location(row, column)}: invalid {label}; "
            f"fingerprint mismatch"
        )
    return match


def parse_money(value: Any, *, location: str, field: str) -> Decimal:
    if not isinstance(value, str) or not MONEY_RE.fullmatch(value):
        raise ValueError(
            f"{location}: invalid {field} amount {value!r}; "
            "expected a non-negative amount with exactly two decimal places"
        )
    try:
        return Decimal(value.replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError(f"{location}: invalid {field} amount {value!r}") from exc


def parse_labelled_date(value: Any, *, location: str, field: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{location}: invalid {field} date {value!r}")
    try:
        return datetime.strptime(value, "%d %b, %Y").date()
    except ValueError as exc:
        raise ValueError(
            f"{location}: invalid {field} date {value!r}; expected DD Mon, YYYY"
        ) from exc


def parse_transaction_date_time(
    value: Any, *, location: str
) -> tuple[date, datetime]:
    if not isinstance(value, str):
        raise ValueError(f"{location}: invalid transaction date/time {value!r}")
    match = TRANSACTION_DATE_TIME_RE.fullmatch(value)
    if not match:
        raise ValueError(
            f"{location}: invalid transaction date/time {value!r}; "
            "expected DD/MM/YYYY / HH:MM"
        )
    try:
        timestamp = datetime.strptime(value, "%d/%m/%Y / %H:%M")
    except ValueError as exc:
        raise ValueError(
            f"{location}: invalid transaction date/time {value!r}"
        ) from exc
    return timestamp.date(), timestamp


def row_is_blank(sheet: xlrd.sheet.Sheet, row: int) -> bool:
    return all(cell_value(sheet, row, column) == "" for column in range(sheet.ncols))


def validate_fingerprint(book: xlrd.book.Book, sheet: xlrd.sheet.Sheet) -> None:
    if book.biff_version != 80:
        raise ValueError(
            f"expected an Excel 97-2003 BIFF8 workbook, got BIFF {book.biff_version}"
        )
    if book.nsheets != 1 or book.sheet_names() != [SHEET_NAME]:
        raise ValueError(
            "expected exactly one worksheet named 'Statement'; fingerprint mismatch"
        )
    if sheet.ncols != EXPECTED_COLUMN_COUNT:
        raise ValueError(
            f"expected exactly {EXPECTED_COLUMN_COUNT} populated columns (A:X), "
            f"got {sheet.ncols}; fingerprint mismatch"
        )

    anchors = {
        (0, 0): "Name",
        (1, 0): "Address",
        (2, 0): "Address",
        (5, 0): "Payment Due Date",
        (6, 0): "Statement Date",
        (7, 0): "Total Amount Due",
        (8, 0): "Minimum Amount Due",
        (13, 0): "Account Summary",
        (14, 0): "Opening Bal",
        (14, 5): "Payment / Credit",
        (14, 9): "+",
        (14, 10): "Purchases / Debits",
        (14, 14): "+",
        (14, 15): "Finance Charges",
        (14, 19): "=",
        (14, 20): "Total Dues",
        (TRANSACTION_HEADER_ROW, 0): "Transaction type",
        (TRANSACTION_HEADER_ROW, 4): "Primary / Addon Customer Name",
        (TRANSACTION_HEADER_ROW, 9): "Date & Time",
        (TRANSACTION_HEADER_ROW, 12): "Description",
        (TRANSACTION_HEADER_ROW, 18): "REWARDS",
        (TRANSACTION_HEADER_ROW, 20): "AMT",
        (TRANSACTION_HEADER_ROW, 23): "Debit / Credit",
    }
    for (row, column), expected in anchors.items():
        require_text(sheet, row, column, expected)

    require_matching_text(
        sheet,
        3,
        13,
        ALTERNATE_ACCOUNT_RE,
        "alternate account number",
    )


def parse_institution(sheet: xlrd.sheet.Sheet) -> Optional[str]:
    """The issuer's name from a registered-office footer cell in column A, or None."""
    for row in range(sheet.nrows):
        value = cell_value(sheet, row, 0)
        if not isinstance(value, str):
            continue
        match = REGISTERED_OFFICE_RE.match(value.strip())
        if match and match.group("name"):
            return match.group("name")
    return None


def parse_card_number(sheet: xlrd.sheet.Sheet) -> str:
    """Canonical card identifier from N3: the masked number, no spaces, uppercase."""
    match = require_matching_text(
        sheet, CARD_NUMBER_ROW, CARD_NUMBER_COLUMN, CARD_NUMBER_RE, "masked card number"
    )
    return match.group("number").replace(" ", "").upper()


def parse_summary(sheet: xlrd.sheet.Sheet) -> dict[str, Any]:
    statement_date = parse_labelled_date(
        cell_value(sheet, 6, 4), location="E7", field="statement"
    )
    payment_due_date = parse_labelled_date(
        cell_value(sheet, 5, 4), location="E6", field="payment due"
    )
    if payment_due_date <= statement_date:
        raise ValueError(
            f"E6: payment due date {payment_due_date.isoformat()} must be after "
            f"statement date {statement_date.isoformat()}"
        )
    total_amount_due = parse_money(
        cell_value(sheet, 7, 4), location="E8", field="Total Amount Due"
    )
    opening = parse_money(
        cell_value(sheet, 15, 0), location="A16", field="opening balance"
    )
    payment_credit = parse_money(
        cell_value(sheet, 15, 5), location="F16", field="Payment / Credit"
    )
    purchases_debits = parse_money(
        cell_value(sheet, 15, 10), location="K16", field="Purchases / Debits"
    )
    finance_charges = parse_money(
        cell_value(sheet, 15, 15), location="P16", field="Finance Charges"
    )
    total_dues = parse_money(
        cell_value(sheet, 15, 20), location="U16", field="Total Dues"
    )
    if total_amount_due != total_dues:
        raise ValueError(
            "displayed due mismatch: Total Amount Due "
            f"{total_amount_due:.2f} != Account Summary Total Dues {total_dues:.2f}"
        )
    return {
        "statement_date": statement_date,
        "payment_due_date": payment_due_date,
        "total_amount_due": total_amount_due,
        "opening": opening,
        "payment_credit": payment_credit,
        "purchases_debits": purchases_debits,
        "finance_charges": finance_charges,
        "total_dues": total_dues,
    }


def parse_transaction(
    sheet: xlrd.sheet.Sheet, row: int, statement_date: date
) -> dict[str, Any]:
    populated_columns = {
        column
        for column in range(sheet.ncols)
        if cell_value(sheet, row, column) != ""
    }
    unexpected_columns = populated_columns - TRANSACTION_COLUMNS
    if unexpected_columns:
        locations = ", ".join(
            excel_location(row, column) for column in sorted(unexpected_columns)
        )
        raise ValueError(
            f"row {row + 1}: unexpected populated transaction cell(s): {locations}"
        )

    transaction_type = cell_value(sheet, row, 0)
    if transaction_type not in {"Domestic", "International"}:
        raise ValueError(
            f"A{row + 1}: expected Domestic or International transaction type, "
            f"got {transaction_type!r}"
        )
    customer_name = cell_value(sheet, row, 4)
    if not isinstance(customer_name, str) or not customer_name.strip():
        raise ValueError(f"E{row + 1}: empty Primary / Addon Customer Name")

    transaction_date, timestamp = parse_transaction_date_time(
        cell_value(sheet, row, 9), location=f"J{row + 1}"
    )
    if transaction_date > statement_date:
        raise ValueError(
            f"J{row + 1}: transaction date {transaction_date.isoformat()} "
            f"is after statement date {statement_date.isoformat()}"
        )

    narration = cell_value(sheet, row, 12)
    if not isinstance(narration, str) or not narration.strip():
        raise ValueError(f"M{row + 1}: empty transaction description")

    reward = cell_value(sheet, row, 18)
    if reward != "" and (
        not isinstance(reward, str) or not REWARD_RE.fullmatch(reward)
    ):
        raise ValueError(f"S{row + 1}: invalid rewards value {reward!r}")

    amount = parse_money(
        cell_value(sheet, row, 20), location=f"U{row + 1}", field="transaction"
    )
    if amount <= 0:
        raise ValueError(f"U{row + 1}: transaction amount must be positive")

    direction = cell_value(sheet, row, 23)
    if not isinstance(direction, str) or direction.casefold() not in {"", "cr", "dr"}:
        raise ValueError(
            f"X{row + 1}: invalid Debit / Credit marker {direction!r}; "
            "expected blank, Dr, or Cr"
        )
    is_credit = direction.casefold() == "cr"
    reference_match = REFERENCE_RE.search(narration)
    return {
        "source_row": row + 1,
        "transaction_type": transaction_type,
        "timestamp": timestamp,
        "date": transaction_date,
        # Preserve the description cell verbatim, including bank-supplied spacing.
        "narration": narration,
        "withdrawal": Decimal("0.00") if is_credit else amount,
        "deposit": amount if is_credit else Decimal("0.00"),
        "balance": None,
        "source_reference": (
            reference_match.group(1).strip() if reference_match else None
        ),
    }


def parse_transactions(
    sheet: xlrd.sheet.Sheet, statement_date: date
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    row = TRANSACTION_START_ROW
    while row < sheet.nrows and not row_is_blank(sheet, row):
        rows.append(parse_transaction(sheet, row, statement_date))
        row += 1
    if not rows:
        raise ValueError("no transaction rows found")
    if row >= sheet.nrows:
        raise ValueError("missing blank separator after transaction table")
    if row + 1 >= sheet.nrows or cell_value(sheet, row + 1, 0) != "Reward Points Summary":
        raise ValueError(
            f"A{row + 2}: expected Reward Points Summary immediately after "
            "the transaction-table separator"
        )

    previous_type_rank = -1
    previous_date_by_type: dict[str, date] = {}
    for transaction in rows:
        transaction_type = transaction["transaction_type"]
        type_rank = 0 if transaction_type == "Domestic" else 1
        if type_rank < previous_type_rank:
            raise ValueError(
                f"row {transaction['source_row']}: Domestic rows cannot follow "
                "International rows"
            )
        previous_type_rank = type_rank
        previous_date = previous_date_by_type.get(transaction_type)
        if previous_date is not None and transaction["date"] < previous_date:
            raise ValueError(
                f"row {transaction['source_row']}: {transaction_type} "
                "transaction dates are not oldest-first"
            )
        previous_date_by_type[transaction_type] = transaction["date"]
    return rows


def parse(path: Path) -> dict[str, Any]:
    if path.suffix.lower() != ".xls":
        raise ValueError("expected a .xls input file")
    if not path.is_file():
        raise ValueError(f"input is not a file: {path}")
    return parse_bytes(path.read_bytes())


def parse_bytes(data: bytes) -> dict[str, Any]:
    if data[: len(OLE_MAGIC)] != OLE_MAGIC:
        raise ValueError("expected an OLE Compound File / BIFF8 .xls workbook")

    book = xlrd.open_workbook(file_contents=data, on_demand=True)
    try:
        if book.nsheets != 1 or book.sheet_names() != [SHEET_NAME]:
            raise ValueError(
                "expected exactly one worksheet named 'Statement'; "
                "fingerprint mismatch"
            )
        sheet = book.sheet_by_index(0)
        validate_fingerprint(book, sheet)
        card_number = parse_card_number(sheet)
        summary = parse_summary(sheet)
        rows = parse_transactions(sheet, summary["statement_date"])
        return {
            "card_number": card_number,
            "institution": parse_institution(sheet),
            "summary": summary,
            "rows": rows,
        }
    finally:
        book.release_resources()


def validate(statement: dict[str, Any]) -> dict[str, Any]:
    summary = statement["summary"]
    rows = statement["rows"]
    deposits = sum((row["deposit"] for row in rows), Decimal("0.00"))
    withdrawals = sum((row["withdrawal"] for row in rows), Decimal("0.00"))
    expected_withdrawals = summary["purchases_debits"] + summary["finance_charges"]
    if deposits != summary["payment_credit"]:
        raise ValueError(
            "credit total mismatch: transaction credits "
            f"{deposits:.2f} != Account Summary Payment / Credit "
            f"{summary['payment_credit']:.2f}"
        )
    if withdrawals != expected_withdrawals:
        raise ValueError(
            "debit total mismatch: transaction debits "
            f"{withdrawals:.2f} != Account Summary Purchases / Debits plus "
            f"Finance Charges {expected_withdrawals:.2f}"
        )

    # Statement convention is a positive amount owed. Credits reduce it and
    # debits increase it. The sign is flipped only when emitting ledger values.
    exact_closing = summary["opening"] - deposits + withdrawals
    expected_closing = (
        summary["opening"]
        - summary["payment_credit"]
        + summary["purchases_debits"]
        + summary["finance_charges"]
    )
    if exact_closing != expected_closing:
        raise ValueError(
            f"account-summary arithmetic mismatch: {exact_closing:.2f} != "
            f"{expected_closing:.2f}"
        )

    rounded_due = exact_closing.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if summary["total_dues"] != rounded_due:
        raise ValueError(
            "rounded due mismatch: exact closing "
            f"{exact_closing:.2f} rounds to {rounded_due:.2f}, but displayed "
            f"Total Dues is {summary['total_dues']:.2f}"
        )

    return {
        "row_count": len(rows),
        "deposit_total": deposits,
        "withdrawal_total": withdrawals,
        "opening": summary["opening"],
        "exact_closing": exact_closing,
        "displayed_total_due": summary["total_dues"],
        # This XLS layout has no per-transaction running-balance column.
        "running_balance_checks": 0,
    }


def json_number(value: Decimal) -> float:
    return float(value)


def ledger_balance(statement_balance: Decimal) -> float:
    if statement_balance == 0:
        return 0.0
    return float(-statement_balance)


def to_abacus(statement: dict[str, Any], audit: dict[str, Any]) -> dict[str, Any]:
    chronological_rows = sorted(
        statement["rows"], key=lambda row: (row["timestamp"], row["source_row"])
    )
    return {
        "kind": "abacus",
        # The masked card number identifies which card this statement is for.
        "account": {"kind": "card", "identifier": statement["card_number"]},
        # The issuer's name from the registered-office footer, verbatim.
        "institution": statement["institution"],
        # Credit-card balances are liabilities, hence the sign flip.
        "opening": ledger_balance(audit["opening"]),
        # HDFC displays Total Dues rounded to rupees. Preserve the exact ledger
        # closing proved by statement opening - credits + debits, not the
        # payment rounding.
        "closing": ledger_balance(audit["exact_closing"]),
        "rows": [
            {
                "date": row["date"].isoformat(),
                "narration": row["narration"],
                "withdrawal": json_number(row["withdrawal"]),
                "deposit": json_number(row["deposit"]),
                "balance": None,
                "source_reference": row["source_reference"],
            }
            for row in chronological_rows
        ],
    }


def main() -> None:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <statement.xls>", file=sys.stderr)
        sys.exit(2)

    source = Path(sys.argv[1]).resolve()
    try:
        statement = parse(source)
        audit = validate(statement)
        output = to_abacus(statement, audit)
    except (OSError, UnicodeError, ValueError, xlrd.XLRDError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

    destination = source.with_suffix(".abacus.json")
    destination.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {destination} ({audit['row_count']} rows; "
        f"deposits={audit['deposit_total']:.2f}; "
        f"withdrawals={audit['withdrawal_total']:.2f}; "
        f"opening={ledger_balance(audit['opening']):.2f}; "
        f"closing={ledger_balance(audit['exact_closing']):.2f}; "
        f"displayed_total_due={audit['displayed_total_due']:.2f}; "
        f"running_balance_checks={audit['running_balance_checks']})"
    )


if __name__ == "__main__":
    main()
