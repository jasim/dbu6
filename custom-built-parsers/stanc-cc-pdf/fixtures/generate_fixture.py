#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# ///
from __future__ import annotations

"""Build the sanitized Standard Chartered credit-card statement fixture.

The parser reads `pdftotext -layout` output, so the fixture is that text. The
column offsets below are the real statement's, because the parser keys off
them: the transaction header spans three physical lines, a wrapped narration
is recognized by matching the description column's indent, and the rewards
summary prints the masked card number in its own leading column.

Values are anonymized per AGENTS.md (whole amounts, `050505` in every numeric
identifier, `NOPII` text) while every column position, header spelling and
quirk is the bank's.

Usage: uv run generate_fixture.py            # rewrites sanitized-statement.txt
"""

from pathlib import Path
from typing import List, Tuple


HERE = Path(__file__).resolve().parent
FIXTURE_PATH = HERE / "sanitized-statement.txt"

# The label line prints the *account* number, unmasked and 16 digits. It is
# not the card, and the parser must not report it as one.
ACCOUNT_NUMBER = "0505050000000101"
# The *card* number, masked, printed beside the product name and again in the
# rewards summary. This is what the parser emits as `account`.
CARD_NUMBER = "050505XXXXXX0505"

# Summary block, statement convention (positive). The parser negates both.
PREVIOUS_BALANCE = "2,000.00"
PAYMENTS_CREDITS = "2,500.00"
TOTAL_PAYMENT_DUE = "1,000.00"

# (date, narration, reference, rewards earned, rewards type + intl amount, amount)
# Withdrawals 1,000 + 500 and a 2,500 credit carry 2,000 opening to 1,000 due.
TRANSACTIONS: List[Tuple[str, str, str, str, str, str]] = [
    ("070726", "NOPII MERCH, INC-NOPII CITY01", "05050500000000000000001", "33", "001 USD 10.00", "1,000.00"),
    ("080726", "Forex Markup Fee Retail", "", "0", "", "500.00"),
    ("240726", "SCB Ibanking Payment", "00000000000000000000000", "0", "001", "2,500.00 CR"),
]
# Narration the bank wraps onto a second line, indented to the description
# column. Keyed by the row index it continues.
WRAPPED_NARRATION = {0: "NOPII CITY02"}


def place(*cells: Tuple[int, str]) -> str:
    """One layout line with each cell starting at its column offset."""
    line = ""
    for column, text in cells:
        if len(line) > column:
            raise ValueError(f"cell {text!r} overlaps column {column}")
        line = line.ljust(column) + text
    return line


def right(column: int, text: str) -> Tuple[int, str]:
    """A cell whose *right* edge sits at `column`, as the bank prints amounts."""
    return (column - len(text), text)


def build() -> str:
    lines = [
        place((94, "Credit Card Statement")),
        "",
        place((13, "NOPII CUSTOMER NAME"), (146, "Credit Card Account Number"), (207, f": {ACCOUNT_NUMBER}")),
        place((13, "NOPII ADDRESS LINE 1"), (146, "Statement Date"), (207, ": 04 Aug 2026")),
        place((13, "NOPII ADDRESS LINE 2"), (146, "Statement Period"), (207, ": 05 Jul 2026 To 04 Aug 2026")),
        place((13, "NOPII CITY01"), (146, "Payment Due Date"), (207, ": 26 Aug 2026")),
        place((13, "NOPII CITY01 KA"), (146, "Total Payment Due (INR)"), (207, f": {TOTAL_PAYMENT_DUE}")),
        place((13, "IN"), (146, "Minimum Payment Due (INR)"), (207, ": 250.00")),
        place((146, "Retail Interest Rate"), (207, ": 3.75 % pm")),
        place((13, "050505")),
        "",
        "",
        place((1, "Credit Limit (INR) :"), right(120, "100,000.00"), (146, "Cash Limit (INR) :"), right(230, "50,000.00")),
        "",
        "",
        place((26, "Previous Balance (INR)"), (115, "Payments/Credits (INR)"), (201, "Total Payment Due (INR)")),
        "",
        place(right(48, PREVIOUS_BALANCE), right(137, PAYMENTS_CREDITS), right(223, TOTAL_PAYMENT_DUE)),
        "",
        "",
        "",
        place((3, "Super Value Titanium Mastercard"), (221, CARD_NUMBER)),
        "",
        # The header spans three physical lines; only the middle one carries
        # every column name, and that is the line the parser matches.
        place((157, "Rewards"), (208, "International")),
        place((11, "Date"), (55, "Description"), (105, "Transaction Reference"), (180, "Rewards Type"), (238, "Amount (INR)")),
        place((158, "Earned"), (211, "Amount")),
        "",
    ]

    for index, (date, narration, reference, earned, rewards_type, amount) in enumerate(TRANSACTIONS):
        cells = [(9, date), (34, narration)]
        if reference:
            cells.append((101, reference))
        if earned:
            cells.append((173, earned))
        if rewards_type:
            cells.append((197, rewards_type))
        cells.append(right(253, amount))
        lines.append(place(*cells))
        if index in WRAPPED_NARRATION:
            lines.append(place((34, WRAPPED_NARRATION[index])))
        lines.append("")

    lines += [
        "",
        "",
        "^Total Payment Due is the amount due for payment as on the statement date. It includes your opening balance, new purchases, fees & finance charges if any, minus your last payment or any other due credits.",
        "REWARDS POINTS SUMMARY",
        "",
        place((70, "Rewards expiring by")),
        place((70, "Opening"), (86, "Rewards"), (102, "Rewards"), (118, "Closing")),
        place((11, "Card Number"), (24, "Card Name"), (44, "Rewards Type"), (70, "the end of current")),
        place((70, "Balance"), (86, "Earned"), (102, "Adjusted"), (118, "Balance")),
        place((70, "calendar month")),
        "",
        place((0, CARD_NUMBER), (24, "Super Value"), (44, "points"), right(75, "7,000.00"), right(89, "42.00"), right(108, "-1,000.00"), right(123, "6,042.00"), right(152, "0.00")),
        place((24, "Titanium Mastercard")),
        "",
        place((0, CARD_NUMBER), (24, "Super Value"), (44, "cashback"), right(75, "10.00"), right(89, "0.00"), right(108, "0.00"), right(123, "10.00"), right(152, "0.00")),
        place((24, "Titanium Mastercard")),
        "",
        "Disclaimer",
        "",
        # The letterhead is a logo image, so the issuer's name first appears in
        # prose -- and without a directly attached "Bank". `institution` is
        # lookup text, not an identifier, so that is good enough and faithful.
        "           Bill desk: From different bank accounts directly to your Standard Chartered",
        "           credit card account.",
        "           Standing instructions: In case the cardholder has a Standard Chartered Bank account,",
        "           the payment can be automated.",
        "",
        " Making only the minimum payment every month would result in the repayment stretching over months/years with consequential compounded",
        " interest payment on your outstanding balance.",
        "",
        # Boilerplate the bank prints for every customer: an illustration of
        # the account/card structure, with card numbers that are neither the
        # reader's nor shaped like the real masked form. The parser must not
        # mistake any of them for the statement's own card.
        " Illustration of Credit Card account& structure is given below:",
        "",
        "                                          Beyond Credit Card No.: 4028XXXXXXXX0505",
        "                                          Credit Card Account No.",
        "               101XXXXXXXXX0505           Ultimate Card No.: 5444XXXXXXXX0505",
        "               Instalment Loan / Instalment Plan Summary: XX050X",
        "",
        "                                          Credit Card Account No.",
        "                                          EaseMyTrip Card No.: 4940XXXXXXXX0505",
        "               101XXXXXXXXX5050",
        "",
    ]
    return "\n".join(line.rstrip() for line in lines) + "\n"


if __name__ == "__main__":
    FIXTURE_PATH.write_text(build())
    print(f"wrote {FIXTURE_PATH}")
