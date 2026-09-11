#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# ///
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared import abacus  # noqa: E402


def sample_row(**overrides):
    values = dict(
        date="2026-07-01",
        narration="sample narration",
        withdrawal="100.50",
        deposit=0,
        balance="899.50",
        source_reference="050505000001",
    )
    values.update(overrides)
    return abacus.row(**values)


class AccountTests(unittest.TestCase):
    def test_bank_account_is_digits_only(self) -> None:
        self.assertEqual(abacus.bank_account("0505 05000012").identifier, "050505000012")
        self.assertEqual(abacus.bank_account("050505000012").kind, "bank")
        for bad in ("", "'050505", "0505X5", "0505-05"):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "digits only"):
                abacus.bank_account(bad)

    def test_card_account_removes_spaces_and_uppercases_the_mask(self) -> None:
        self.assertEqual(
            abacus.card_account("0505 05xx XXXX 0505").identifier, "050505XXXXXX0505"
        )
        self.assertEqual(abacus.card_account("050505XXXXXX0505").kind, "card")
        for bad in ("", "0505-05XX-XXXX-0505", "0505 05** **** 0505"):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "digits and uppercase X"):
                abacus.card_account(bad)

    def test_unknown_kind_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown account kind"):
            abacus.AbacusAccount("loan", "050505")


class RowTests(unittest.TestCase):
    def test_row_coerces_dates_and_amounts(self) -> None:
        r = sample_row(withdrawal=100.5, balance=Decimal("899.50"))
        self.assertEqual(r.date, date(2026, 7, 1))
        self.assertEqual(r.withdrawal, Decimal("100.5"))
        self.assertEqual(r.deposit, Decimal("0"))
        self.assertEqual(r.balance, Decimal("899.50"))
        self.assertIsNone(sample_row(balance=None).balance)

    def test_row_requires_exactly_one_positive_direction(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly one of withdrawal/deposit"):
            sample_row(withdrawal=0, deposit=0)
        with self.assertRaisesRegex(ValueError, "exactly one of withdrawal/deposit"):
            sample_row(withdrawal=10, deposit=10)
        with self.assertRaisesRegex(ValueError, "negative amount"):
            sample_row(withdrawal=-10, deposit=10)

    def test_row_rejects_bad_dates_and_blank_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid ISO date"):
            sample_row(date="01/07/2026")
        with self.assertRaisesRegex(ValueError, "empty narration"):
            sample_row(narration="  ")
        with self.assertRaisesRegex(ValueError, "blank source_reference"):
            sample_row(source_reference=" ")
        with self.assertRaisesRegex(ValueError, "invalid amount"):
            sample_row(withdrawal="ten")


class StatementTests(unittest.TestCase):
    def test_to_json_is_the_wire_document(self) -> None:
        s = abacus.statement(
            rows=[sample_row(), sample_row(date="2026-07-02", withdrawal=0, deposit="50", balance="949.50", source_reference=None)],
            opening="1000",
            closing=Decimal("949.50"),
            account=abacus.bank_account("050505000012"),
            institution="SAMPLE BANK Ltd.",
        )
        self.assertEqual(
            s.to_json(),
            {
                "kind": "abacus",
                "account": {"kind": "bank", "identifier": "050505000012"},
                "institution": "SAMPLE BANK Ltd.",
                "opening": 1000.0,
                "closing": 949.5,
                "rows": [
                    {
                        "date": "2026-07-01",
                        "narration": "sample narration",
                        "withdrawal": 100.5,
                        "deposit": 0.0,
                        "balance": 899.5,
                        "source_reference": "050505000001",
                    },
                    {
                        "date": "2026-07-02",
                        "narration": "sample narration",
                        "withdrawal": 0.0,
                        "deposit": 50.0,
                        "balance": 949.5,
                        "source_reference": None,
                    },
                ],
            },
        )

    def test_absent_facts_serialize_as_null(self) -> None:
        s = abacus.statement(
            rows=[sample_row(balance=None)], opening=None, closing=None, account=None, institution=None
        )
        doc = s.to_json()
        self.assertIsNone(doc["account"])
        self.assertIsNone(doc["institution"])
        self.assertIsNone(doc["opening"])
        self.assertIsNone(doc["closing"])
        self.assertIsNone(doc["rows"][0]["balance"])

    def test_statement_requires_rows_and_a_printed_institution(self) -> None:
        with self.assertRaisesRegex(ValueError, "no transactions parsed"):
            abacus.statement(rows=[], opening=None, closing=None, account=None, institution=None)
        with self.assertRaisesRegex(ValueError, "institution must be the printed name"):
            abacus.statement(rows=[sample_row()], opening=None, closing=None, account=None, institution=" ")

    def test_ledger_balance_flips_liabilities_and_keeps_zero(self) -> None:
        self.assertEqual(abacus.ledger_balance(Decimal("1630.37")), Decimal("-1630.37"))
        self.assertEqual(abacus.ledger_balance(0), Decimal("0"))
        self.assertEqual(abacus.ledger_balance(745.5), Decimal("-745.5"))


class CliTests(unittest.TestCase):
    def statement(self) -> abacus.AbacusStatement:
        return abacus.statement(
            rows=[sample_row()], opening=None, closing="899.50", account=None, institution=None
        )

    def test_writes_next_to_the_input_and_reports_the_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "statement.csv"
            source.write_text("sample")
            out = io.StringIO()
            with redirect_stdout(out):
                abacus.run_cli(lambda path: (self.statement(), "1 row"), argv=[str(source)])
            written = json.loads((Path(tmp) / "statement.abacus.json").read_text())
            self.assertEqual(written["kind"], "abacus")
            self.assertEqual(written["rows"][0]["narration"], "sample narration")
            self.assertIn("statement.abacus.json (1 row)", out.getvalue())

    def test_usage_and_parse_errors_map_to_exit_codes(self) -> None:
        err = io.StringIO()
        with redirect_stderr(err), self.assertRaises(SystemExit) as usage:
            abacus.run_cli(lambda path: (self.statement(), ""), argv=[])
        self.assertEqual(usage.exception.code, 2)
        self.assertIn("usage:", err.getvalue())

        class ParserSpecificError(Exception):
            pass

        def failing(path: Path):
            raise ParserSpecificError("fingerprint mismatch")

        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "statement.csv"
            err = io.StringIO()
            with redirect_stderr(err), self.assertRaises(SystemExit) as failure:
                abacus.run_cli(failing, error_types=(ParserSpecificError,), argv=[str(source)])
            self.assertEqual(failure.exception.code, 1)
            self.assertIn("error: fingerprint mismatch", err.getvalue())
            self.assertFalse((Path(tmp) / "statement.abacus.json").exists())


if __name__ == "__main__":
    unittest.main()
