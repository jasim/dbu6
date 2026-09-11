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


PARSER = load_module("hdfc_cc_xls_parser", HERE / "parser.py")
FIXTURE = load_module("hdfc_cc_xls_fixture", HERE / "fixtures" / "generate_fixture.py")

COMMITTED_FIXTURE = (HERE / "fixtures" / "sanitized-statement.xls").read_bytes()
CARD_CELL = (FIXTURE.CARD_NUMBER_CELL, 2, 13)


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
        output = PARSER.to_abacus(statement, audit).to_json()

        self.assertEqual(audit["row_count"], 5)
        self.assertEqual(audit["deposit_total"], Decimal("600.00"))
        self.assertEqual(audit["withdrawal_total"], Decimal("1230.00"))
        self.assertEqual(audit["opening"], Decimal("1000.37"))
        self.assertEqual(audit["exact_closing"], Decimal("1630.37"))
        self.assertEqual(audit["displayed_total_due"], Decimal("1630.00"))
        self.assertEqual(audit["running_balance_checks"], 0)

        # Credit-card liabilities are negative, and the exact paise closing is
        # preserved rather than the rupee-rounded Total Dues.
        self.assertEqual(output["kind"], "abacus")
        self.assertEqual(output["opening"], -1000.37)
        self.assertEqual(output["closing"], -1630.37)
        self.assertEqual(
            [row["date"] for row in output["rows"]],
            ["2026-05-15", "2026-05-16", "2026-05-20", "2026-06-10", "2026-06-18"],
        )
        self.assertTrue(all(row["balance"] is None for row in output["rows"]))
        payment = output["rows"][2]
        self.assertEqual((payment["deposit"], payment["withdrawal"]), (500.0, 0.0))
        self.assertEqual(payment["source_reference"], "05050500000000000000001")
        self.assertIsNone(output["rows"][0]["source_reference"])
        self.assertEqual(output["rows"][1]["narration"], "Sample Online www.sample  USD2.40")

    def test_emits_the_masked_card_number_as_the_identifier(self) -> None:
        statement = PARSER.parse_bytes(COMMITTED_FIXTURE)
        self.assertEqual(statement["card_account"].identifier, "050505XXXXXX0505")
        output = PARSER.to_abacus(statement, PARSER.validate(statement)).to_json()
        self.assertEqual(output["account"], {"kind": "card", "identifier": "050505XXXXXX0505"})

    def test_emits_the_registered_office_issuer_name_verbatim(self) -> None:
        statement = PARSER.parse_bytes(COMMITTED_FIXTURE)
        self.assertEqual(statement["institution"], "HDFC Bank Cards Division")
        output = PARSER.to_abacus(statement, PARSER.validate(statement)).to_json()
        self.assertEqual(output["institution"], "HDFC Bank Cards Division")

    def test_institution_is_null_without_the_registered_office_cell(self) -> None:
        rows = FIXTURE.sample_rows()
        index = next(i for i, row in enumerate(rows) if str(row[0]).startswith("Registered Office"))
        del rows[index]
        self.assertIsNone(parse_rows(rows)["institution"])

    def test_missing_or_malformed_card_number_is_rejected(self) -> None:
        for replacement in (
            "",
            "Credit Card No.: ",
            "Credit Card No.: 0505 05XX XXXX 0505",
            "Credit Card No.: 0505050505050505",
            "Credit Card No.: 050505xxxxxx0505",
            "Card No: 050505XXXXXX0505",
        ):
            with self.subTest(cell=replacement):
                rows = FIXTURE.sample_rows()
                rows[2][13] = replacement
                with self.assertRaisesRegex(ValueError, "N3: invalid masked card number"):
                    parse_rows(rows)

    def test_generator_reproduces_the_committed_fixture(self) -> None:
        generated = FIXTURE.workbook_bytes(FIXTURE.sample_rows())
        expected = PARSER.parse_bytes(COMMITTED_FIXTURE)
        expected_output = PARSER.to_abacus(expected, PARSER.validate(expected)).to_json()
        parsed = PARSER.parse_bytes(generated)
        self.assertEqual(PARSER.to_abacus(parsed, PARSER.validate(parsed)).to_json(), expected_output)

    def test_credit_total_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[15][5] = "601.00"
        with self.assertRaisesRegex(ValueError, "credit total mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_debit_total_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[15][10] = "1,100.00"
        with self.assertRaisesRegex(ValueError, "debit total mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_rounded_due_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[15][0] = "1,001.37"
        with self.assertRaisesRegex(ValueError, "rounded due mismatch"):
            PARSER.validate(parse_rows(rows))

    def test_displayed_due_mismatch_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[7][4] = "1,631.00"
        with self.assertRaisesRegex(ValueError, "displayed due mismatch"):
            parse_rows(rows)

    def test_unrecognized_row_inside_the_table_is_not_skipped(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 12, "SAMPLE MERCHANT ONE BANGALORE")
        rows[index][0] = "Subtotal"
        with self.assertRaisesRegex(ValueError, "expected Domestic or International"):
            parse_rows(rows)

    def test_domestic_rows_cannot_follow_international_rows(self) -> None:
        rows = FIXTURE.sample_rows()
        first_international = find_row(rows, 12, "Sample Online www.sample  USD2.40")
        emi = find_row(rows, 12, "OFFUS EMI,INT NBR:01,0 0000050505050 (Ref# 05050500000000000000002)")
        rows[first_international], rows[emi] = rows[emi], rows[first_international]
        with self.assertRaisesRegex(ValueError, "Domestic rows cannot follow"):
            parse_rows(rows)

    def test_transaction_after_the_statement_date_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        index = find_row(rows, 12, "SAMPLE MERCHANT ONE BANGALORE")
        rows[index][9] = "19/06/2026 / 10:00"
        with self.assertRaisesRegex(ValueError, "after statement date"):
            parse_rows(rows)

    def test_missing_reward_points_summary_after_the_table_is_rejected(self) -> None:
        rows = FIXTURE.sample_rows()
        rows[find_row(rows, 0, "Reward Points Summary")][0] = "Something Else"
        with self.assertRaisesRegex(ValueError, "expected Reward Points Summary"):
            parse_rows(rows)

    def test_bank_statement_style_workbook_is_rejected(self) -> None:
        # The HDFC bank-account XLS uses a single sheet named "Sheet 1".
        with self.assertRaisesRegex(ValueError, "worksheet named 'Statement'"):
            parse_rows(FIXTURE.sample_rows(), sheet_name="Sheet 1")

    def test_non_ole_input_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "BIFF8"):
            PARSER.parse_bytes(b"Name~|~SAMPLE CARDHOLDER\r\n")


if __name__ == "__main__":
    unittest.main()
