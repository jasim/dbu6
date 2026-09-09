#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
from __future__ import annotations

"""Parse a Standard Chartered Bank India CSV export into Abacus JSON.

Usage: uv run parser.py <statement.csv>
Writes <statement-basename>.abacus.json next to the input.
"""

import csv
import json
import re
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


HEADER = "\tDate,Transaction,Currency,Deposit,Withdrawal,Running Balance"
PERIOD_LABEL = "Account transactions shown:"
CURRENT_LABEL = "Current Balance"
AVAILABLE_LABEL = "Available Balance"
ACCOUNT_NAME_RE = re.compile(r"^.+\s+(?:Savings|Current)\s+a/c$", re.IGNORECASE)
ACCOUNT_NUMBER_RE = re.compile(r"^'[0-9]{8,20}$")
MONEY_RE = re.compile(r"^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)\.[0-9]{2}$")
SIGNED_BALANCE_RE = re.compile(
    r"^(?P<amount>(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)\.[0-9]{2})"
    r"(?:\s+(?P<side>CR|DR))?$",
    re.IGNORECASE,
)
SUMMARY_BALANCE_RE = re.compile(
    r"^INR\s+(?P<amount>(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)\.[0-9]{2})"
    r"\s+(?P<side>CR|DR)$",
    re.IGNORECASE,
)


def csv_fields(line: str, line_number: int) -> list[str]:
    try:
        return next(csv.reader([line], strict=True))
    except csv.Error as exc:
        raise ValueError(f"line {line_number}: invalid CSV: {exc}") from exc


def decimal_amount(value: str, *, line_number: int, field: str) -> Decimal:
    if not MONEY_RE.fullmatch(value):
        raise ValueError(
            f"line {line_number}: invalid {field} amount {value!r}; "
            "expected digits with exactly two decimal places"
        )
    try:
        return Decimal(value.replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError(f"line {line_number}: invalid {field} amount") from exc


def optional_amount(value: str, *, line_number: int, field: str) -> Decimal:
    if value == "":
        return Decimal("0.00")
    return decimal_amount(value, line_number=line_number, field=field)


def signed_balance(value: str, *, line_number: int, field: str) -> Decimal:
    match = SIGNED_BALANCE_RE.fullmatch(value)
    if not match:
        raise ValueError(f"line {line_number}: invalid {field} balance {value!r}")
    amount = decimal_amount(
        match.group("amount"), line_number=line_number, field=field
    )
    return -amount if (match.group("side") or "").upper() == "DR" else amount


def summary_balance(line: str, *, line_number: int, label: str) -> Decimal:
    if not line.startswith("\t") or line.startswith("\t\t"):
        raise ValueError(f"line {line_number}: expected one-tab {label!r} trailer")
    fields = csv_fields(line[1:], line_number)
    if len(fields) != 2 or fields[0] != label:
        raise ValueError(f"line {line_number}: expected {label!r} trailer")
    match = SUMMARY_BALANCE_RE.fullmatch(fields[1])
    if not match:
        raise ValueError(f"line {line_number}: invalid {label!r} value")
    amount = decimal_amount(
        match.group("amount"), line_number=line_number, field=label
    )
    return -amount if match.group("side").upper() == "DR" else amount


def parse_date(value: str, *, line_number: int, field: str) -> date:
    try:
        return datetime.strptime(value, "%d/%m/%Y").date()
    except ValueError as exc:
        raise ValueError(
            f"line {line_number}: invalid {field} date {value!r}; expected DD/MM/YYYY"
        ) from exc


def parse_account_line(line: str) -> Decimal:
    fields = csv_fields(line, 1)
    if (
        len(fields) != 4
        or not ACCOUNT_NAME_RE.fullmatch(fields[0])
        or not ACCOUNT_NUMBER_RE.fullmatch(fields[1])
        or fields[2] != "INR"
    ):
        raise ValueError("line 1: Standard Chartered account fingerprint mismatch")
    match = SIGNED_BALANCE_RE.fullmatch(fields[3])
    if not match or not match.group("side"):
        raise ValueError("line 1: invalid signed account balance")
    return signed_balance(fields[3], line_number=1, field="account")


def parse_period(line: str) -> tuple[date, date]:
    fields = csv_fields(line, 3)
    if len(fields) != 2 or fields[0] != PERIOD_LABEL:
        raise ValueError("line 3: statement-period fingerprint mismatch")
    parts = fields[1].split(" To ")
    if len(parts) != 2:
        raise ValueError("line 3: invalid statement period")
    period_start = parse_date(parts[0], line_number=3, field="period start")
    period_end = parse_date(parts[1], line_number=3, field="period end")
    if period_start > period_end:
        raise ValueError("line 3: statement period starts after it ends")
    return period_start, period_end


def parse_transaction(line: str, line_number: int) -> dict[str, Any]:
    if not line.startswith("\t\t"):
        raise ValueError(f"line {line_number}: expected a two-tab transaction row")
    fields = csv_fields(line[2:], line_number)
    if len(fields) != 6:
        raise ValueError(
            f"line {line_number}: expected 6 transaction fields, got {len(fields)}"
        )
    date_text, narration, currency, deposit_text, withdrawal_text, balance_text = (
        fields
    )
    transaction_date = parse_date(
        date_text, line_number=line_number, field="transaction"
    )
    if not narration.strip():
        raise ValueError(f"line {line_number}: empty transaction narration")
    if currency != "INR":
        raise ValueError(f"line {line_number}: expected INR currency, got {currency!r}")

    deposit = optional_amount(deposit_text, line_number=line_number, field="deposit")
    withdrawal = optional_amount(
        withdrawal_text, line_number=line_number, field="withdrawal"
    )
    if (deposit > 0) == (withdrawal > 0):
        raise ValueError(
            f"line {line_number}: exactly one of deposit/withdrawal must be positive"
        )
    balance = signed_balance(
        balance_text, line_number=line_number, field="running"
    )
    return {
        "date": transaction_date,
        "narration": narration,
        "deposit": deposit,
        "withdrawal": withdrawal,
        "balance": balance,
        "source_line": line_number,
    }


def parse_text(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    if len(lines) < 9:
        raise ValueError("statement is too short for the Standard Chartered CSV layout")
    if lines[1] != "" or lines[3] != "" or lines[4] != HEADER:
        raise ValueError("Standard Chartered CSV header fingerprint mismatch")

    account_current = parse_account_line(lines[0])
    period_start, period_end = parse_period(lines[2])

    rows: list[dict[str, Any]] = []
    index = 5
    while index < len(lines) and lines[index].startswith("\t\t"):
        rows.append(parse_transaction(lines[index], index + 1))
        index += 1
    if not rows:
        raise ValueError("no transaction rows found")
    if index >= len(lines) or lines[index] != "":
        raise ValueError(
            f"line {index + 1}: expected a blank separator after transactions"
        )
    index += 1
    if index >= len(lines):
        raise ValueError("missing Current Balance trailer")
    current = summary_balance(
        lines[index], line_number=index + 1, label=CURRENT_LABEL
    )
    index += 1
    if index >= len(lines):
        raise ValueError("missing Available Balance trailer")
    available = summary_balance(
        lines[index], line_number=index + 1, label=AVAILABLE_LABEL
    )
    index += 1
    if any(line != "" for line in lines[index:]):
        raise ValueError(f"line {index + 1}: unexpected content after trailer")

    return {
        "account_current": account_current,
        "period_start": period_start,
        "period_end": period_end,
        "current": current,
        "available": available,
        "rows": rows,
    }


def parse(path: Path) -> dict[str, Any]:
    if path.suffix.lower() != ".csv":
        raise ValueError("expected a .csv input file")
    if not path.is_file():
        raise ValueError(f"input is not a file: {path}")
    return parse_text(path.read_text(encoding="utf-8-sig"))


def validate(statement: dict[str, Any]) -> dict[str, Any]:
    rows = statement["rows"]
    period_start = statement["period_start"]
    period_end = statement["period_end"]

    previous_date: date | None = None
    for row in rows:
        transaction_date = row["date"]
        if not period_start <= transaction_date <= period_end:
            raise ValueError(
                f"line {row['source_line']}: transaction date is outside statement period"
            )
        if previous_date is not None and transaction_date > previous_date:
            raise ValueError(
                f"line {row['source_line']}: transactions are not newest-first"
            )
        previous_date = transaction_date

    for newer, older in zip(rows, rows[1:]):
        expected = older["balance"] + newer["deposit"] - newer["withdrawal"]
        if newer["balance"] != expected:
            raise ValueError(
                f"line {newer['source_line']}: running balance mismatch; "
                f"expected {expected:.2f}, got {newer['balance']:.2f}"
            )

    closing = statement["current"]
    newest_balance = rows[0]["balance"]
    if newest_balance != closing:
        raise ValueError(
            "closing balance mismatch: newest running balance "
            f"{newest_balance:.2f} != Current Balance {closing:.2f}"
        )
    if statement["account_current"] != closing:
        raise ValueError(
            "closing balance mismatch: account header balance "
            f"{statement['account_current']:.2f} != Current Balance {closing:.2f}"
        )

    deposits = sum((row["deposit"] for row in rows), Decimal("0.00"))
    withdrawals = sum((row["withdrawal"] for row in rows), Decimal("0.00"))
    oldest = rows[-1]
    implied_opening = oldest["balance"] - oldest["deposit"] + oldest["withdrawal"]
    computed_closing = implied_opening + deposits - withdrawals
    if computed_closing != closing:
        raise ValueError(
            "statement totals mismatch: implied opening + deposits - withdrawals "
            f"= {computed_closing:.2f}, closing is {closing:.2f}"
        )

    return {
        "row_count": len(rows),
        "deposit_total": deposits,
        "withdrawal_total": withdrawals,
        "implied_opening": implied_opening,
        "closing": closing,
        "running_balance_checks": max(0, len(rows) - 1),
    }


def json_number(value: Decimal) -> float:
    return float(value)


def to_abacus(statement: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "abacus",
        # This export does not print an opening balance; do not synthesize one.
        "opening": None,
        "closing": json_number(statement["current"]),
        "rows": [
            {
                "date": row["date"].isoformat(),
                "narration": row["narration"],
                "withdrawal": json_number(row["withdrawal"]),
                "deposit": json_number(row["deposit"]),
                "balance": json_number(row["balance"]),
            }
            for row in statement["rows"]
        ],
    }


def main() -> None:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <statement.csv>", file=sys.stderr)
        sys.exit(2)

    source = Path(sys.argv[1]).resolve()
    try:
        statement = parse(source)
        audit = validate(statement)
        output = to_abacus(statement)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

    destination = source.with_suffix(".abacus.json")
    destination.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {destination} ({audit['row_count']} rows; "
        f"deposits={audit['deposit_total']:.2f}; "
        f"withdrawals={audit['withdrawal_total']:.2f}; "
        f"opening=not printed (implied {audit['implied_opening']:.2f}); "
        f"closing={audit['closing']:.2f}; "
        f"running_balance_checks={audit['running_balance_checks']})"
    )


if __name__ == "__main__":
    main()
