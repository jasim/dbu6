#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2"]
# ///
from __future__ import annotations

"""Federal Bank savings account statement XLS -> Abacus JSON.

Usage: uv run parser.py <OpTransactionHistoryTprDD-MM-YYYY.xls>
Writes <statement-basename>.abacus.json next to the input.

The FedNet "Operative account transaction history" download is a genuine
BIFF8 workbook with one sheet, ten columns, an eight-row name/address block,
an account row, a statement-date row, a header row, the transactions, and a
one-line footer. Every structural anchor below is enforced so that a
different layout (including the HDFC bank and credit-card XLS exports) is
rejected rather than misread.
"""

import re
import sys
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

import xlrd


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared import abacus, xls  # noqa: E402
from shared.xls import (  # noqa: E402
    cell_value,
    excel_location,
    is_blank,
    only_columns,
    populated_columns,
    require_digits,
    require_text,
    row_is_blank,
)


SHEET_NAME = "OpTransactionHistoryTpr"
EXPECTED_COLUMN_COUNT = 10  # A:J

LETTERHEAD_TITLE = "Name and address of the account holder:"
LETTERHEAD_LAST_ROW = 7  # zero-based; rows 0..7 are the name/address block
ACCOUNT_ROW = 8  # Excel row 9
STATEMENT_DATE_ROW = 9  # Excel row 10
HEADER_ROW = 10  # Excel row 11
TRANSACTION_START_ROW = 11  # Excel row 12

(
    COL_SERIAL,
    COL_DATE,
    COL_PARTICULARS,
    COL_PARTICULARS_SPILL,  # merged with Particulars, always blank
    COL_VALUE_DATE,
    COL_TRAN_TYPE,
    COL_CHEQUE,
    COL_WITHDRAWAL,
    COL_DEPOSIT,
    COL_BALANCE,
) = range(10)

HEADER = {
    COL_SERIAL: "Sl. No.",
    COL_DATE: "Tran Date",
    COL_PARTICULARS: "Particulars",
    COL_VALUE_DATE: "Value Date",
    COL_TRAN_TYPE: "Tran Type",
    COL_CHEQUE: "Cheque Details",
    COL_WITHDRAWAL: "Withdrawal",
    COL_DEPOSIT: "Deposit",
    COL_BALANCE: "Balance Amount",
}
ACCOUNT_LABELS = {
    0: "Account No :",
    3: "CustomerId:",
    5: "Account Currency:",
    7: "Account Category:",
}
ACCOUNT_NUMBER_COLUMN = 2
ACCOUNT_DIGIT_COLUMNS = {
    ACCOUNT_NUMBER_COLUMN: "account number",
    4: "customer id",
    8: "account category",
}
ACCOUNT_CURRENCY_COLUMN = 6
STATEMENT_DATE_LABEL_COLUMN = 7
STATEMENT_DATE_VALUE_COLUMN = 8
FOOTER_PREFIX = "This is a computer generated statement"

# Particulars prefix -> zero-based index of the slash-delimited field that
# carries the bank's transaction reference (12 digits in every tested row).
# Prefixes not listed here yield no reference; the importer then falls back to
# its narration-based identity key for that row.
REFERENCE_FIELD = {"UPIOUT": 1, "UPI IN": 1, "TO ATM": 1, "FT IMPS": 2}
REFERENCE_RE = re.compile(r"^[0-9]{6,}$")
ROW_DATE_RE = re.compile(r"^(?P<d>[0-9]{2})-(?P<m>[0-9]{2})-(?P<y>[0-9]{4})$")
STATEMENT_DATE_RE = re.compile(
    r"^(?P<d>[0-9]{2})-(?P<m>[0-9]{2})-(?P<y>[0-9]{4}) [0-9]{2}:[0-9]{2}:[0-9]{2}$"
)
MONEY_TEXT_RE = re.compile(
    r"^-?(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+|"
    r"[1-9][0-9]?(?:,[0-9]{2})*,[0-9]{3})\.[0-9]{2}$"
)
CENT = Decimal("0.01")


def parse_money(value: Any, *, location: str, field: str, allow_negative: bool) -> Decimal:
    """Accept the formatted money text the export prints, or a numeric cell."""
    if isinstance(value, bool):
        raise ValueError(f"{location}: invalid {field} amount {value!r}")
    if isinstance(value, (int, float)):
        amount = Decimal(repr(value))
    elif isinstance(value, str) and MONEY_TEXT_RE.fullmatch(value):
        try:
            amount = Decimal(value.replace(",", ""))
        except InvalidOperation as exc:
            raise ValueError(f"{location}: invalid {field} amount {value!r}") from exc
    else:
        raise ValueError(
            f"{location}: invalid {field} amount {value!r}; expected a formatted "
            "amount with exactly two decimal places or a number"
        )
    if amount != amount.quantize(CENT):
        raise ValueError(
            f"{location}: {field} amount {value!r} has more than two decimal places"
        )
    if amount < 0 and not allow_negative:
        raise ValueError(f"{location}: negative {field} amount {value!r}")
    return amount.quantize(CENT)


def parse_row_date(value: Any, *, location: str, field: str) -> date:
    """Parse the dd-mm-yyyy transaction-table dates."""
    if not isinstance(value, str):
        raise ValueError(f"{location}: invalid {field} {value!r}; expected dd-mm-yyyy text")
    match = ROW_DATE_RE.fullmatch(value)
    if not match:
        raise ValueError(f"{location}: invalid {field} {value!r}; expected dd-mm-yyyy")
    try:
        return date(int(match.group("y")), int(match.group("m")), int(match.group("d")))
    except ValueError as exc:
        raise ValueError(f"{location}: invalid {field} {value!r}: {exc}") from exc


def parse_serial(value: Any, *, location: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{location}: invalid Sl. No. {value!r}; expected a number")
    if value != int(value) or value < 1:
        raise ValueError(f"{location}: invalid Sl. No. {value!r}; expected a positive whole number")
    return int(value)


def extract_reference(particulars: str, *, location: str) -> Optional[str]:
    """Return the bank reference embedded in a known Particulars layout.

    `UPIOUT/<ref>/<vpa>/...`, `UPI IN/<ref>/...`, `TO ATM/<ref>/...`, and
    `FT IMPS/IFI/<ref>/...` all carry a numeric reference at a fixed field. A
    known prefix without a numeric reference there is a layout change and is
    rejected; an unknown prefix simply has no reference.
    """
    parts = particulars.split("/")
    index = REFERENCE_FIELD.get(parts[0])
    if index is None:
        return None
    if len(parts) <= index or not REFERENCE_RE.fullmatch(parts[index]):
        raise ValueError(
            f"{location}: {parts[0]!r} Particulars {particulars!r} has no numeric "
            f"reference in field {index + 1}"
        )
    return parts[index]


def validate_workbook_fingerprint(book: xlrd.book.Book) -> xlrd.sheet.Sheet:
    sheet = xls.require_single_sheet(book, SHEET_NAME)
    xls.require_column_count(sheet, EXPECTED_COLUMN_COUNT)
    if sheet.nrows <= TRANSACTION_START_ROW:
        raise ValueError(
            f"expected at least {TRANSACTION_START_ROW + 1} rows, got {sheet.nrows}; "
            "fingerprint mismatch"
        )
    return sheet


def parse_letterhead(sheet: xlrd.sheet.Sheet) -> dict[str, Any]:
    """Validate the name/address block, the account row, and the statement-date row."""
    require_text(sheet, 0, 0, LETTERHEAD_TITLE)
    for row in range(0, LETTERHEAD_LAST_ROW + 1):
        only_columns(sheet, row, {0}, "the account holder name/address block")
        value = cell_value(sheet, row, 0)
        if not isinstance(value, str) or not value:
            raise ValueError(
                f"{excel_location(row, 0)}: expected account holder text, got {value!r}"
            )

    only_columns(
        sheet,
        ACCOUNT_ROW,
        set(ACCOUNT_LABELS) | set(ACCOUNT_DIGIT_COLUMNS) | {ACCOUNT_CURRENCY_COLUMN},
        "the account row",
    )
    for column, expected in ACCOUNT_LABELS.items():
        require_text(sheet, ACCOUNT_ROW, column, expected)
    digits = {
        column: require_digits(sheet, ACCOUNT_ROW, column, what)
        for column, what in ACCOUNT_DIGIT_COLUMNS.items()
    }
    account_number = digits[ACCOUNT_NUMBER_COLUMN]
    require_text(sheet, ACCOUNT_ROW, ACCOUNT_CURRENCY_COLUMN, "INR")

    # A10:G10 describe the period the user selected in FedNet ("Last" / "One"
    # / "Month Transactions" in the tested export) and are not anchored beyond
    # being text; H10:I10 are the statement timestamp.
    only_columns(
        sheet,
        STATEMENT_DATE_ROW,
        set(range(STATEMENT_DATE_LABEL_COLUMN)) | {STATEMENT_DATE_LABEL_COLUMN, STATEMENT_DATE_VALUE_COLUMN},
        "the statement date row",
    )
    for column in range(STATEMENT_DATE_LABEL_COLUMN):
        value = cell_value(sheet, STATEMENT_DATE_ROW, column)
        if not is_blank(value) and not isinstance(value, str):
            raise ValueError(
                f"{excel_location(STATEMENT_DATE_ROW, column)}: expected period text, got {value!r}"
            )
    require_text(sheet, STATEMENT_DATE_ROW, STATEMENT_DATE_LABEL_COLUMN, "Statement Date:")
    stamp = cell_value(sheet, STATEMENT_DATE_ROW, STATEMENT_DATE_VALUE_COLUMN)
    location = excel_location(STATEMENT_DATE_ROW, STATEMENT_DATE_VALUE_COLUMN)
    match = STATEMENT_DATE_RE.fullmatch(stamp) if isinstance(stamp, str) else None
    if not match:
        raise ValueError(
            f"{location}: invalid statement date {stamp!r}; expected dd-mm-yyyy HH:MM:SS"
        )
    try:
        statement_date = date(int(match.group("y")), int(match.group("m")), int(match.group("d")))
    except ValueError as exc:
        raise ValueError(f"{location}: invalid statement date {stamp!r}: {exc}") from exc
    return {"account_number": account_number, "statement_date": statement_date}


def validate_header(sheet: xlrd.sheet.Sheet) -> None:
    only_columns(sheet, HEADER_ROW, set(HEADER), "the header row")
    for column, expected in HEADER.items():
        require_text(sheet, HEADER_ROW, column, expected)


def is_footer_row(sheet: xlrd.sheet.Sheet, row: int) -> bool:
    value = cell_value(sheet, row, 0)
    return isinstance(value, str) and value.startswith(FOOTER_PREFIX)


def parse_transaction(
    sheet: xlrd.sheet.Sheet, row: int, expected_serial: int, previous_date: Optional[date]
) -> dict[str, Any]:
    only_columns(sheet, row, set(range(EXPECTED_COLUMN_COUNT)) - {COL_PARTICULARS_SPILL}, "a transaction")
    columns = populated_columns(sheet, row)
    required = {COL_SERIAL, COL_DATE, COL_PARTICULARS, COL_VALUE_DATE, COL_TRAN_TYPE, COL_BALANCE}
    missing = required - columns
    if missing:
        cells = ", ".join(excel_location(row, column) for column in sorted(missing))
        raise ValueError(f"row {row + 1}: transaction is missing required cell(s): {cells}")

    serial = parse_serial(
        cell_value(sheet, row, COL_SERIAL), location=excel_location(row, COL_SERIAL)
    )
    if serial != expected_serial:
        raise ValueError(
            f"{excel_location(row, COL_SERIAL)}: Sl. No. {serial} out of sequence; "
            f"expected {expected_serial}"
        )
    transaction_date = parse_row_date(
        cell_value(sheet, row, COL_DATE),
        location=excel_location(row, COL_DATE),
        field="Tran Date",
    )
    if previous_date is not None and transaction_date < previous_date:
        raise ValueError(
            f"{excel_location(row, COL_DATE)}: transaction dates are not oldest-first "
            f"({transaction_date.isoformat()} after {previous_date.isoformat()})"
        )
    particulars = cell_value(sheet, row, COL_PARTICULARS)
    if not isinstance(particulars, str) or not particulars.strip():
        raise ValueError(f"{excel_location(row, COL_PARTICULARS)}: empty Particulars")
    parse_row_date(
        cell_value(sheet, row, COL_VALUE_DATE),
        location=excel_location(row, COL_VALUE_DATE),
        field="Value Date",
    )
    tran_type = cell_value(sheet, row, COL_TRAN_TYPE)
    if not isinstance(tran_type, str) or not tran_type.strip():
        raise ValueError(f"{excel_location(row, COL_TRAN_TYPE)}: empty Tran Type")
    cheque = cell_value(sheet, row, COL_CHEQUE)
    if not is_blank(cheque) and not isinstance(cheque, (str, int, float)):
        raise ValueError(
            f"{excel_location(row, COL_CHEQUE)}: expected Cheque Details text, got {cheque!r}"
        )

    withdrawal_cell = cell_value(sheet, row, COL_WITHDRAWAL)
    deposit_cell = cell_value(sheet, row, COL_DEPOSIT)
    withdrawal = (
        Decimal("0.00")
        if is_blank(withdrawal_cell)
        else parse_money(
            withdrawal_cell,
            location=excel_location(row, COL_WITHDRAWAL),
            field="Withdrawal",
            allow_negative=False,
        )
    )
    deposit = (
        Decimal("0.00")
        if is_blank(deposit_cell)
        else parse_money(
            deposit_cell,
            location=excel_location(row, COL_DEPOSIT),
            field="Deposit",
            allow_negative=False,
        )
    )
    if (withdrawal > 0) == (deposit > 0):
        raise ValueError(
            f"row {row + 1}: expected exactly one positive amount across "
            f"Withdrawal / Deposit, got ({withdrawal_cell!r}, {deposit_cell!r})"
        )

    # A bank account may legitimately print a negative balance (overdraft);
    # that is a real asset balance below zero, not a credit-card convention.
    balance = parse_money(
        cell_value(sheet, row, COL_BALANCE),
        location=excel_location(row, COL_BALANCE),
        field="Balance Amount",
        allow_negative=True,
    )
    reference = extract_reference(
        particulars, location=excel_location(row, COL_PARTICULARS)
    )
    return {
        "source_row": row + 1,
        "date": transaction_date,
        # Preserve the Particulars cell verbatim. The mapping layer knows how
        # to pick the UPI VPA out of it; the parser does not rewrite text.
        "narration": particulars,
        "reference": reference,
        "withdrawal": withdrawal,
        "deposit": deposit,
        "balance": balance,
    }


def parse_transactions(sheet: xlrd.sheet.Sheet) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    row = TRANSACTION_START_ROW
    previous_date: Optional[date] = None
    while row < sheet.nrows and not is_footer_row(sheet, row):
        transaction = parse_transaction(sheet, row, len(rows) + 1, previous_date)
        previous_date = transaction["date"]
        rows.append(transaction)
        row += 1
    if not rows:
        raise ValueError(f"row {TRANSACTION_START_ROW + 1}: no transaction rows found")
    if row >= sheet.nrows:
        raise ValueError(
            f"expected the {FOOTER_PREFIX!r} footer after the last transaction; "
            "sheet ends early"
        )
    only_columns(sheet, row, {0}, "the footer row")
    trailing = [r for r in range(row + 1, sheet.nrows) if not row_is_blank(sheet, r)]
    if trailing:
        raise ValueError(
            f"row {trailing[0] + 1}: unexpected populated row after the footer; "
            "fingerprint mismatch"
        )
    return rows


def parse_workbook(book: xlrd.book.Book) -> dict[str, Any]:
    sheet = validate_workbook_fingerprint(book)
    letterhead = parse_letterhead(sheet)
    validate_header(sheet)
    rows = parse_transactions(sheet)
    return {"letterhead": letterhead, "rows": rows}


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


def validate(statement: dict[str, Any]) -> dict[str, Any]:
    """Cross-check every printed running balance against the previous row."""
    rows = statement["rows"]
    first = rows[0]
    # The export prints no opening balance; the one implied by the first row
    # is reported for the audit line only and is never emitted.
    implied_opening = first["balance"] - first["deposit"] + first["withdrawal"]
    running = first["balance"]
    for row in rows[1:]:
        running = running + row["deposit"] - row["withdrawal"]
        if running != row["balance"]:
            raise ValueError(
                f"row {row['source_row']}: running balance mismatch; walked "
                f"{running:.2f} but the statement prints {row['balance']:.2f}"
            )

    withdrawals = sum((row["withdrawal"] for row in rows), Decimal("0.00"))
    deposits = sum((row["deposit"] for row in rows), Decimal("0.00"))
    return {
        "row_count": len(rows),
        "referenced_count": sum(1 for row in rows if row["reference"] is not None),
        "deposit_total": deposits,
        "withdrawal_total": withdrawals,
        "implied_opening": implied_opening,
        "closing": rows[-1]["balance"],
        "running_balance_checks": len(rows) - 1,
        "statement_date": statement["letterhead"]["statement_date"],
    }


def to_abacus(statement: dict[str, Any]) -> abacus.AbacusStatement:
    return abacus.statement(
        rows=[
            abacus.row(
                date=row["date"],
                narration=row["narration"],
                withdrawal=row["withdrawal"],
                deposit=row["deposit"],
                balance=row["balance"],
                # The bank reference where the layout has one.
                source_reference=row["reference"],
            )
            for row in statement["rows"]
        ],
        # The export labels neither an opening nor a closing balance. Per-row
        # balances give the importer a `per-row` closing; nothing is derived.
        opening=None,
        closing=None,
        account=abacus.bank_account(statement["letterhead"]["account_number"]),
        # The FedNet export prints no bank name anywhere (holder block,
        # account row, header, footer), so there is nothing to copy verbatim.
        institution=None,
    )


def build(source: Path) -> tuple[abacus.AbacusStatement, str]:
    statement = parse(source)
    audit = validate(statement)
    summary = (
        f"{audit['row_count']} rows, "
        f"{audit['referenced_count']} with a bank reference; "
        f"statement_date={audit['statement_date'].isoformat()}; "
        f"deposits={audit['deposit_total']:.2f}; "
        f"withdrawals={audit['withdrawal_total']:.2f}; "
        f"implied_opening={audit['implied_opening']:.2f}; closing={audit['closing']:.2f}; "
        f"running_balance_checks={audit['running_balance_checks']}"
    )
    return to_abacus(statement), summary


if __name__ == "__main__":
    abacus.run_cli(build, usage="<statement.xls>", error_types=(xlrd.XLRDError,))
