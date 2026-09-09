from __future__ import annotations

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("hdfc_cc_csv_parser", HERE / "parser.py")
assert SPEC is not None and SPEC.loader is not None
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)


# Decode the bytes directly: the statement uses CRLF line endings and the
# tests patch whole lines, so newline translation would hide that.
VALID_STATEMENT = (
    (HERE / "fixtures" / "sanitized-statement.csv").read_bytes().decode("utf-8")
)
TRANSACTION_HEADER_LINE = (
    "Transaction type~|~Primary / Addon Customer Name~|~DATE~|~Description~|~"
    "AMT~|~Debit /Credit~|~REWARDS~|~"
)
MERCHANT_ROW = (
    "Domestic~|~SAMPLE CARDHOLDER ~|~15/05/2026 10:00:00~|~"
    "SAMPLE MERCHANT ONE BANGALORE ~|~1,000.00~|~~|~+ 20~|~"
)
EMI_ROW = (
    "Domestic~|~SAMPLE CARDHOLDER ~|~18/06/2026 00:00:00~|~"
    "OFFUS EMI,INT NBR:01,0 0000050505050 (Ref# 05050500000000000000002)~|~"
    "30.00~|~~|~~|~"
)
FOREIGN_PURCHASE_ROW = (
    "International~|~SAMPLE CARDHOLDER ~|~16/05/2026 09:00:00~|~"
    "Sample Online www.sample  USD2.40~|~200.00~|~~|~+ 4~|~"
)
FOREIGN_REFUND_ROW = (
    "International~|~SAMPLE CARDHOLDER ~|~10/06/2026 00:00:00~|~"
    "SAMPLE REFUND AMSTERDAM (Ref# VT050505000000000000004) ~|~100.00~|~Cr~|~- 2~|~"
)


def replace_once(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, f"expected exactly one {old!r}"
    return text.replace(old, new)


class ParserTests(unittest.TestCase):
    def test_parse_and_reconcile_every_available_anchor(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        audit = PARSER.validate(statement)
        output = PARSER.to_abacus(statement, audit)

        self.assertEqual(audit["row_count"], 5)
        self.assertEqual(audit["deposit_total"], Decimal("600.00"))
        self.assertEqual(audit["withdrawal_total"], Decimal("1230.00"))
        self.assertEqual(audit["opening"], Decimal("1000.37"))
        self.assertEqual(audit["exact_closing"], Decimal("1630.37"))
        self.assertEqual(audit["displayed_total_due"], Decimal("1630.00"))
        self.assertEqual(audit["running_balance_checks"], 0)
        self.assertEqual(statement["card_number"], "Card No: 0505 05XX XXXX 0505")
        self.assertEqual(statement["alternate_account"], "AAN: 0505050505050505050")

        # Credit-card liabilities are negative, and the exact paise closing is
        # preserved rather than the rupee-rounded Total Dues.
        self.assertEqual(output["opening"], -1000.37)
        self.assertEqual(output["closing"], -1630.37)
        self.assertEqual(
            [row["date"] for row in output["rows"]],
            ["2026-05-15", "2026-05-16", "2026-05-20", "2026-06-10", "2026-06-18"],
        )
        self.assertTrue(all(row["balance"] is None for row in output["rows"]))

    def test_narration_keeps_the_statement_spacing(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        output = PARSER.to_abacus(statement, PARSER.validate(statement))
        narrations = [row["narration"] for row in output["rows"]]

        # Trailing and doubled spaces are the bank's fixed-width padding.
        self.assertEqual(narrations[0], "SAMPLE MERCHANT ONE BANGALORE ")
        self.assertEqual(narrations[1], "Sample Online www.sample  USD2.40")

    def test_credit_rows_become_deposits_with_their_reference(self) -> None:
        statement = PARSER.parse_text(VALID_STATEMENT)
        audit = PARSER.validate(statement)
        output = PARSER.to_abacus(statement, audit)
        payment, refund = output["rows"][2], output["rows"][3]

        self.assertEqual((payment["deposit"], payment["withdrawal"]), (500.0, 0.0))
        self.assertEqual(payment["source_reference"], "00000000000050505050505")
        # A refund carries a negative reward adjustment; it is still a credit.
        self.assertEqual((refund["deposit"], refund["withdrawal"]), (100.0, 0.0))
        self.assertEqual(refund["source_reference"], "VT050505000000000000004")

    def test_credit_total_mismatch_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, "~|~600.00~|~", "~|~601.00~|~")
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "credit total mismatch"):
            PARSER.validate(statement)

    def test_debit_total_mismatch_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, "~|~1,200.00~|~", "~|~1,100.00~|~")
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "debit total mismatch"):
            PARSER.validate(statement)

    def test_rounded_due_mismatch_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, "1,000.37~|~-", "1,001.37~|~-")
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "rounded due mismatch"):
            PARSER.validate(statement)

    def test_displayed_due_mismatch_is_rejected(self) -> None:
        text = replace_once(
            VALID_STATEMENT,
            "Total Amount Due~|~1,630.00",
            "Total Amount Due~|~1,631.00",
        )
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "displayed due mismatch"):
            PARSER.validate(statement)

    def test_minimum_due_mismatch_is_rejected(self) -> None:
        text = replace_once(
            VALID_STATEMENT,
            "Minimum Amount Due~|~100.00",
            "Minimum Amount Due~|~101.00",
        )
        statement = PARSER.parse_text(text)
        with self.assertRaisesRegex(ValueError, "minimum due mismatch"):
            PARSER.validate(statement)

    def test_unrecognized_transaction_line_is_not_skipped(self) -> None:
        text = replace_once(VALID_STATEMENT, MERCHANT_ROW, "not-a-transaction")
        with self.assertRaisesRegex(ValueError, "expected 8 transaction fields"):
            PARSER.parse_text(text)

    def test_extra_field_after_rewards_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, MERCHANT_ROW, MERCHANT_ROW + "surprise")
        with self.assertRaisesRegex(ValueError, "unexpected content"):
            PARSER.parse_text(text)

    def test_transaction_after_the_statement_date_is_rejected(self) -> None:
        text = replace_once(
            VALID_STATEMENT, "15/05/2026 10:00:00", "19/06/2026 10:00:00"
        )
        with self.assertRaisesRegex(ValueError, "after statement date"):
            PARSER.parse_text(text)

    def test_unparseable_transaction_timestamp_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, "15/05/2026 10:00:00", "15/05/2026 10:00")
        with self.assertRaisesRegex(ValueError, "invalid transaction date/time"):
            PARSER.parse_text(text)

    def test_invalid_rewards_value_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, "~|~+ 20~|~", "~|~20 points~|~")
        with self.assertRaisesRegex(ValueError, "invalid rewards value"):
            PARSER.parse_text(text)

    def test_domestic_rows_cannot_follow_international_rows(self) -> None:
        text = replace_once(
            VALID_STATEMENT,
            f"{EMI_ROW}\r\n{FOREIGN_PURCHASE_ROW}",
            f"{FOREIGN_PURCHASE_ROW}\r\n{EMI_ROW}",
        )
        with self.assertRaisesRegex(ValueError, "Domestic rows cannot follow"):
            PARSER.parse_text(text)

    def test_rows_must_stay_oldest_first_within_a_transaction_type(self) -> None:
        text = replace_once(
            VALID_STATEMENT,
            f"{FOREIGN_PURCHASE_ROW}\r\n{FOREIGN_REFUND_ROW}",
            f"{FOREIGN_REFUND_ROW}\r\n{FOREIGN_PURCHASE_ROW}",
        )
        with self.assertRaisesRegex(ValueError, "not oldest-first"):
            PARSER.parse_text(text)

    def test_missing_reward_points_summary_terminator_is_rejected(self) -> None:
        text = replace_once(VALID_STATEMENT, "Reward Points Summary\r\n", "")
        with self.assertRaisesRegex(ValueError, "Reward Points Summary"):
            PARSER.parse_text(text)

    def test_transaction_table_must_not_be_empty(self) -> None:
        lines = VALID_STATEMENT.split("\r\n")
        header_index = lines.index(TRANSACTION_HEADER_LINE)
        terminator_index = lines.index("", header_index)
        text = "\r\n".join(lines[: header_index + 1] + lines[terminator_index:])
        with self.assertRaisesRegex(ValueError, "no transaction rows found"):
            PARSER.parse_text(text)

    def test_account_summary_operators_must_match(self) -> None:
        text = replace_once(
            VALID_STATEMENT, "1,000.37~|~-~|~600.00", "1,000.37~|~+~|~600.00"
        )
        with self.assertRaisesRegex(ValueError, "account summary operators mismatch"):
            PARSER.parse_text(text)

    def test_masked_card_number_must_keep_its_shape(self) -> None:
        text = replace_once(
            VALID_STATEMENT, "Card No: 0505 05XX XXXX 0505", "Card No: 0505050505050505"
        )
        with self.assertRaisesRegex(ValueError, "invalid masked card number"):
            PARSER.parse_text(text)

    def test_another_banks_csv_layout_is_rejected(self) -> None:
        text = (
            "Supervalue Savings a/c,'0505050505,INR,\"1,150.00 CR\"\r\n"
            "\r\n"
            "Account transactions shown:,01/08/2026 To 03/08/2026\r\n"
            "\r\n"
            "\tDate,Transaction,Currency,Deposit,Withdrawal,Running Balance\r\n"
        )
        with self.assertRaises(ValueError):
            PARSER.parse_text(text)

    def test_an_empty_file_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            PARSER.parse_text("")


if __name__ == "__main__":
    unittest.main()
