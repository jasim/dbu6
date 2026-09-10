#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = ["xlrd==2.0.2", "xlwt==1.3.0"]
# ///
from __future__ import annotations

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PARSER = load_module("hdfc_bank_xls_parser", HERE / "parser.py")
FIXTURE = load_module("hdfc_bank_xls_fixture", HERE / "fixtures" / "generate_fixture.py")

COMMITTED_FIXTURE = (HERE / "fixtures" / "sanitized-statement.xls").read_bytes()


def find_row(rows: list[list[Any]], column: int, value: Any) -> int:
    matches = [index for index, row in enumerate(rows) if row[column] == value]
    assert len(matches) == 1, f"expected exactly one row with column {column} == {value!r}"
    return matches[0]


def parse_rows(rows: list[list[Any]], **kwargs: Any) -> dict[str, Any]:
    return PARSER.parse_bytes(FIXTURE.workbook_bytes(rows, **kwargs))


class ParserTests(unittest.TestCase):
    def test_committed_fixture_parses_and_reconciles_every_anchor(self) -> None:
        statement = PARSER.parse_bytes(COMMITTED_FIXTURE)
        audit = PARSER.validate(statement)
        output = PARSER.to_abacus(statement)

        self.assertEqual(audit["row_count"], 8)
        self.assertEqual(audit["referenced_count"], 6)
        self.assertEqual(audit["running_balance_checks"], 8)
        self.assertEqual(audit["deposit_total"], Decimal("31062"))
        self.assertEqual(audit["withdrawal_total"], Decimal("35283"))
        self.assertEqual(audit["opening"], Decimal("100000"))
        self.assertEqual(audit["closing"], Decimal("95779"))
        self.assertEqual(audit["period_from"].isoformat(), "2026-07-01")
        self.assertEqual(audit["period_to"].isoformat(), "2026-07-31")

        self.assertEqual(output["kind"], "abacus")
        self.assertEqual(output["opening"], 100000.0)
        self.assertEqual(output["closing"], 95779.0)
        self.assertEqual(len(output["rows"]), 8)
        first = output["rows"][0]
        self.assertEqual(first["date"], "2026-07-01")
        self.assertEqual(first["narration"], "IB BILLPAY DR-HDFCSI-050505XXXXXX0505")
        self.assertEqual(first["withdrawal"], 20000.0)
        self.assertEqual(first["deposit"], 0.0)
        self.assertEqual(first["balance"], 80000.0)
        self.assertEqual(first["source_reference"], "050505050505ABCD")
        self.assertEqual(output["rows"][2]["source_reference"], "FDRLR050505050505050505")
        # Interest rows dated on the 1st of the next month keep their posting
        # date, and their all-zero Chq./Ref.No. placeholder is not a reference.
        self.assertEqual(output["rows"][-1]["date"], "2026-08-01")
        self.assertEqual(output["rows"][-1]["narration"], "INTEREST DEBITED TILL 31-JUL-2026")
        self.assertEqual(
            [row["source_reference"] is None for row in output["rows"]],
            [False, False, False, False, False, False, True, True],
        )
        self.assertTrue(all(row["balance"] is not None for row in output["rows"]))

    def test_reference_placeholders_and_blanks_yield_none(self) -> None:
        import xlrd

        parse = PARSER.parse_reference
        self.assertEqual(parse("050505050505ABCD", xlrd.XL_CELL_TEXT, location="C23"), "050505050505ABCD")
        self.assertEqual(parse(" 0505050505050505 ", xlrd.XL_CELL_TEXT, location="C23"), "0505050505050505")
        self.assertEqual(parse(505050505.0, xlrd.XL_CELL_NUMBER, location="C23"), "505050505")
        self.assertIsNone(parse("000000000000000", xlrd.XL_CELL_TEXT, location="C23"))
        self.assertIsNone(parse("", xlrd.XL_CELL_EMPTY, location="C23"))
        with self.assertRaisesRegex(ValueError, "expected Chq./Ref.No. text"):
            parse(True, xlrd.XL_CELL_BOOLEAN, location="C23")
        with self.assertRaisesRegex(ValueError, "expected a whole number"):
            parse(5.5, xlrd.XL_CELL_NUMBER, location="C23")

    def test_generator_reproduces_the_committed_fixture(self) -> None:
        generated = FIXTURE.workbook_bytes(FIXTURE.sample_rows())
        expected = PARSER.to_abacus(PARSER.parse_bytes(COMMITTED_FIXTURE))
        self.assertEqual(PARSER.to_abacus(PARSER.parse_bytes(generated)), expected)

    def test_running_balance_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 1, "IMPS-050505050505-NOPII PAYER-FDRL-XXXXXXXXXX0505-sample")
        rows[index][6] = rows[index][6] + 1.0
        with self.assertRaisesRegex(ValueError, "running balance mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_summary_closing_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 0, "Opening Balance") + 1
        rows[index][6] = 95780.0
        with self.assertRaisesRegex(ValueError, "closing balance mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_summary_debit_total_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 0, "Opening Balance") + 1
        rows[index][4] = 35284.0
        with self.assertRaisesRegex(ValueError, "debit total mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_summary_count_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 4, "Dr Count") + 1
        rows[index][5] = 5.0
        with self.assertRaisesRegex(ValueError, "credit count mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_unrecognized_row_inside_the_table_is_not_skipped(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 1, "INTEREST PAID TILL 31-JUL-2026")
        rows.insert(index, list(rows[PARSER.HEADER_ROW]))
        with self.assertRaisesRegex(ValueError, "invalid Date 'Date'"):
            parse_rows(rows)

    def test_both_amounts_populated_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 1, "INTEREST PAID TILL 31-JUL-2026")
        rows[index][4] = 5.0
        with self.assertRaisesRegex(ValueError, "exactly one positive amount"):
            parse_rows(rows)

    def test_blank_balance_cell_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 1, "INTEREST PAID TILL 31-JUL-2026")
        rows[index][6] = ""
        with self.assertRaisesRegex(ValueError, "missing required cell"):
            parse_rows(rows)

    def test_out_of_order_dates_are_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 1, "INTEREST PAID TILL 31-JUL-2026")
        rows[index][0] = "30/06/26"
        with self.assertRaisesRegex(ValueError, "not oldest-first"):
            parse_rows(rows)

    def test_missing_separator_after_table_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 1, "INTEREST DEBITED TILL 31-JUL-2026") + 1
        del rows[index]
        with self.assertRaisesRegex(ValueError, "invalid Date '\\*\\*\\*\\*\\*\\*\\*\\*'"):
            parse_rows(rows)

    def test_header_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[PARSER.HEADER_ROW][1] = "Description"
        with self.assertRaisesRegex(ValueError, "B21: fingerprint mismatch"):
            parse_rows(rows)

    def test_missing_end_of_statement_marker_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        del rows[find_row(rows, 0, "---  End Of Statement ---")]
        with self.assertRaisesRegex(ValueError, "End Of Statement"):
            parse_rows(rows)

    def test_missing_letterhead_marker_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 4, "RTGS/NEFT IFSC :HDFC0050505   MICR :050505000")
        rows[index][4] = "RTGS/NEFT IFSC :FDRL0050505   MICR :050505000"
        with self.assertRaisesRegex(ValueError, "RTGS/NEFT IFSC"):
            parse_rows(rows)

    def test_credit_card_style_workbook_is_rejected(self) -> None:
        # The HDFC credit-card XLS uses a single sheet named "Statement".
        with self.assertRaisesRegex(ValueError, "worksheet named 'Sheet 1'"):
            parse_rows(FIXTURE.sample_rows(), sheet_name="Statement")

    def test_money_cells_accept_negative_only_where_allowed(self) -> None:
        # Overdraft statements print negative balances; the fixture deliberately
        # has none, so the sign rule is checked at the function level.
        self.assertEqual(
            PARSER.parse_money(-5.0, location="G23", field="Closing Balance", allow_negative=True),
            Decimal("-5.00"),
        )
        with self.assertRaisesRegex(ValueError, "negative Withdrawal Amt."):
            PARSER.parse_money(-5.0, location="E23", field="Withdrawal Amt.", allow_negative=False)
        with self.assertRaisesRegex(ValueError, "more than two decimal places"):
            PARSER.parse_money(5.005, location="E23", field="Withdrawal Amt.", allow_negative=False)

    def test_non_ole_input_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "BIFF8"):
            PARSER.parse_bytes(b"Date,Narration\n01/07/26,not a workbook\n")


if __name__ == "__main__":
    unittest.main()
