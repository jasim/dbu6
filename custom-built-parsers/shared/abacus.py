"""The Abacus statement: the one shape every deterministic parser emits.

This module is the Python home of the Abacus JSON contract that
`packages/api/modules/statement/` consumes. A parser turns its
bank-specific reading of a statement into an `AbacusStatement`; everything
that is true of every parser lives here instead of being repeated per bank:

- the row and statement types, validated on construction;
- the canonical account-identifier rule (`bank_account`, `card_account`);
- the credit-card sign flip into ledger semantics (`ledger_balance`);
- JSON serialization and the `<input-basename>.abacus.json` output path;
- the command-line driver every parser's `__main__` delegates to.

Balances follow ledger semantics: assets positive, liabilities (credit
cards) negative. Amounts are `Decimal` internally and become plain JSON
numbers only when serialized.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Optional, Sequence, Tuple, Union

Amount = Union[int, float, str, Decimal]

BANK_IDENTIFIER_RE = re.compile(r"^[0-9]+$")
CARD_IDENTIFIER_RE = re.compile(r"^[0-9X]+$")


def to_decimal(value: Amount, *, what: str) -> Decimal:
    """Coerce a parsed amount to Decimal; floats go through repr to keep their digits."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise ValueError(f"{what}: expected an amount, got {value!r}")
    try:
        return Decimal(repr(value) if isinstance(value, float) else str(value))
    except InvalidOperation as exc:
        raise ValueError(f"{what}: invalid amount {value!r}") from exc


def to_date(value: Union[date, str], *, what: str) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{what}: invalid ISO date {value!r}") from exc


@dataclass(frozen=True)
class AbacusAccount:
    """Which account or card the statement is for, in the canonical form.

    Build one with `bank_account` or `card_account`; they apply the
    normalization rule documented in import-statement-parser-guide.md.
    """

    kind: str  # "bank" | "card"
    identifier: str

    def __post_init__(self) -> None:
        if self.kind == "bank":
            if not BANK_IDENTIFIER_RE.fullmatch(self.identifier):
                raise ValueError(
                    f"bank account identifier must be digits only, got {self.identifier!r}"
                )
        elif self.kind == "card":
            if not CARD_IDENTIFIER_RE.fullmatch(self.identifier):
                raise ValueError(
                    "card identifier must be digits and uppercase X with no spaces, "
                    f"got {self.identifier!r}"
                )
        else:
            raise ValueError(f"unknown account kind {self.kind!r}")


def bank_account(printed_number: str) -> AbacusAccount:
    """The full printed account number, digits only.

    Callers pass the number itself (label, quotes, and other decoration already
    stripped by their fingerprint match); internal spaces are removed here.
    """
    return AbacusAccount("bank", printed_number.replace(" ", ""))


def card_account(printed_masked_number: str) -> AbacusAccount:
    """The printed masked card number with spaces removed and the mask uppercased.

    `1234 56XX XXXX 7890` -> `123456XXXXXX7890`. Never unmask or shorten it.
    """
    return AbacusAccount("card", printed_masked_number.replace(" ", "").upper())


@dataclass(frozen=True)
class AbacusRow:
    """One transaction. Exactly one of withdrawal/deposit is positive."""

    date: date
    narration: str
    withdrawal: Decimal
    deposit: Decimal
    # The running balance printed after this row, or None when the statement
    # prints none; parsers never synthesize it.
    balance: Optional[Decimal]
    # The bank's own reference for the row when the layout has one; it makes
    # the importer's transaction identity independent of the narration text.
    source_reference: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.narration.strip():
            raise ValueError(f"{self.date.isoformat()}: empty narration")
        if self.withdrawal < 0 or self.deposit < 0:
            raise ValueError(
                f"{self.date.isoformat()} {self.narration[:40]!r}: negative amount "
                f"(withdrawal {self.withdrawal}, deposit {self.deposit})"
            )
        if (self.withdrawal > 0) == (self.deposit > 0):
            raise ValueError(
                f"{self.date.isoformat()} {self.narration[:40]!r}: exactly one of "
                f"withdrawal/deposit must be positive (withdrawal {self.withdrawal}, "
                f"deposit {self.deposit})"
            )
        if self.source_reference is not None and not self.source_reference.strip():
            raise ValueError(f"{self.date.isoformat()}: blank source_reference")


def row(
    *,
    date: Union[date, str],
    narration: str,
    withdrawal: Amount,
    deposit: Amount,
    balance: Optional[Amount],
    source_reference: Optional[str] = None,
) -> AbacusRow:
    """Build a row from parsed values, coercing dates and amounts."""
    label = f"row dated {date}"
    return AbacusRow(
        date=to_date(date, what=label),
        narration=narration,
        withdrawal=to_decimal(withdrawal, what=f"{label} withdrawal"),
        deposit=to_decimal(deposit, what=f"{label} deposit"),
        balance=None if balance is None else to_decimal(balance, what=f"{label} balance"),
        source_reference=source_reference,
    )


@dataclass(frozen=True)
class AbacusStatement:
    """A parsed statement in ledger semantics, ready to serialize."""

    rows: Tuple[AbacusRow, ...]
    # Printed opening/closing balances when the statement labels them;
    # None otherwise. Never derived.
    opening: Optional[Decimal]
    closing: Optional[Decimal]
    account: Optional[AbacusAccount]
    # The institution's name exactly as printed (trimmed), or None when the
    # statement prints none. Lookup text for presets, not an identifier.
    institution: Optional[str]

    def __post_init__(self) -> None:
        if not self.rows:
            raise ValueError("no transactions parsed")
        if self.institution is not None and not self.institution.strip():
            raise ValueError("institution must be the printed name or None, not blank")

    def to_json(self) -> dict:
        """The wire document accepted by the importer's `abacusJsonSchema`."""
        return {
            "kind": "abacus",
            "account": (
                None
                if self.account is None
                else {"kind": self.account.kind, "identifier": self.account.identifier}
            ),
            "institution": self.institution,
            "opening": json_number(self.opening),
            "closing": json_number(self.closing),
            "rows": [
                {
                    "date": r.date.isoformat(),
                    "narration": r.narration,
                    "withdrawal": json_number(r.withdrawal),
                    "deposit": json_number(r.deposit),
                    "balance": json_number(r.balance),
                    "source_reference": r.source_reference,
                }
                for r in self.rows
            ],
        }


def statement(
    *,
    rows: Sequence[AbacusRow],
    opening: Optional[Amount],
    closing: Optional[Amount],
    account: Optional[AbacusAccount],
    institution: Optional[str],
) -> AbacusStatement:
    return AbacusStatement(
        rows=tuple(rows),
        opening=None if opening is None else to_decimal(opening, what="opening"),
        closing=None if closing is None else to_decimal(closing, what="closing"),
        account=account,
        institution=institution,
    )


def ledger_balance(statement_balance: Amount) -> Decimal:
    """Credit-card sign flip: the statement prints the amount owed as positive;
    the ledger records the liability as negative. Zero stays zero."""
    value = to_decimal(statement_balance, what="balance")
    return Decimal("0") if value == 0 else -value


def json_number(value: Optional[Decimal]) -> Optional[float]:
    return None if value is None else float(value)


def abacus_json_path(source: Path) -> Path:
    """`<input-basename>.abacus.json` next to the input."""
    return source.with_suffix(".abacus.json")


def write_abacus_json(statement: AbacusStatement, source: Path) -> Path:
    destination = abacus_json_path(source)
    destination.write_text(
        json.dumps(statement.to_json(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return destination


# A parser's whole job, as the CLI sees it: read one input path, return the
# statement plus a one-line audit summary for the console.
Build = Callable[[Path], Tuple[AbacusStatement, str]]


def run_cli(
    build: Build,
    *,
    usage: str = "<statement>",
    error_types: Tuple[type, ...] = (),
    argv: Optional[Sequence[str]] = None,
) -> None:
    """Shared `main()`: exit 2 on usage, exit 1 with the error on failure,
    otherwise write the JSON and report where it went."""
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print(f"usage: {sys.argv[0]} {usage}", file=sys.stderr)
        sys.exit(2)
    source = Path(args[0]).resolve()
    try:
        result, summary = build(source)
    except (OSError, UnicodeError, ValueError, *error_types) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
    destination = write_abacus_json(result, source)
    print(f"wrote {destination} ({summary})")
