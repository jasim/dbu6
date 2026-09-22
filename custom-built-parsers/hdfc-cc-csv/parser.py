#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
from __future__ import annotations

"""HDFC Bank credit-card billed-statement CSV -> Abacus JSON.

Usage: uv run parser.py <statement.csv>
Writes <statement-basename>.abacus.json next to the input.
"""

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from shared import abacus


DELIMITER = "~|~"
NAME_LABEL = "Name"
ADDRESS_LABEL = "Address"
# Fixed key/value head lines, in source order, after the address block.
HEAD_LABELS = (
    "Customer GSTN",
    "Payment Due Date",
    "Statement Date",
    "Total Amount Due",
    "Minimum Amount Due",
    "Credit Limit",
    "Available Limit",
    "Available Cash limit",
)
ACCOUNT_SUMMARY_TITLE = "Account Summary"
ACCOUNT_SUMMARY_HEADER = (
    "Opening Bal",
    "-",
    "Payment / Credit",
    "+",
    "Purchases / Debits",
    "+",
    "Finance Charges",
    "=",
    "Total Dues",
)
PAST_DUES_TITLE = "Past Dues (if any)"
PAST_DUES_HEADER = (
    "Overlimit",
    "3 Months",
    "2 Months",
    "1 Month",
    "Current Dues",
    "Minimum Amount Due",
)
TRANSACTIONS_TITLE = "Domestic / International Transactions"
# The statement terminates every transaction line with a delimiter, so the
# header and each row carry a trailing empty field.
TRANSACTION_HEADER = (
    "Transaction type",
    "Primary / Addon Customer Name",
    "DATE",
    "Description",
    "AMT",
    "Debit /Credit",
    "REWARDS",
    "",
)
REWARD_SUMMARY_TITLE = "Reward Points Summary"
REWARD_SUMMARY_HEADER = (
    "Opening Balance",
    "Feature + Bonus Reward Points Earned",
    "Disbursed",
    "Adjusted/Lapsed",
    "Closing Balance",
    "Points expiring in next 30 days",
    "Points expiring in next 60 days",
)
TRANSACTION_TYPES = ("Domestic", "International")

MONEY_RE = re.compile(
    r"^(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+|"
    r"[1-9][0-9]?(?:,[0-9]{2})*,[0-9]{3})\.[0-9]{2}$"
)
CARD_NUMBER_RE = re.compile(
    r"^Card No: (?P<number>[0-9]{4} [0-9]{2}XX XXXX [0-9]{4})$"
)
ALTERNATE_ACCOUNT_RE = re.compile(r"^AAN: [0-9]{16,24}$")
# The footer's registered-office line opens with the issuer's name, which is
# emitted verbatim as `institution` (the part before the first comma).
REGISTERED_OFFICE_RE = re.compile(r"^Registered Office Address:\s*(?P<name>[^,]+?)\s*(?:,|$)")
TRANSACTION_DATE_TIME_RE = re.compile(
    r"^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}$"
)
REWARD_RE = re.compile(r"^[+-] [0-9]+(?:,[0-9]{3})*$")
REFERENCE_RE = re.compile(r"\(Ref#\s*([^)]+?)\)", re.IGNORECASE)


class Cursor:
    """Single-pass reader over the statement's physical lines."""

    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.index = 0

    @property
    def line_number(self) -> int:
        return self.index + 1

    def peek(self) -> str | None:
        if self.index >= len(self.lines):
            return None
        return self.lines[self.index]

    def at_blank(self) -> bool:
        line = self.peek()
        return line is not None and line.strip() == ""

    def peek_label(self) -> str | None:
        line = self.peek()
        if line is None:
            return None
        fields = line.split(DELIMITER)
        if len(fields) != 2:
            return None
        return fields[0].strip()

    def take(self, what: str) -> str:
        line = self.peek()
        if line is None:
            raise ValueError(f"line {self.line_number}: missing {what}")
        self.index += 1
        return line

    def take_fields(self, count: int, what: str) -> list[str]:
        line_number = self.line_number
        fields = self.take(what).split(DELIMITER)
        if len(fields) != count:
            raise ValueError(
                f"line {line_number}: expected {count} {what} fields, "
                f"got {len(fields)}"
            )
        return fields

    def expect_blank(self, what: str) -> None:
        line_number = self.line_number
        line = self.take(f"blank separator before {what}")
        if line.strip() != "":
            raise ValueError(
                f"line {line_number}: expected a blank separator before {what}, "
                f"got {line!r}"
            )

    def expect_title(self, title: str) -> None:
        line_number = self.line_number
        line = self.take(f"{title!r} section title")
        if line.strip() != title:
            raise ValueError(
                f"line {line_number}: expected section title {title!r}, got {line!r}"
            )

    def expect_labels(self, labels: tuple[str, ...], what: str) -> None:
        line_number = self.line_number
        fields = self.take_fields(len(labels), what)
        actual = tuple(field.strip() for field in fields)
        if actual != labels:
            raise ValueError(
                f"line {line_number}: {what} fingerprint mismatch; "
                f"expected {labels}, got {actual}"
            )

    def expect_pattern(self, pattern: re.Pattern[str], what: str) -> str:
        line_number = self.line_number
        line = self.take(what).strip()
        if not pattern.fullmatch(line):
            raise ValueError(f"line {line_number}: invalid {what} {line!r}")
        return line


def parse_money(value: str, *, line_number: int, field: str) -> Decimal:
    text = value.strip()
    if not MONEY_RE.fullmatch(text):
        raise ValueError(
            f"line {line_number}: invalid {field} amount {value!r}; expected a "
            "non-negative amount with exactly two decimal places"
        )
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation as exc:  # pragma: no cover - guarded by MONEY_RE
        raise ValueError(
            f"line {line_number}: invalid {field} amount {value!r}"
        ) from exc


def parse_labelled_date(value: str, *, line_number: int, field: str) -> date:
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").date()
    except ValueError as exc:
        raise ValueError(
            f"line {line_number}: invalid {field} date {value!r}; expected DD/MM/YYYY"
        ) from exc


def parse_transaction_timestamp(value: str, *, line_number: int) -> datetime:
    text = value.strip()
    if not TRANSACTION_DATE_TIME_RE.fullmatch(text):
        raise ValueError(
            f"line {line_number}: invalid transaction date/time {value!r}; "
            "expected DD/MM/YYYY HH:MM:SS"
        )
    try:
        return datetime.strptime(text, "%d/%m/%Y %H:%M:%S")
    except ValueError as exc:
        raise ValueError(
            f"line {line_number}: invalid transaction date/time {value!r}"
        ) from exc


def take_labelled_value(cursor: Cursor, label: str) -> str:
    line_number = cursor.line_number
    fields = cursor.take_fields(2, f"{label!r} head line")
    if fields[0].strip() != label:
        raise ValueError(
            f"line {line_number}: expected head line {label!r}, "
            f"got {fields[0].strip()!r}"
        )
    return fields[1]


def parse_head(cursor: Cursor) -> dict[str, Any]:
    if cursor.peek_label() != NAME_LABEL:
        raise ValueError(
            "line 1: HDFC credit-card CSV fingerprint mismatch; expected a "
            f"{NAME_LABEL}{DELIMITER}<cardholder> head line"
        )
    name = take_labelled_value(cursor, NAME_LABEL)
    if name.strip() == "":
        raise ValueError("line 1: empty cardholder name")
    addresses = [take_labelled_value(cursor, ADDRESS_LABEL)]
    while cursor.peek_label() == ADDRESS_LABEL:
        addresses.append(take_labelled_value(cursor, ADDRESS_LABEL))

    values: dict[str, str] = {}
    line_numbers: dict[str, int] = {}
    for label in HEAD_LABELS:
        line_numbers[label] = cursor.line_number
        values[label] = take_labelled_value(cursor, label)

    statement_date = parse_labelled_date(
        values["Statement Date"],
        line_number=line_numbers["Statement Date"],
        field="statement",
    )
    payment_due_date = parse_labelled_date(
        values["Payment Due Date"],
        line_number=line_numbers["Payment Due Date"],
        field="payment due",
    )
    if payment_due_date <= statement_date:
        raise ValueError(
            f"line {line_numbers['Payment Due Date']}: payment due date "
            f"{payment_due_date.isoformat()} must be after statement date "
            f"{statement_date.isoformat()}"
        )
    money = {
        label: parse_money(
            values[label], line_number=line_numbers[label], field=label
        )
        for label in (
            "Total Amount Due",
            "Minimum Amount Due",
            "Credit Limit",
            "Available Limit",
            "Available Cash limit",
        )
    }
    return {
        "name": name,
        "addresses": addresses,
        "statement_date": statement_date,
        "payment_due_date": payment_due_date,
        **money,
    }


def parse_account_summary(cursor: Cursor) -> dict[str, Decimal]:
    cursor.expect_title(ACCOUNT_SUMMARY_TITLE)
    cursor.expect_labels(ACCOUNT_SUMMARY_HEADER, "account summary header")
    line_number = cursor.line_number
    fields = cursor.take_fields(
        len(ACCOUNT_SUMMARY_HEADER), "account summary value"
    )
    operators = tuple(fields[index].strip() for index in (1, 3, 5, 7))
    if operators != ("-", "+", "+", "="):
        raise ValueError(
            f"line {line_number}: account summary operators mismatch; "
            f"expected ('-', '+', '+', '='), got {operators}"
        )
    labels = (
        "opening",
        "payment_credit",
        "purchases_debits",
        "finance_charges",
        "total_dues",
    )
    return {
        label: parse_money(fields[index], line_number=line_number, field=label)
        for label, index in zip(labels, (0, 2, 4, 6, 8))
    }


def parse_past_dues(cursor: Cursor) -> dict[str, Decimal]:
    cursor.expect_title(PAST_DUES_TITLE)
    cursor.expect_labels(PAST_DUES_HEADER, "past dues header")
    line_number = cursor.line_number
    fields = cursor.take_fields(len(PAST_DUES_HEADER), "past dues value")
    return {
        label: parse_money(value, line_number=line_number, field=label)
        for label, value in zip(PAST_DUES_HEADER, fields)
    }


def parse_transaction(
    line: str, line_number: int, statement_date: date
) -> dict[str, Any]:
    fields = line.split(DELIMITER)
    if len(fields) != len(TRANSACTION_HEADER):
        raise ValueError(
            f"line {line_number}: expected {len(TRANSACTION_HEADER)} transaction "
            f"fields, got {len(fields)}"
        )
    (
        transaction_type,
        customer_name,
        date_time,
        narration,
        amount_text,
        direction,
        reward,
        trailer,
    ) = fields
    if trailer.strip() != "":
        raise ValueError(
            f"line {line_number}: unexpected content {trailer!r} after the "
            "REWARDS field"
        )
    if transaction_type.strip() not in TRANSACTION_TYPES:
        raise ValueError(
            f"line {line_number}: expected Domestic or International transaction "
            f"type, got {transaction_type.strip()!r}"
        )
    if customer_name.strip() == "":
        raise ValueError(f"line {line_number}: empty Primary / Addon Customer Name")
    if narration.strip() == "":
        raise ValueError(f"line {line_number}: empty transaction description")

    timestamp = parse_transaction_timestamp(date_time, line_number=line_number)
    if timestamp.date() > statement_date:
        raise ValueError(
            f"line {line_number}: transaction date {timestamp.date().isoformat()} "
            f"is after statement date {statement_date.isoformat()}"
        )

    if reward.strip() != "" and not REWARD_RE.fullmatch(reward.strip()):
        raise ValueError(f"line {line_number}: invalid rewards value {reward!r}")

    amount = parse_money(amount_text, line_number=line_number, field="transaction")
    if amount <= 0:
        raise ValueError(f"line {line_number}: transaction amount must be positive")

    marker = direction.strip().casefold()
    if marker not in {"", "cr", "dr"}:
        raise ValueError(
            f"line {line_number}: invalid Debit /Credit marker {direction!r}; "
            "expected blank, Dr, or Cr"
        )
    is_credit = marker == "cr"
    reference_match = REFERENCE_RE.search(narration)
    return {
        "source_line": line_number,
        "transaction_type": transaction_type.strip(),
        "timestamp": timestamp,
        "date": timestamp.date(),
        # Preserve the description field verbatim, including the bank's
        # fixed-width merchant padding.
        "narration": narration,
        "withdrawal": Decimal("0.00") if is_credit else amount,
        "deposit": amount if is_credit else Decimal("0.00"),
        "balance": None,
        "source_reference": (
            reference_match.group(1).strip() if reference_match else None
        ),
    }


def parse_transactions(cursor: Cursor, statement_date: date) -> list[dict[str, Any]]:
    cursor.expect_title(TRANSACTIONS_TITLE)
    cursor.expect_labels(TRANSACTION_HEADER, "transaction header")

    rows: list[dict[str, Any]] = []
    while cursor.peek() is not None and not cursor.at_blank():
        line_number = cursor.line_number
        rows.append(
            parse_transaction(
                cursor.take("transaction row"), line_number, statement_date
            )
        )
    if not rows:
        raise ValueError("no transaction rows found")
    cursor.expect_blank("the Reward Points Summary")
    cursor.expect_title(REWARD_SUMMARY_TITLE)
    cursor.expect_labels(REWARD_SUMMARY_HEADER, "reward points summary header")

    previous_type_rank = -1
    previous_date_by_type: dict[str, date] = {}
    for row in rows:
        transaction_type = row["transaction_type"]
        type_rank = TRANSACTION_TYPES.index(transaction_type)
        if type_rank < previous_type_rank:
            raise ValueError(
                f"line {row['source_line']}: Domestic rows cannot follow "
                "International rows"
            )
        previous_type_rank = type_rank
        previous_date = previous_date_by_type.get(transaction_type)
        if previous_date is not None and row["date"] < previous_date:
            raise ValueError(
                f"line {row['source_line']}: {transaction_type} transaction "
                "dates are not oldest-first"
            )
        previous_date_by_type[transaction_type] = row["date"]
    return rows


def parse_institution(lines: list[str]) -> str | None:
    """The issuer's name from the registered-office footer line, or None."""
    for line in lines:
        match = REGISTERED_OFFICE_RE.match(line.strip())
        if match and match.group("name"):
            return match.group("name")
    return None


def parse_text(text: str) -> dict[str, Any]:
    cursor = Cursor(text.splitlines())
    head = parse_head(cursor)
    cursor.expect_blank(f"the {ACCOUNT_SUMMARY_TITLE} section")
    summary = parse_account_summary(cursor)
    cursor.expect_blank("the card number")
    card_number = cursor.expect_pattern(CARD_NUMBER_RE, "masked card number")
    card_account = card_number_account(card_number)
    cursor.expect_blank("the alternate account number")
    alternate_account = cursor.expect_pattern(
        ALTERNATE_ACCOUNT_RE, "alternate account number"
    )
    cursor.expect_blank(f"the {PAST_DUES_TITLE} section")
    past_dues = parse_past_dues(cursor)
    cursor.expect_blank(f"the {TRANSACTIONS_TITLE} section")
    rows = parse_transactions(cursor, head["statement_date"])
    return {
        "head": head,
        "summary": summary,
        "past_dues": past_dues,
        "card_number": card_number,
        "card_account": card_account,
        "alternate_account": alternate_account,
        "institution": parse_institution(cursor.lines),
        "rows": rows,
    }


def card_number_account(card_number_line: str) -> abacus.AbacusAccount:
    """`Card No: 0505 05XX XXXX 0505` -> the canonical masked card identifier."""
    match = CARD_NUMBER_RE.fullmatch(card_number_line)
    if match is None:
        raise ValueError(f"invalid masked card number {card_number_line!r}")
    return abacus.card_account(match.group("number"))


def parse(path: Path) -> dict[str, Any]:
    if path.suffix.lower() != ".csv":
        raise ValueError("expected a .csv input file")
    if not path.is_file():
        raise ValueError(f"input is not a file: {path}")
    return parse_text(path.read_text(encoding="utf-8-sig"))


def validate(statement: dict[str, Any]) -> dict[str, Any]:
    head = statement["head"]
    summary = statement["summary"]
    past_dues = statement["past_dues"]
    rows = statement["rows"]

    if head["Total Amount Due"] != summary["total_dues"]:
        raise ValueError(
            "displayed due mismatch: Total Amount Due "
            f"{head['Total Amount Due']:.2f} != Account Summary Total Dues "
            f"{summary['total_dues']:.2f}"
        )
    if head["Minimum Amount Due"] != past_dues["Minimum Amount Due"]:
        raise ValueError(
            "minimum due mismatch: head Minimum Amount Due "
            f"{head['Minimum Amount Due']:.2f} != Past Dues Minimum Amount Due "
            f"{past_dues['Minimum Amount Due']:.2f}"
        )
    for label in ("Available Limit", "Available Cash limit"):
        if head[label] > head["Credit Limit"]:
            raise ValueError(
                f"{label} {head[label]:.2f} exceeds Credit Limit "
                f"{head['Credit Limit']:.2f}"
            )

    deposits = sum((row["deposit"] for row in rows), Decimal("0.00"))
    withdrawals = sum((row["withdrawal"] for row in rows), Decimal("0.00"))
    expected_withdrawals = summary["purchases_debits"] + summary["finance_charges"]
    if deposits != summary["payment_credit"]:
        raise ValueError(
            "credit total mismatch: transaction credits "
            f"{deposits:.2f} != Account Summary Payment / Credit "
            f"{summary['payment_credit']:.2f}"
        )
    if withdrawals != expected_withdrawals:
        raise ValueError(
            "debit total mismatch: transaction debits "
            f"{withdrawals:.2f} != Account Summary Purchases / Debits plus "
            f"Finance Charges {expected_withdrawals:.2f}"
        )

    # Statement convention is a positive amount owed. Credits reduce it and
    # debits increase it. The sign is flipped only when emitting ledger values.
    exact_closing = summary["opening"] - deposits + withdrawals
    expected_closing = (
        summary["opening"]
        - summary["payment_credit"]
        + summary["purchases_debits"]
        + summary["finance_charges"]
    )
    if exact_closing != expected_closing:
        raise ValueError(
            f"account-summary arithmetic mismatch: {exact_closing:.2f} != "
            f"{expected_closing:.2f}"
        )

    rounded_due = exact_closing.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if summary["total_dues"] != rounded_due:
        raise ValueError(
            "rounded due mismatch: exact closing "
            f"{exact_closing:.2f} rounds to {rounded_due:.2f}, but displayed "
            f"Total Dues is {summary['total_dues']:.2f}"
        )

    return {
        "row_count": len(rows),
        "deposit_total": deposits,
        "withdrawal_total": withdrawals,
        "opening": summary["opening"],
        "exact_closing": exact_closing,
        "displayed_total_due": summary["total_dues"],
        # This CSV layout has no per-transaction running-balance column.
        "running_balance_checks": 0,
    }


def to_abacus(statement: dict[str, Any], audit: dict[str, Any]) -> abacus.AbacusStatement:
    chronological_rows = sorted(
        statement["rows"], key=lambda row: (row["timestamp"], row["source_line"])
    )
    return abacus.statement(
        rows=[
            abacus.row(
                date=row["date"],
                narration=row["narration"],
                withdrawal=row["withdrawal"],
                deposit=row["deposit"],
                balance=None,
                source_reference=row["source_reference"],
            )
            for row in chronological_rows
        ],
        # Credit-card balances are liabilities, hence the sign flip. HDFC
        # displays Total Dues rounded to rupees; keep the exact ledger closing
        # proved by statement opening - credits + debits, not the rounding.
        opening=abacus.ledger_balance(audit["opening"]),
        closing=abacus.ledger_balance(audit["exact_closing"]),
        account=statement["card_account"],
        # The issuer's name from the registered-office footer, verbatim.
        institution=statement["institution"],
    )


def build(source: Path) -> tuple[abacus.AbacusStatement, str]:
    statement = parse(source)
    audit = validate(statement)
    summary = (
        f"{audit['row_count']} rows; "
        f"deposits={audit['deposit_total']:.2f}; "
        f"withdrawals={audit['withdrawal_total']:.2f}; "
        f"opening={abacus.ledger_balance(audit['opening']):.2f}; "
        f"closing={abacus.ledger_balance(audit['exact_closing']):.2f}; "
        f"displayed_total_due={audit['displayed_total_due']:.2f}; "
        f"running_balance_checks={audit['running_balance_checks']}"
    )
    return to_abacus(statement, audit), summary


if __name__ == "__main__":
    abacus.run_cli(build, usage="<statement.csv>")
