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
        self.assertEqual((opening_raw, closing_raw), (2000.0, 1000.0))
        PARSER.validate(rows, -opening_raw, -closing_raw)
        self.assertEqual(len(rows), 3)

    def test_wrapped_narration_reference_and_footnote_exclusion(self) -> None:
        rows = PARSER.parse_transactions(self.text)
        self.assertEqual(
            rows[0]["narration"], "NOPII MERCH, INC-NOPII CITY01 NOPII CITY02"
        )
        self.assertEqual(rows[0]["source_reference"], "05050500000000000000001")
        self.assertIsNone(rows[1]["source_reference"])

    def test_charge_and_payment_signs(self) -> None:
        rows = PARSER.parse_transactions(self.text)
        self.assertEqual((rows[0]["withdrawal"], rows[0]["deposit"]), (1000.0, 0.0))
        self.assertEqual((rows[2]["withdrawal"], rows[2]["deposit"]), (0.0, 2500.0))

    def test_issuer_name_is_emitted_verbatim(self) -> None:
        """The name is printed only in prose, so the first phrase wins as-is."""
        self.assertEqual(PARSER.parse_institution(self.text), "Standard Chartered")
        lengthened = self.text.replace(
            "your Standard Chartered", "your Standard Chartered Bank", 1
        )
        self.assertEqual(PARSER.parse_institution(lengthened), "Standard Chartered Bank")
        self.assertIsNone(
            PARSER.parse_institution(self.text.replace("Standard Chartered", ""))
        )

    def test_masked_card_number_is_emitted_without_spaces(self) -> None:
        self.assertEqual(PARSER.parse_card_number(self.text).identifier, "050505XXXXXX0505")

    def test_card_number_accepts_the_spaced_form_and_lowercase_mask(self) -> None:
        for printed in ("0505 05XX XXXX 0505", "050505xxxxxx0505"):
            with self.subTest(printed=printed):
                text = self.text.replace("050505XXXXXX0505", printed)
                self.assertEqual(
                    PARSER.parse_card_number(text).identifier, "050505XXXXXX0505"
                )

    def test_unmasked_account_number_is_not_the_card_number(self) -> None:
        """The label line prints the account number; the card number is elsewhere."""
        self.assertIn("Credit Card Account Number", self.text)
        self.assertIn("0505050000000101", self.text)
        self.assertEqual(
            PARSER.parse_card_number(self.text).identifier, "050505XXXXXX0505"
        )

    def test_card_number_is_found_away_from_the_account_number_label(self) -> None:
        """Dropping the account number changes nothing; it was never the source."""
        text = self.text.replace("0505050000000101", "")
        self.assertEqual(
            PARSER.parse_card_number(text).identifier, "050505XXXXXX0505"
        )

    def test_account_structure_illustration_is_not_mistaken_for_the_card(self) -> None:
        """The bank prints example card numbers in its terms; none may match."""
        for decoy in ("4028XXXXXXXX0505", "101XXXXXXXXX0505", "5444XXXXXXXX0505",
                      "4940XXXXXXXX0505", "101XXXXXXXXX5050"):
            with self.subTest(decoy=decoy):
                self.assertIn(decoy, self.text)
        self.assertEqual(PARSER.parse_card_number(self.text).identifier, "050505XXXXXX0505")

    def test_missing_or_malformed_card_number_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "label not found"):
            PARSER.parse_card_number(
                self.text.replace("Credit Card Account Number", "Account")
            )
        for replacement in ("", "0505 0505 0505 0505", "0505 05XX 0505"):
            with self.subTest(number=replacement):
                text = self.text.replace("050505XXXXXX0505", replacement)
                with self.assertRaisesRegex(ValueError, "found 0"):
                    PARSER.parse_card_number(text)

    def test_two_different_card_numbers_are_ambiguous(self) -> None:
        text = self.text.replace("050505XXXXXX0505", "050505XXXXXX0506", 1)
        with self.assertRaisesRegex(ValueError, "found 2"):
            PARSER.parse_card_number(text)

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
