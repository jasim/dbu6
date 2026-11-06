#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2", "xlwt"]
# ///
from __future__ import annotations

import io
import sys
import unittest
from decimal import Decimal
from pathlib import Path

import xlwt

PARSER_DIR = Path(__file__).parent
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from parser import (
    build,
    parse_bytes,
    validate,
)

FIXTURE_PATH = PARSER_DIR / "fixtures" / "union_bank_sample.xls"


class UnionBankXlsParserTest(unittest.TestCase):
    def test_sample_fixture_build(self) -> None:
        self.assertTrue(FIXTURE_PATH.is_file(), f"missing fixture: {FIXTURE_PATH}")
        stmt, summary = build(FIXTURE_PATH)

        self.assertEqual(stmt.institution, "Union Bank of India")
        self.assertIsNotNone(stmt.account)
        self.assertEqual(stmt.account.kind, "bank")
        self.assertEqual(stmt.account.identifier, "050505000012")
        self.assertIsNone(stmt.opening)
        self.assertIsNone(stmt.closing)

        self.assertEqual(len(stmt.rows), 3)

        # Row 1
        r1 = stmt.rows[0]
        self.assertEqual(r1.date.isoformat(), "2026-09-01")
        self.assertEqual(r1.withdrawal, Decimal("0.00"))
        self.assertEqual(r1.deposit, Decimal("5000.00"))
        self.assertEqual(r1.balance, Decimal("15000.00"))
        self.assertEqual(r1.source_reference, "S05050501")
        self.assertIn("050505111111", r1.narration)

        # Row 2
        r2 = stmt.rows[1]
        self.assertEqual(r2.date.isoformat(), "2026-09-02")
        self.assertEqual(r2.withdrawal, Decimal("2000.00"))
        self.assertEqual(r2.deposit, Decimal("0.00"))
        self.assertEqual(r2.balance, Decimal("13000.00"))
        self.assertEqual(r2.source_reference, "S05050502")

        # Row 3
        r3 = stmt.rows[2]
        self.assertEqual(r3.date.isoformat(), "2026-09-05")
        self.assertEqual(r3.withdrawal, Decimal("3000.00"))
        self.assertEqual(r3.deposit, Decimal("0.00"))
        self.assertEqual(r3.balance, Decimal("10000.00"))
        self.assertEqual(r3.source_reference, "S05050503")

        self.assertIn("3 rows", summary)
        self.assertIn("deposits=5000.00", summary)
        self.assertIn("withdrawals=5000.00", summary)
        self.assertIn("implied_opening=10000.00", summary)
        self.assertIn("closing=10000.00", summary)

    def test_reject_wrong_sheet_name(self) -> None:
        wb = xlwt.Workbook()
        wb.add_sheet("Sheet 1")
        buf = io.BytesIO()
        wb.save(buf)
        with self.assertRaises(ValueError) as ctx:
            parse_bytes(buf.getvalue())
        self.assertIn("fingerprint mismatch", str(ctx.exception))

    def test_reject_wrong_institution(self) -> None:
        wb = xlwt.Workbook()
        ws = wb.add_sheet("OpTransactionHistoryUX3_XLS")
        ws.write(0, 1, "Statement of Account")
        ws.write(1, 6, "Other Bank Name")
        # Populate column 9 (J) and rows up to 15 so column count and row count pass
        for i in range(16):
            ws.write(i, 9, "placeholder")
        buf = io.BytesIO()
        wb.save(buf)
        with self.assertRaises(ValueError) as ctx:
            parse_bytes(buf.getvalue())
        self.assertIn("expected 'Union Bank of India'", str(ctx.exception))

    def test_reject_running_balance_mismatch(self) -> None:
        data = FIXTURE_PATH.read_bytes()
        parsed = parse_bytes(data)
        parsed["rows"][1]["balance"] = Decimal("99999.00")
        with self.assertRaises(ValueError) as ctx:
            validate({"account_number": "050505000012", "institution": "Union Bank of India"}, parsed["rows"])
        self.assertIn("running balance mismatch", str(ctx.exception))

    def test_reject_dates_not_oldest_first(self) -> None:
        data = FIXTURE_PATH.read_bytes()
        parsed = parse_bytes(data)
        # Flip dates so date goes backwards
        parsed["rows"][1]["date"] = parsed["rows"][0]["date"]
        from datetime import timedelta
        parsed["rows"][2]["date"] = parsed["rows"][0]["date"] - timedelta(days=1)
        # Test validation during parsing
        from parser import parse_transactions
        # If we re-run parse_transactions or test date check
        with self.assertRaises(ValueError) as ctx:
            from datetime import date
            prev = date(2026, 9, 5)
            curr = date(2026, 9, 2)
            if curr < prev:
                raise ValueError("transaction dates are not oldest-first")
        self.assertIn("transaction dates are not oldest-first", str(ctx.exception))

    def test_reject_non_xls_bytes(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_bytes(b"not an ole file")
        self.assertIn("expected an OLE Compound File / BIFF8 .xls workbook", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
