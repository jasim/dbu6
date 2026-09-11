#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2", "xlwt==1.3.0"]
# ///
from __future__ import annotations

import re
import sys
import unittest
from io import BytesIO
from pathlib import Path

import xlrd
import xlwt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared import xls  # noqa: E402


def workbook_bytes(rows, *, sheet_name="Statement") -> bytes:
    book = xlwt.Workbook()
    sheet = book.add_sheet(sheet_name)
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if value != "":
                sheet.write(r, c, value)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


SAMPLE = [
    ["Account No :", "", "050505000012"],
    ["", "", ""],
    ["Registered Office Address: SAMPLE BANK Ltd., sample Road", "", 5.0],
]


class WorkbookTests(unittest.TestCase):
    def test_opens_biff8_and_rejects_other_bytes(self) -> None:
        book = xls.open_biff8_workbook(workbook_bytes(SAMPLE))
        self.assertEqual(book.sheet_names(), ["Statement"])
        book.release_resources()
        with self.assertRaisesRegex(ValueError, "OLE Compound File / BIFF8"):
            xls.open_biff8_workbook(b"Date,Narration\n01/07/26,not a workbook\n")

    def test_single_sheet_and_column_count_are_fingerprints(self) -> None:
        book = xls.open_biff8_workbook(workbook_bytes(SAMPLE))
        with self.assertRaisesRegex(ValueError, "worksheet named 'Sheet 1', got \\['Statement'\\]"):
            xls.require_single_sheet(book, "Sheet 1")
        sheet = xls.require_single_sheet(book, "Statement")
        xls.require_column_count(sheet, 3)
        with self.assertRaisesRegex(ValueError, "expected exactly 7 populated columns \\(A:G\\), got 3"):
            xls.require_column_count(sheet, 7)


class CellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.book = xls.open_biff8_workbook(workbook_bytes(SAMPLE))
        cls.sheet = cls.book.sheet_by_index(0)

    def test_excel_locations(self) -> None:
        self.assertEqual(xls.excel_location(0, 0), "A1")
        self.assertEqual(xls.excel_location(8, 2), "C9")
        self.assertEqual(xls.excel_location(2, 25), "Z3")
        self.assertEqual(xls.excel_location(0, 26), "AA1")

    def test_cells_beyond_the_populated_extent_read_as_blank(self) -> None:
        self.assertEqual(xls.cell_value(self.sheet, 0, 2), "050505000012")
        self.assertEqual(xls.cell_value(self.sheet, 99, 0), "")
        self.assertEqual(xls.cell_value(self.sheet, 0, 99), "")
        self.assertEqual(xls.cell_type(self.sheet, 2, 2), xlrd.XL_CELL_NUMBER)
        self.assertEqual(xls.cell_type(self.sheet, 99, 0), xlrd.XL_CELL_EMPTY)
        self.assertTrue(xls.row_is_blank(self.sheet, 1))
        self.assertFalse(xls.row_is_blank(self.sheet, 0))
        self.assertEqual(xls.populated_columns(self.sheet, 0), {0, 2})

    def test_anchor_checks(self) -> None:
        xls.require_text(self.sheet, 0, 0, "Account No :")
        with self.assertRaisesRegex(ValueError, "A1: fingerprint mismatch; expected 'Customer'"):
            xls.require_text(self.sheet, 0, 0, "Customer")
        self.assertEqual(xls.require_digits(self.sheet, 0, 2, "account number"), "050505000012")
        with self.assertRaisesRegex(ValueError, "C3: fingerprint mismatch; expected the id as a digit string"):
            xls.require_digits(self.sheet, 2, 2, "id")
        match = xls.require_matching_text(
            self.sheet, 0, 2, re.compile(r"^(?P<number>[0-9]+)$"), "account number"
        )
        self.assertEqual(match.group("number"), "050505000012")
        with self.assertRaisesRegex(ValueError, "A1: invalid account number; fingerprint mismatch"):
            xls.require_matching_text(self.sheet, 0, 0, re.compile(r"^[0-9]+$"), "account number")

    def test_row_shape_checks(self) -> None:
        xls.only_columns(self.sheet, 0, {0, 2}, "the account row")
        with self.assertRaisesRegex(ValueError, "row 1: unexpected populated cell\\(s\\) in the account row: C1"):
            xls.only_columns(self.sheet, 0, {0}, "the account row")
        xls.require_blank_row(self.sheet, 1, "separator")
        with self.assertRaisesRegex(ValueError, "row 1: expected separator but found populated cell\\(s\\): A1, C1"):
            xls.require_blank_row(self.sheet, 0, "separator")
        with self.assertRaisesRegex(ValueError, "row 100: missing separator; sheet ends early"):
            xls.require_blank_row(self.sheet, 99, "separator")

    def test_first_text_cell_scans_a_column(self) -> None:
        match = xls.first_text_cell(
            self.sheet, 0, re.compile(r"^Registered Office Address:\s*(?P<name>[^,]+)")
        )
        self.assertIsNotNone(match)
        self.assertEqual(match.group("name"), "SAMPLE BANK Ltd.")
        self.assertIsNone(xls.first_text_cell(self.sheet, 1, re.compile(r"^Registered")))


if __name__ == "__main__":
    unittest.main()
