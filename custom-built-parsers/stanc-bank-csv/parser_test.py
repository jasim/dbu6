from __future__ import annotations

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("stanc_bank_csv_parser", HERE / "parser.py")
assert SPEC is not None and SPEC.loader is not None
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)


VALID_STATEMENT = (HERE / "fixtures" / "sanitized-statement.csv").read_text()


class ParserTests(unittest.TestCase):
    def test_parse_and_reconcile_every_available_anchor(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        audit = PARSER.validate(statement)
        output = PARSER.to_abacus(statement)

        self.assertEqual(audit["row_count"], 3)
        self.assertEqual(audit["deposit_total"], Decimal("300.00"))
        self.assertEqual(audit["withdrawal_total"], Decimal("50.00"))
        self.assertEqual(audit["implied_opening"], Decimal("900.00"))
        self.assertEqual(audit["closing"], Decimal("1150.00"))
        self.assertEqual(audit["running_balance_checks"], 2)
        self.assertIsNone(output["opening"])
        self.assertEqual(output["closing"], 1150.0)
        self.assertEqual(output["rows"][0]["narration"], "Newest, deposit")
        self.assertEqual(output["rows"][0]["date"], "2026-08-03")

    def test_emits_the_line_one_account_number_as_the_bank_identifier(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        output = PARSER.to_abacus(statement)
        self.assertEqual(statement["account_number"], "0505050505")
        self.assertEqual(output["account"], {"kind": "bank", "identifier": "0505050505"})

    def test_institution_is_null_because_the_export_prints_no_bank_name(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        self.assertIsNone(PARSER.to_abacus(statement)["institution"])

    def test_missing_or_malformed_account_number_is_rejected(self) -> None:
        for replacement in ("", "'", "'05050505X5", "0505050505", "'0505 050505"):
            with self.subTest(account_field=replacement):
                text = VALID_STATEMENT.replace("'0505050505", replacement, 1)
                with self.assertRaisesRegex(ValueError, "account fingerprint mismatch"):
                    PARSER.parse_text(text)

    def test_available_balance_may_differ_from_current(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        PARSER.validate(statement)
        self.assertEqual(statement["available"], Decimal("1140.00"))

    def test_running_balance_mismatch_is_rejected(self) -> None:
        text = VALID_STATEMENT.replace('"950.00"', '"951.00"')
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "running balance mismatch"):
            PARSER.validate(statement)

    def test_header_closing_mismatch_is_rejected(self) -> None:
        text = VALID_STATEMENT.replace(
            'Supervalue Savings a/c,\'0505050505,INR,"1,150.00 CR"',
            'Supervalue Savings a/c,\'0505050505,INR,"1,151.00 CR"',
        )
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "account header balance"):
            PARSER.validate(statement)

    def test_unrecognized_transaction_line_is_not_skipped(self) -> None:
        text = VALID_STATEMENT.replace(
            '\t\t02/08/2026,Older withdrawal,INR,"","50.00","950.00"',
            'not-a-transaction',
        )
        with self.assertRaisesRegex(ValueError, "blank separator"):
            PARSER.parse_text(text)

    def test_fingerprint_mismatch_is_rejected(self) -> None:
        text = VALID_STATEMENT.replace("Supervalue Savings a/c", "Other Bank")
        with self.assertRaisesRegex(ValueError, "account fingerprint mismatch"):
            PARSER.parse_text(text)


if __name__ == "__main__":
    unittest.main()
