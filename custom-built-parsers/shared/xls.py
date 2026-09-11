"""Reading BIFF8 (.xls) statement workbooks through xlrd.

The bank XLS exports are Excel 97-2003 OLE Compound Files. This module holds
what every such parser needs and none should re-implement: the file-magic
and BIFF8 checks, safe cell access past the populated extent, A1-style
locations for error messages, and the anchor checks that make a parser an
executable fingerprint. Bank-specific structure stays in each parser.
"""
from __future__ import annotations

import re
from typing import Any, Optional, Set

import xlrd

OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
BIFF8 = 80
DIGITS_RE = re.compile(r"^[0-9]+$")


def open_biff8_workbook(data: bytes, *, on_demand: bool = False) -> xlrd.book.Book:
    """Open workbook bytes, rejecting anything that is not an OLE/BIFF8 .xls."""
    if data[: len(OLE_MAGIC)] != OLE_MAGIC:
        raise ValueError("expected an OLE Compound File / BIFF8 .xls workbook")
    book = xlrd.open_workbook(file_contents=data, on_demand=on_demand)
    if book.biff_version != BIFF8:
        book.release_resources()
        raise ValueError(
            f"expected an Excel 97-2003 BIFF8 workbook, got BIFF {book.biff_version}"
        )
    return book


def require_single_sheet(book: xlrd.book.Book, name: str) -> xlrd.sheet.Sheet:
    """The one worksheet a layout has; its name is the cheapest fingerprint."""
    if book.nsheets != 1 or book.sheet_names() != [name]:
        raise ValueError(
            f"expected exactly one worksheet named {name!r}, got {book.sheet_names()}; "
            "fingerprint mismatch"
        )
    return book.sheet_by_index(0)


def require_column_count(sheet: xlrd.sheet.Sheet, count: int) -> None:
    if sheet.ncols != count:
        raise ValueError(
            f"expected exactly {count} populated columns (A:{excel_column(count - 1)}), "
            f"got {sheet.ncols}; fingerprint mismatch"
        )


def excel_column(column: int) -> str:
    letters = ""
    number = column + 1
    while number:
        number, remainder = divmod(number - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


def excel_location(row: int, column: int) -> str:
    """A compact A1-style location for zero-based row/column indexes."""
    return f"{excel_column(column)}{row + 1}"


def cell_value(sheet: xlrd.sheet.Sheet, row: int, column: int) -> Any:
    """The cell's value, or "" beyond the populated extent (xlrd would raise)."""
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


def populated_columns(sheet: xlrd.sheet.Sheet, row: int) -> Set[int]:
    return {
        column
        for column in range(sheet.ncols)
        if not is_blank(cell_value(sheet, row, column))
    }


def require_text(sheet: xlrd.sheet.Sheet, row: int, column: int, expected: str) -> None:
    """An exact anchor cell; a different value is a fingerprint mismatch."""
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
    pattern: "re.Pattern[str]",
    label: str,
) -> "re.Match[str]":
    """A text anchor cell matched by a pattern; returns the match for its groups."""
    value = cell_value(sheet, row, column)
    match = pattern.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise ValueError(
            f"{excel_location(row, column)}: invalid {label}; fingerprint mismatch"
        )
    return match


def require_digits(sheet: xlrd.sheet.Sheet, row: int, column: int, what: str) -> str:
    """A digit-string text cell (an identifier that must not be read as a number)."""
    value = cell_value(sheet, row, column)
    if not isinstance(value, str) or not DIGITS_RE.fullmatch(value):
        raise ValueError(
            f"{excel_location(row, column)}: fingerprint mismatch; "
            f"expected the {what} as a digit string, got {value!r}"
        )
    return value


def only_columns(sheet: xlrd.sheet.Sheet, row: int, allowed: Set[int], what: str) -> None:
    """No populated cell outside the allowed columns on this row."""
    unexpected = populated_columns(sheet, row) - allowed
    if unexpected:
        cells = ", ".join(excel_location(row, column) for column in sorted(unexpected))
        raise ValueError(f"row {row + 1}: unexpected populated cell(s) in {what}: {cells}")


def require_blank_row(sheet: xlrd.sheet.Sheet, row: int, what: str) -> None:
    if row >= sheet.nrows:
        raise ValueError(f"row {row + 1}: missing {what}; sheet ends early")
    if not row_is_blank(sheet, row):
        cells = ", ".join(
            excel_location(row, column) for column in sorted(populated_columns(sheet, row))
        )
        raise ValueError(f"row {row + 1}: expected {what} but found populated cell(s): {cells}")


def first_text_cell(sheet: xlrd.sheet.Sheet, column: int, pattern: "re.Pattern[str]") -> Optional["re.Match[str]"]:
    """The first cell in a column whose text matches, scanning every row."""
    for row in range(sheet.nrows):
        value = cell_value(sheet, row, column)
        if isinstance(value, str):
            match = pattern.match(value.strip())
            if match:
                return match
    return None
