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


PARSER = load_module("federal_bank_xls_parser", HERE / "parser.py")
FIXTURE = load_module("federal_bank_xls_fixture", HERE / "fixtures" / "generate_fixture.py")

COMMITTED_FIXTURE = (HERE / "fixtures" / "sanitized-statement.xls").read_bytes()

# (narration, source_reference) per fixture row: narration is the Particulars
# cell verbatim; the reference is the bank's numeric field where the layout
# has one.
EXPECTED_ROWS = [
    ("UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505", "050505000001"),
    ("TO ATM/050505000002/sample CITY 050505\\sample", "050505000002"),
    ("UPIOUT/050505000003/UPI050505sample/0505", "050505000003"),
    ("FT IMPS/IFI/050505000004/NOPII CUSTOMER/sample remark", "050505000004"),
    ("UPIOUT/050505000005/q050505@ybl/UPI/0505", "050505000005"),
    ("UPIOUT/050505000006/sample-cafe@okhdfcbank//0000", "050505000006"),
    ("UPI IN/050505000007/sample-shop@okicici/sample/0000", "050505000007"),
    ("SMS CHARGES sample", None),
    ("NEFT/050505000009/NOPII EMPLOYER/sample salary", None),
]
UPI_ROW = "UPIOUT/050505000005/q050505@ybl/UPI/0505"


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
        output = PARSER.to_abacus(statement).to_json()

        self.assertEqual(audit["row_count"], 9)
        self.assertEqual(audit["referenced_count"], 7)
        self.assertEqual(audit["running_balance_checks"], 8)
        self.assertEqual(audit["deposit_total"], Decimal("50325"))
        self.assertEqual(audit["withdrawal_total"], Decimal("7060"))
        self.assertEqual(audit["implied_opening"], Decimal("100000"))
        self.assertEqual(audit["closing"], Decimal("143265"))
        self.assertEqual(audit["statement_date"].isoformat(), "2026-08-05")

        self.assertEqual(output["kind"], "abacus")
        self.assertIsNone(output["opening"])
        self.assertIsNone(output["closing"])
        self.assertEqual(
            [(row["narration"], row["source_reference"]) for row in output["rows"]],
            EXPECTED_ROWS,
        )
        first = output["rows"][0]
        self.assertEqual(first["date"], "2026-07-01")
        self.assertEqual(first["withdrawal"], 500.0)
        self.assertEqual(first["deposit"], 0.0)
        self.assertEqual(first["balance"], 99500.0)
        self.assertEqual(output["rows"][-1]["date"], "2026-07-31")
        self.assertEqual(output["rows"][-1]["balance"], 143265.0)
        self.assertTrue(all(row["balance"] is not None for row in output["rows"]))

    def test_emits_the_account_row_number_as_the_bank_identifier(self) -> None:
        statement = PARSER.parse_bytes(COMMITTED_FIXTURE)
        self.assertEqual(statement["letterhead"]["account_number"], "050505000012")
        self.assertEqual(
            PARSER.to_abacus(statement).to_json()["account"],
            {"kind": "bank", "identifier": "050505000012"},
        )

    def test_institution_is_null_because_the_export_prints_no_bank_name(self) -> None:
        statement = PARSER.parse_bytes(COMMITTED_FIXTURE)
        self.assertIsNone(PARSER.to_abacus(statement).to_json()["institution"])

    def test_missing_or_malformed_account_number_is_rejected(self) -> None:
        for replacement in ("", "0505 05000012", "05050500001X", 50505000012.0):
            with self.subTest(cell=replacement):
                rows = FIXTURE.sample_rows()
                rows[PARSER.ACCOUNT_ROW][PARSER.ACCOUNT_NUMBER_COLUMN] = replacement
                with self.assertRaisesRegex(ValueError, "C9: fingerprint mismatch"):
                    parse_rows(rows)

    def test_generator_reproduces_the_committed_fixture(self) -> None:
        generated = FIXTURE.workbook_bytes(FIXTURE.sample_rows())
        expected = PARSER.to_abacus(PARSER.parse_bytes(COMMITTED_FIXTURE)).to_json()
        self.assertEqual(PARSER.to_abacus(PARSER.parse_bytes(generated)).to_json(), expected)

    def test_extract_reference_knows_each_layout(self) -> None:
        extract = PARSER.extract_reference
        self.assertEqual(extract("UPIOUT/050505000001/sample@okaxis/UPI/0000", location="C12"), "050505000001")
        self.assertEqual(extract("UPI IN/050505000002/sample@okaxis/sample/0000", location="C12"), "050505000002")
        self.assertEqual(extract("TO ATM/050505000003/sample", location="C12"), "050505000003")
        self.assertEqual(extract("FT IMPS/IFI/050505000004/NOPII/sample", location="C12"), "050505000004")
        self.assertIsNone(extract("NEFT/050505000005/NOPII/sample", location="C12"))
        self.assertIsNone(extract("SMS CHARGES sample", location="C12"))
        with self.assertRaisesRegex(ValueError, "C12: 'UPIOUT' Particulars .* has no numeric reference in field 2"):
            extract("UPIOUT/sample@okaxis/UPI/0000", location="C12")
        with self.assertRaisesRegex(ValueError, "no numeric reference in field 2"):
            extract("UPIOUT", location="C12")
        with self.assertRaisesRegex(ValueError, "no numeric reference in field 3"):
            extract("FT IMPS/IFI/NOPII/sample", location="C12")

    def test_known_prefix_without_reference_is_rejected_in_the_table(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][2] = "UPIOUT/q050505@ybl/UPI/0505"
        with self.assertRaisesRegex(ValueError, "C16: 'UPIOUT' Particulars"):
            parse_rows(rows)

    def test_running_balance_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][9] = "1,33,551.00"
        with self.assertRaisesRegex(ValueError, "running balance mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_serial_number_gap_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][0] = 7.0
        with self.assertRaisesRegex(ValueError, "Sl. No. 7 out of sequence; expected 5"):
            parse_rows(rows)

    def test_unrecognized_row_inside_the_table_is_not_skipped(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows.insert(index, list(rows[PARSER.HEADER_ROW]))
        with self.assertRaisesRegex(ValueError, "invalid Sl. No. 'Sl. No.'"):
            parse_rows(rows)

    def test_both_amounts_populated_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][8] = "5.00"
        with self.assertRaisesRegex(ValueError, "exactly one positive amount"):
            parse_rows(rows)

    def test_blank_balance_cell_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][9] = ""
        with self.assertRaisesRegex(ValueError, "missing required cell"):
            parse_rows(rows)

    def test_spill_column_must_stay_blank(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][3] = "spill"
        with self.assertRaisesRegex(ValueError, "unexpected populated cell\\(s\\) in a transaction: D16"):
            parse_rows(rows)

    def test_out_of_order_dates_are_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 2, UPI_ROW)
        rows[index][1] = "04-07-2026"
        with self.assertRaisesRegex(ValueError, "not oldest-first"):
            parse_rows(rows)

    def test_missing_footer_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        del rows[find_row(rows, 0, FIXTURE.FOOTER)]
        with self.assertRaisesRegex(ValueError, "sheet ends early"):
            parse_rows(rows)

    def test_populated_row_after_footer_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows.append(["trailing"] + [""] * 9)
        with self.assertRaisesRegex(ValueError, "unexpected populated row after the footer"):
            parse_rows(rows)

    def test_header_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[PARSER.HEADER_ROW][1] = "Date"
        with self.assertRaisesRegex(ValueError, "B11: fingerprint mismatch"):
            parse_rows(rows)

    def test_account_row_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[PARSER.ACCOUNT_ROW][0] = "Account Number:"
        with self.assertRaisesRegex(ValueError, "A9: fingerprint mismatch"):
            parse_rows(rows)

    def test_statement_date_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[PARSER.STATEMENT_DATE_ROW][8] = "2026-08-05"
        with self.assertRaisesRegex(ValueError, "I10: invalid statement date"):
            parse_rows(rows)

    def test_hdfc_style_workbook_is_rejected(self) -> None:
        # The HDFC bank XLS uses a single sheet named "Sheet 1".
        with self.assertRaisesRegex(ValueError, "worksheet named 'OpTransactionHistoryTpr'"):
            parse_rows(FIXTURE.sample_rows(), sheet_name="Sheet 1")

    def test_money_cells_accept_indian_grouping_and_reject_bad_signs(self) -> None:
        self.assertEqual(
            PARSER.parse_money("1,00,000.00", location="J12", field="Balance Amount", allow_negative=True),
            Decimal("100000.00"),
        )
        self.assertEqual(
            PARSER.parse_money("-5.00", location="J12", field="Balance Amount", allow_negative=True),
            Decimal("-5.00"),
        )
        with self.assertRaisesRegex(ValueError, "negative Withdrawal"):
            PARSER.parse_money("-5.00", location="H12", field="Withdrawal", allow_negative=False)
        with self.assertRaisesRegex(ValueError, "invalid Withdrawal amount '5'"):
            PARSER.parse_money("5", location="H12", field="Withdrawal", allow_negative=False)

    def test_non_ole_input_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "BIFF8"):
            PARSER.parse_bytes(b"Sl. No.,Tran Date\n1,01-07-2026\n")


if __name__ == "__main__":
    unittest.main()
