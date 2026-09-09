from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("stanc_cc_parser", HERE / "parser.py")
assert SPEC is not None and SPEC.loader is not None
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)


class ParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = (HERE / "fixtures" / "sanitized-statement.txt").read_text()

    def test_summary_and_statement_math(self) -> None:
        rows = PARSER.parse_transactions(self.text)
        opening_raw, closing_raw = PARSER.parse_summary(self.text)
        self.assertEqual((opening_raw, closing_raw), (1000.0, 745.5))
        PARSER.validate(rows, -opening_raw, -closing_raw)
        self.assertEqual(len(rows), 3)

    def test_wrapped_narration_reference_and_footnote_exclusion(self) -> None:
        rows = PARSER.parse_transactions(self.text)
        self.assertEqual(
            rows[0]["narration"], "NONPII MERCH, INC, SAMPLE NONPII CITY01"
        )
        self.assertEqual(rows[0]["source_reference"], "05050500000000000000001")
        self.assertNotIn("exchange rate", rows[-1]["narration"])

    def test_charge_and_payment_signs(self) -> None:
        rows = PARSER.parse_transactions(self.text)
        self.assertEqual((rows[0]["withdrawal"], rows[0]["deposit"]), (125.5, 0.0))
        self.assertEqual((rows[1]["withdrawal"], rows[1]["deposit"]), (0.0, 400.0))

    def test_bad_arithmetic_is_rejected(self) -> None:
        rows = PARSER.parse_transactions(self.text)
        with self.assertRaisesRegex(ValueError, "statement arithmetic mismatch"):
            PARSER.validate(rows, -1000.0, -700.0)

    def test_centered_headers_and_page_two_layout(self) -> None:
        text = """Credit Card Statement
Previous Balance (INR)   Payments/Credits (INR)   Total Payment Due (INR)
1,000.00                 400.00                   745.50

           Date                                        Description                                       Transaction Reference                                  Rewards Type                         Amount (INR)
                                                                                                          Earned
         070526                   NONPII MERCH, INC, SAMPLE                                         05050500000000000000001                         13          001 USD 1.50                         125.50
                                  NONPII CITY01

         080526                   SCB Ibanking Payment                                                                                               0          001                                  400.00 CR
^Total Payment Due is the amount due as on the statement date.
\f   Date                      Description                  Transaction Reference                 Rewards Type             Amount (INR)
  090526        BANK CHARGE                                                                    0                                  20.00

REWARDS POINTS SUMMARY
"""
        rows = PARSER.parse_transactions(text)
        opening_raw, closing_raw = PARSER.parse_summary(text)

        self.assertEqual(len(rows), 3)
        self.assertEqual(
            rows[0]["narration"], "NONPII MERCH, INC, SAMPLE NONPII CITY01"
        )
        self.assertEqual(rows[0]["source_reference"], "05050500000000000000001")
        self.assertIsNone(rows[1]["source_reference"])
        PARSER.validate(rows, -opening_raw, -closing_raw)


if __name__ == "__main__":
    unittest.main()
