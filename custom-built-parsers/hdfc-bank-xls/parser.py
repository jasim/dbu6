#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2"]
# ///
from __future__ import annotations

"""HDFC Bank savings/current account statement XLS -> Abacus JSON.

Usage: uv run parser.py <Acct_Statement_XXXXXXXX1234_DDMMYYYY.xls>
Writes <statement-basename>.abacus.json next to the input.

The netbanking "Statement of accounts" download is a genuine BIFF8 workbook
with one sheet, seven columns, a fixed 20-row letterhead, a transaction table
framed by asterisk rows, and a STATEMENT SUMMARY block. Every structural anchor
below is enforced so that a different layout (including the HDFC credit-card
XLS) is rejected rather than misread.
"""

import json
import re
import sys
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

import xlrd


OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
SHEET_NAME = "Sheet 1"
EXPECTED_COLUMN_COUNT = 7  # A:G

LETTERHEAD_LAST_ROW = 18  # zero-based; rows 0..18 are account metadata
TABLE_FRAME_ROW = 19  # long asterisk rule above the header (Excel row 20)
HEADER_ROW = 20  # Excel row 21
MASK_ROW = 21  # per-column asterisk mask under the header (Excel row 22)
TRANSACTION_START_ROW = 22  # Excel row 23

HEADER = [
    "Date",
    "Narration",
    "Chq./Ref.No.",
    "Value Dt",
    "Withdrawal Amt.",
    "Deposit Amt.",
    "Closing Balance",
]
COL_DATE, COL_NARRATION, COL_REF, COL_VALUE_DATE, COL_WITHDRAWAL, COL_DEPOSIT, COL_BALANCE = range(7)
SUMMARY_TITLE = "STATEMENT SUMMARY  :-"
SUMMARY_LABELS = {
    COL_DATE: "Opening Balance",
    COL_WITHDRAWAL: "Debits",
    COL_DEPOSIT: "Credits",
    COL_BALANCE: "Closing Bal",
}
COUNT_LABELS = {COL_WITHDRAWAL: "Dr Count", COL_DEPOSIT: "Cr Count"}
END_OF_STATEMENT = "---  End Of Statement ---"

# The A1 title starts with the bank's printed name, emitted as `institution`.
TITLE_RE = re.compile(
    r"^(?P<institution>HDFC BANK Ltd\.)\s+Page No \.:\s+[0-9]+\s+Statement of accounts$"
)
STATEMENT_PERIOD_RE = re.compile(
    r"^Statement From\s+:\s+(?P<from>[0-9]{2}/[0-9]{2}/[0-9]{4})"
    r"\s+To\s+:\s+(?P<to>[0-9]{2}/[0-9]{2}/[0-9]{4})$"
)
# The digits after the label are the emitted account identifier; the cell may
# continue with a customer tier such as "   Preferred Customer".
ACCOUNT_NUMBER_RE = re.compile(r"^Account No :(?P<number>[0-9]{9,20})\b")
IFSC_RE = re.compile(r"^RTGS/NEFT IFSC :HDFC0[0-9A-Z]{6}\b")
CURRENCY_RE = re.compile(r"\bCurrency :INR$")
ASTERISKS_RE = re.compile(r"^\*+$")
# Interest rows carry an all-zero Chq./Ref.No. placeholder instead of a real
# reference; it must not become a shared source_reference.
PLACEHOLDER_REFERENCE_RE = re.compile(r"^0+$")
ROW_DATE_RE = re.compile(r"^(?P<d>[0-9]{2})/(?P<m>[0-9]{2})/(?P<y>[0-9]{2})$")
MONEY_TEXT_RE = re.compile(
    r"^-?(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+|"
    r"[1-9][0-9]?(?:,[0-9]{2})*,[0-9]{3})\.[0-9]{2}$"
)
CENT = Decimal("0.01")


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


def cell_type(sheet: xlrd.sheet.Sheet, row: int, column: int) -> int:
    if row >= sheet.nrows or column >= sheet.ncols:
        return xlrd.XL_CELL_EMPTY
    return sheet.cell_type(row, column)


def is_blank(value: Any) -> bool:
    return value == "" or value is None


def row_is_blank(sheet: xlrd.sheet.Sheet, row: int) -> bool:
    return all(is_blank(cell_value(sheet, row, column)) for column in range(sheet.ncols))


def populated_columns(sheet: xlrd.sheet.Sheet, row: int) -> set[int]:
    return {
        column
        for column in range(sheet.ncols)
        if not is_blank(cell_value(sheet, row, column))
    }


def require_text(sheet: xlrd.sheet.Sheet, row: int, column: int, expected: str) -> None:
    actual = cell_value(sheet, row, column)
    if actual != expected:
        raise ValueError(
            f"{excel_location(row, column)}: fingerprint mismatch; "
            f"expected {expected!r}, got {actual!r}"
        )


def require_asterisks(sheet: xlrd.sheet.Sheet, row: int, column: int) -> None:
    value = cell_value(sheet, row, column)
    if not isinstance(value, str) or not ASTERISKS_RE.fullmatch(value):
        raise ValueError(
            f"{excel_location(row, column)}: fingerprint mismatch; "
            f"expected an all-asterisk rule, got {value!r}"
        )


def require_mask_row(sheet: xlrd.sheet.Sheet, row: int) -> None:
    for column in range(EXPECTED_COLUMN_COUNT):
        require_asterisks(sheet, row, column)


def require_blank_row(sheet: xlrd.sheet.Sheet, row: int, what: str) -> None:
    if row >= sheet.nrows:
        raise ValueError(f"row {row + 1}: missing {what}; sheet ends early")
    if not row_is_blank(sheet, row):
        cells = ", ".join(
            excel_location(row, column) for column in sorted(populated_columns(sheet, row))
        )
        raise ValueError(f"row {row + 1}: expected {what} but found populated cell(s): {cells}")


def only_columns(sheet: xlrd.sheet.Sheet, row: int, allowed: set[int], what: str) -> None:
    unexpected = populated_columns(sheet, row) - allowed
    if unexpected:
        cells = ", ".join(excel_location(row, column) for column in sorted(unexpected))
        raise ValueError(f"row {row + 1}: unexpected populated cell(s) in {what}: {cells}")


def parse_money(value: Any, *, location: str, field: str, allow_negative: bool) -> Decimal:
    """Accept a numeric cell (the observed export) or a formatted money string."""
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


def parse_short_date(value: Any, *, location: str, field: str) -> date:
    """Parse the dd/mm/yy transaction-table dates. Pivot: yy < 50 -> 20yy."""
    if not isinstance(value, str):
        raise ValueError(f"{location}: invalid {field} {value!r}; expected dd/mm/yy text")
    match = ROW_DATE_RE.fullmatch(value)
    if not match:
        raise ValueError(f"{location}: invalid {field} {value!r}; expected dd/mm/yy")
    yy = int(match.group("y"))
    year = 2000 + yy if yy < 50 else 1900 + yy
    try:
        return date(year, int(match.group("m")), int(match.group("d")))
    except ValueError as exc:
        raise ValueError(f"{location}: invalid {field} {value!r}: {exc}") from exc


def parse_long_date(value: str, *, location: str, field: str) -> date:
    day, month, year = value.split("/")
    try:
        return date(int(year), int(month), int(day))
    except ValueError as exc:
        raise ValueError(f"{location}: invalid {field} {value!r}: {exc}") from exc


def parse_reference(value: Any, cell_kind: int, *, location: str) -> Optional[str]:
    """Return the Chq./Ref.No. as the bank reference, or None for a placeholder.

    Real rows carry a 16-character (RTGS: 22-character) reference; interest
    rows print an all-zero placeholder, and a blank cell is tolerated. Both
    yield None so the importer falls back to its narration-based identity.
    """
    if is_blank(value):
        return None
    if cell_kind == xlrd.XL_CELL_NUMBER and not isinstance(value, bool):
        if value != int(value):
            raise ValueError(f"{location}: invalid Chq./Ref.No. {value!r}; expected a whole number")
        value = str(int(value))
    if cell_kind not in (xlrd.XL_CELL_TEXT, xlrd.XL_CELL_NUMBER) or not isinstance(value, str):
        raise ValueError(f"{location}: expected Chq./Ref.No. text, got {value!r}")
    reference = value.strip()
    if not reference or PLACEHOLDER_REFERENCE_RE.fullmatch(reference):
        return None
    return reference


def parse_count(value: Any, *, location: str, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{location}: invalid {field} {value!r}; expected a number")
    if value != int(value) or value < 0:
        raise ValueError(f"{location}: invalid {field} {value!r}; expected a whole number")
    return int(value)


def validate_workbook_fingerprint(book: xlrd.book.Book) -> xlrd.sheet.Sheet:
    if book.biff_version != 80:
        raise ValueError(
            f"expected an Excel 97-2003 BIFF8 workbook, got BIFF {book.biff_version}"
        )
    if book.nsheets != 1 or book.sheet_names() != [SHEET_NAME]:
        raise ValueError(
            f"expected exactly one worksheet named {SHEET_NAME!r}, got "
            f"{book.sheet_names()!r}; fingerprint mismatch"
        )
    sheet = book.sheet_by_index(0)
    if sheet.ncols != EXPECTED_COLUMN_COUNT:
        raise ValueError(
            f"expected exactly {EXPECTED_COLUMN_COUNT} populated columns (A:G), "
            f"got {sheet.ncols}; fingerprint mismatch"
        )
    if sheet.nrows <= TRANSACTION_START_ROW:
        raise ValueError(
            f"expected at least {TRANSACTION_START_ROW + 1} rows, got {sheet.nrows}; "
            "fingerprint mismatch"
        )
    return sheet


def parse_letterhead(sheet: xlrd.sheet.Sheet) -> dict[str, Any]:
    """Validate the account letterhead (rows 1-19); extract the account number and period."""
    title = cell_value(sheet, 0, 0)
    title_match = TITLE_RE.fullmatch(title) if isinstance(title, str) else None
    if title_match is None:
        raise ValueError(
            f"A1: expected the HDFC 'Statement of accounts' title, got {title!r}; "
            "fingerprint mismatch"
        )

    texts: list[tuple[int, int, str]] = []
    for row in range(1, LETTERHEAD_LAST_ROW + 1):
        for column in range(sheet.ncols):
            value = cell_value(sheet, row, column)
            if is_blank(value):
                continue
            if not isinstance(value, str):
                raise ValueError(
                    f"{excel_location(row, column)}: expected letterhead text, got {value!r}"
                )
            texts.append((row, column, value))

    def find_one(pattern: re.Pattern[str], label: str) -> tuple[int, int, re.Match[str]]:
        matches = [
            (row, column, match)
            for row, column, value in texts
            for match in [pattern.search(value)]
            if match
        ]
        if len(matches) != 1:
            raise ValueError(
                f"letterhead: expected exactly one {label} cell in rows 2-"
                f"{LETTERHEAD_LAST_ROW + 1}, found {len(matches)}; fingerprint mismatch"
            )
        return matches[0]

    _, _, account = find_one(ACCOUNT_NUMBER_RE, "'Account No :' ")
    find_one(IFSC_RE, "'RTGS/NEFT IFSC :HDFC0...'")
    find_one(CURRENCY_RE, "'Currency :INR'")
    row, column, period = find_one(STATEMENT_PERIOD_RE, "'Statement From ... To ...'")
    location = excel_location(row, column)
    period_from = parse_long_date(period.group("from"), location=location, field="statement start")
    period_to = parse_long_date(period.group("to"), location=location, field="statement end")
    if period_to < period_from:
        raise ValueError(
            f"{location}: statement period ends {period_to.isoformat()} before it "
            f"starts {period_from.isoformat()}"
        )
    return {
        "institution": title_match.group("institution"),
        "account_number": account.group("number"),
        "period_from": period_from,
        "period_to": period_to,
    }


def validate_table_frame(sheet: xlrd.sheet.Sheet) -> None:
    only_columns(sheet, TABLE_FRAME_ROW, {COL_DATE}, "table frame")
    require_asterisks(sheet, TABLE_FRAME_ROW, COL_DATE)
    for column, expected in enumerate(HEADER):
        require_text(sheet, HEADER_ROW, column, expected)
    require_mask_row(sheet, MASK_ROW)


def parse_transaction(
    sheet: xlrd.sheet.Sheet, row: int, previous_date: Optional[date]
) -> dict[str, Any]:
    columns = populated_columns(sheet, row)
    required = {COL_DATE, COL_NARRATION, COL_VALUE_DATE, COL_BALANCE}
    missing = required - columns
    if missing:
        cells = ", ".join(excel_location(row, column) for column in sorted(missing))
        raise ValueError(f"row {row + 1}: transaction is missing required cell(s): {cells}")

    transaction_date = parse_short_date(
        cell_value(sheet, row, COL_DATE), location=excel_location(row, COL_DATE), field="Date"
    )
    if previous_date is not None and transaction_date < previous_date:
        raise ValueError(
            f"{excel_location(row, COL_DATE)}: transaction dates are not oldest-first "
            f"({transaction_date.isoformat()} after {previous_date.isoformat()})"
        )
    narration = cell_value(sheet, row, COL_NARRATION)
    if not isinstance(narration, str) or not narration.strip():
        raise ValueError(f"{excel_location(row, COL_NARRATION)}: empty Narration")
    reference = parse_reference(
        cell_value(sheet, row, COL_REF),
        cell_type(sheet, row, COL_REF),
        location=excel_location(row, COL_REF),
    )
    parse_short_date(
        cell_value(sheet, row, COL_VALUE_DATE),
        location=excel_location(row, COL_VALUE_DATE),
        field="Value Dt",
    )

    withdrawal_cell = cell_value(sheet, row, COL_WITHDRAWAL)
    deposit_cell = cell_value(sheet, row, COL_DEPOSIT)
    withdrawal = (
        Decimal("0.00")
        if is_blank(withdrawal_cell)
        else parse_money(
            withdrawal_cell,
            location=excel_location(row, COL_WITHDRAWAL),
            field="Withdrawal Amt.",
            allow_negative=False,
        )
    )
    deposit = (
        Decimal("0.00")
        if is_blank(deposit_cell)
        else parse_money(
            deposit_cell,
            location=excel_location(row, COL_DEPOSIT),
            field="Deposit Amt.",
            allow_negative=False,
        )
    )
    if (withdrawal > 0) == (deposit > 0):
        raise ValueError(
            f"row {row + 1}: expected exactly one positive amount across "
            f"Withdrawal Amt. / Deposit Amt., got ({withdrawal_cell!r}, {deposit_cell!r})"
        )

    # Overdraft accounts print negative running balances; that is a genuine
    # asset balance below zero, not a credit-card sign convention.
    balance = parse_money(
        cell_value(sheet, row, COL_BALANCE),
        location=excel_location(row, COL_BALANCE),
        field="Closing Balance",
        allow_negative=True,
    )
    return {
        "source_row": row + 1,
        "date": transaction_date,
        # Preserve the Narration cell verbatim; the importer's identity hash and
        # the user's exact-match mappings both key on this text.
        "narration": narration,
        "reference": reference,
        "withdrawal": withdrawal,
        "deposit": deposit,
        "balance": balance,
    }


def parse_transactions(sheet: xlrd.sheet.Sheet) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    row = TRANSACTION_START_ROW
    previous_date: Optional[date] = None
    while row < sheet.nrows and not row_is_blank(sheet, row):
        transaction = parse_transaction(sheet, row, previous_date)
        previous_date = transaction["date"]
        rows.append(transaction)
        row += 1
    if not rows:
        raise ValueError(f"row {TRANSACTION_START_ROW + 1}: no transaction rows found")
    require_blank_row(sheet, row, "the blank separator after the transaction table")
    return rows, row


def parse_summary(sheet: xlrd.sheet.Sheet, separator_row: int) -> dict[str, Any]:
    """Validate the closing mask/rule rows and read the STATEMENT SUMMARY block."""
    row = separator_row + 1
    require_mask_row(sheet, row)
    row += 1
    only_columns(sheet, row, {COL_DATE}, "table frame")
    require_asterisks(sheet, row, COL_DATE)
    row += 1
    require_blank_row(sheet, row, "the blank row before STATEMENT SUMMARY")
    row += 1
    only_columns(sheet, row, {COL_DATE}, "the STATEMENT SUMMARY title row")
    require_text(sheet, row, COL_DATE, SUMMARY_TITLE)
    row += 1
    only_columns(sheet, row, set(SUMMARY_LABELS), "the STATEMENT SUMMARY label row")
    for column, expected in SUMMARY_LABELS.items():
        require_text(sheet, row, column, expected)
    row += 1
    only_columns(sheet, row, set(SUMMARY_LABELS), "the STATEMENT SUMMARY value row")
    opening = parse_money(
        cell_value(sheet, row, COL_DATE),
        location=excel_location(row, COL_DATE),
        field="Opening Balance",
        allow_negative=True,
    )
    debits = parse_money(
        cell_value(sheet, row, COL_WITHDRAWAL),
        location=excel_location(row, COL_WITHDRAWAL),
        field="Debits",
        allow_negative=False,
    )
    credits = parse_money(
        cell_value(sheet, row, COL_DEPOSIT),
        location=excel_location(row, COL_DEPOSIT),
        field="Credits",
        allow_negative=False,
    )
    closing = parse_money(
        cell_value(sheet, row, COL_BALANCE),
        location=excel_location(row, COL_BALANCE),
        field="Closing Bal",
        allow_negative=True,
    )
    row += 1
    require_blank_row(sheet, row, "the blank row before Dr Count / Cr Count")
    row += 1
    only_columns(sheet, row, set(COUNT_LABELS), "the Dr Count / Cr Count label row")
    for column, expected in COUNT_LABELS.items():
        require_text(sheet, row, column, expected)
    row += 1
    only_columns(sheet, row, set(COUNT_LABELS), "the Dr Count / Cr Count value row")
    debit_count = parse_count(
        cell_value(sheet, row, COL_WITHDRAWAL),
        location=excel_location(row, COL_WITHDRAWAL),
        field="Dr Count",
    )
    credit_count = parse_count(
        cell_value(sheet, row, COL_DEPOSIT),
        location=excel_location(row, COL_DEPOSIT),
        field="Cr Count",
    )

    last_populated = max(
        (r for r in range(row + 1, sheet.nrows) if not row_is_blank(sheet, r)),
        default=None,
    )
    if last_populated is None or cell_value(sheet, last_populated, COL_DATE) != END_OF_STATEMENT:
        raise ValueError(
            f"expected the final populated row to be {END_OF_STATEMENT!r}; fingerprint mismatch"
        )
    return {
        "opening": opening,
        "debits": debits,
        "credits": credits,
        "closing": closing,
        "debit_count": debit_count,
        "credit_count": credit_count,
    }


def parse_workbook(book: xlrd.book.Book) -> dict[str, Any]:
    sheet = validate_workbook_fingerprint(book)
    letterhead = parse_letterhead(sheet)
    validate_table_frame(sheet)
    rows, separator_row = parse_transactions(sheet)
    summary = parse_summary(sheet, separator_row)
    return {"letterhead": letterhead, "summary": summary, "rows": rows}


def parse_bytes(data: bytes) -> dict[str, Any]:
    if data[: len(OLE_MAGIC)] != OLE_MAGIC:
        raise ValueError("expected an OLE Compound File / BIFF8 .xls workbook")
    book = xlrd.open_workbook(file_contents=data, on_demand=False)
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
    """Cross-check every printed running balance and the summary block."""
    summary = statement["summary"]
    rows = statement["rows"]

    running = summary["opening"]
    for row in rows:
        running = running + row["deposit"] - row["withdrawal"]
        if running != row["balance"]:
            raise ValueError(
                f"row {row['source_row']}: running balance mismatch; walked "
                f"{running:.2f} but the statement prints {row['balance']:.2f}"
            )
    if running != summary["closing"]:
        raise ValueError(
            f"closing balance mismatch: walked {running:.2f} != STATEMENT SUMMARY "
            f"Closing Bal {summary['closing']:.2f}"
        )

    withdrawals = sum((row["withdrawal"] for row in rows), Decimal("0.00"))
    deposits = sum((row["deposit"] for row in rows), Decimal("0.00"))
    if withdrawals != summary["debits"]:
        raise ValueError(
            f"debit total mismatch: transaction withdrawals {withdrawals:.2f} != "
            f"STATEMENT SUMMARY Debits {summary['debits']:.2f}"
        )
    if deposits != summary["credits"]:
        raise ValueError(
            f"credit total mismatch: transaction deposits {deposits:.2f} != "
            f"STATEMENT SUMMARY Credits {summary['credits']:.2f}"
        )
    debit_count = sum(1 for row in rows if row["withdrawal"] > 0)
    credit_count = sum(1 for row in rows if row["deposit"] > 0)
    if debit_count != summary["debit_count"]:
        raise ValueError(
            f"debit count mismatch: {debit_count} withdrawal row(s) != Dr Count "
            f"{summary['debit_count']}"
        )
    if credit_count != summary["credit_count"]:
        raise ValueError(
            f"credit count mismatch: {credit_count} deposit row(s) != Cr Count "
            f"{summary['credit_count']}"
        )

    return {
        "row_count": len(rows),
        "referenced_count": sum(1 for row in rows if row["reference"] is not None),
        "deposit_total": deposits,
        "withdrawal_total": withdrawals,
        "opening": summary["opening"],
        "closing": summary["closing"],
        "running_balance_checks": len(rows),
        "period_from": statement["letterhead"]["period_from"],
        "period_to": statement["letterhead"]["period_to"],
    }


def json_number(value: Decimal) -> float:
    return float(value)


def to_abacus(statement: dict[str, Any]) -> dict[str, Any]:
    summary = statement["summary"]
    return {
        "kind": "abacus",
        # The letterhead account number, digits only, identifies which bank
        # account this statement belongs to.
        "account": {
            "kind": "bank",
            "identifier": statement["letterhead"]["account_number"],
        },
        # The bank's name as printed in the A1 title; lookup text for presets.
        "institution": statement["letterhead"]["institution"],
        # Bank account: ledger semantics already, no sign flip. Overdraft
        # balances stay negative exactly as printed.
        "opening": json_number(summary["opening"]),
        "closing": json_number(summary["closing"]),
        "rows": [
            {
                "date": row["date"].isoformat(),
                "narration": row["narration"],
                "withdrawal": json_number(row["withdrawal"]),
                "deposit": json_number(row["deposit"]),
                "balance": json_number(row["balance"]),
                # Chq./Ref.No. makes the importer's transaction identity
                # independent of the narration text (a `ref:` key instead of
                # the narration-hashed `semantic:` key). None for the all-zero
                # placeholder on interest rows.
                "source_reference": row["reference"],
            }
            for row in statement["rows"]
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
        output = to_abacus(statement)
    except (OSError, UnicodeError, ValueError, xlrd.XLRDError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

    destination = source.with_suffix(".abacus.json")
    destination.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {destination} ({audit['row_count']} rows, "
        f"{audit['referenced_count']} with a bank reference; "
        f"period={audit['period_from'].isoformat()}..{audit['period_to'].isoformat()}; "
        f"deposits={audit['deposit_total']:.2f}; "
        f"withdrawals={audit['withdrawal_total']:.2f}; "
        f"opening={audit['opening']:.2f}; closing={audit['closing']:.2f}; "
        f"running_balance_checks={audit['running_balance_checks']})"
    )


if __name__ == "__main__":
    main()
