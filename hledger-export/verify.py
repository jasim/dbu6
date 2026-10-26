# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Check this hledger export against the books dbu6 exported it from.

dbu6 writes dbu6-expected.json beside main.journal: every account's own
balance, its Balance Sheet's figures, every balance assertion it recorded
and a random handful of transactions (a different set each export). This
script reads the journal with hledger, through hledger-web's JSON API (or
`hledger print`/`bal` when hledger-web isn't installed), and checks:

  a. `hledger check -s ordereddates` passes;
  b. each dbu6 journal is one transaction, none twice (no double counting);
  c. each account's own balance and declared type;
  d. the balance sheet, from hledger's own bs, bse and is reports;
  e. each balance assertion is in the journal, where hledger checks it;
  f. the sampled transactions, posting by posting.

Run it from anywhere, with hledger on PATH:

    uv run verify.py        (or: python3 verify.py)

Exit status: 0 when every check passes, 1 when one fails, 2 when hledger
can't be run.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
JOURNAL = HERE / "main.journal"
EXPECTED = HERE / "dbu6-expected.json"
SHOWN = 20  # differences listed per check
ZERO = Decimal(0)


class Unrunnable(Exception):
    """hledger is missing, or can't read the journal."""


# --- reading hledger's JSON ---


def quantity(amount: dict) -> Decimal:
    """One hledger amount, exactly: its mantissa scaled by its places."""
    q = amount["aquantity"]
    return Decimal(q["decimalMantissa"]).scaleb(-q["decimalPlaces"])


def total(amounts: list) -> Decimal:
    """An amount list as one number; the export has a single commodity."""
    commodities = {a["acommodity"] for a in amounts}
    if len(commodities) > 1:
        raise ValueError(f"more than one commodity: {sorted(commodities)}")
    return sum((quantity(a) for a in amounts), ZERO)


def hledger(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    run = subprocess.run(
        ["hledger", "-f", str(JOURNAL), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if check and run.returncode != 0:
        raise Unrunnable(f"hledger {' '.join(args)} failed:\n{run.stderr.strip()}")
    return run


def hledger_json(*args: str):
    # -I: an assertion that fails is check (a)'s to report; the rest still runs.
    return json.loads(hledger(*args, "-I", "-O", "json").stdout)


class Books:
    """What hledger reads from the journal."""

    def __init__(self, own: dict, types: dict, transactions: list, source: str):
        self.own = own  # {account: own balance}, subaccounts excluded
        self.types = types  # {account: declared type letter}
        self.transactions = transactions  # hledger's transaction JSON
        self.source = source


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def read_with_hledger_web() -> Books:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    web = subprocess.Popen(
        ["hledger-web", "-f", str(JOURNAL), "-I", "--serve-api", "--allow=view",
         "--host=127.0.0.1", f"--port={port}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
    )  # fmt: skip

    def get(path: str):
        with urllib.request.urlopen(base + path, timeout=120) as response:
            return json.load(response)

    try:
        deadline = time.monotonic() + 30
        while True:
            if web.poll() is not None:
                raise Unrunnable(f"hledger-web exited:\n{web.stderr.read().strip()}")
            try:
                get("/accountnames")
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise Unrunnable("hledger-web did not start in 30 seconds")
                time.sleep(0.1)
        accounts = get("/accounts")
        transactions = get("/transactions")
    finally:
        if web.poll() is None:
            web.terminate()
            try:
                web.wait(timeout=5)
            except subprocess.TimeoutExpired:
                web.kill()
                web.wait()

    own, types = {}, {}
    for account in accounts:
        if account["aname"] == "root":
            continue
        own[account["aname"]] = total(account["aebalance"])
        tags = (account.get("adeclarationinfo") or {}).get("aditags") or []
        for key, value in tags:
            if key == "type":
                types[account["aname"]] = value
    return Books(own, types, transactions, "hledger-web")


def read_with_hledger_cli() -> Books:
    rows, _ = hledger_json("bal", "--flat", "-E")  # flat: own balances
    own = {row[0]: total(row[3]) for row in rows}
    types = {}
    for line in hledger("accounts", "--types").stdout.splitlines():
        name, _, comment = line.partition(";")
        if "type:" in comment:
            types[name.strip()] = comment.split("type:")[1].split(",")[0].strip()
    return Books(own, types, hledger_json("print"), "hledger print and bal")


# --- the checks ---


class Check:
    def __init__(self, name: str):
        self.name = name
        self.detail = ""
        self.differences: list[str] = []

    @property
    def passed(self) -> bool:
        return not self.differences


def money(value: Decimal | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def dbu6_id(transaction: dict) -> int | None:
    ids = [value for key, value in transaction["ttags"] if key == "dbu6-id"]
    return int(ids[0]) if ids else None


def postings(transaction: dict) -> list:
    return [(p["paccount"], total(p["pamount"])) for p in transaction["tpostings"]]


def check_journal() -> Check:
    check = Check("hledger check -s")
    run = hledger("check", "-s", "ordereddates", check=False)
    if run.returncode == 0:
        check.detail = "parses, balances, assertions hold, accounts declared"
    else:
        # hledger names files by their full path; this folder's is noise.
        message = run.stderr.replace(f"{HERE}/", "").strip().splitlines()
        reasons = [
            line
            for line in message
            if line.strip()
            and not line.startswith("hledger: Error")
            and "|" not in line
        ]
        check.detail = (reasons or message or ["failed"])[0].strip()
        check.differences = message or ["failed"]
    return check


def check_count(books: Books, expected: dict) -> Check:
    check = Check("transactions")
    ids = Counter(i for t in books.transactions if (i := dbu6_id(t)) is not None)
    found = sum(ids.values())
    check.detail = f"{found} with a dbu6-id, dbu6 has {expected['journal_count']}"
    if found != expected["journal_count"]:
        check.differences.append(
            f"hledger has {found} dbu6 journals, dbu6 {expected['journal_count']}"
        )
    for journal_id, times in sorted(ids.items()):
        if times > 1:
            check.differences.append(f"dbu6-id {journal_id} appears {times} times")
    return check


def check_accounts(books: Books, expected: dict) -> Check:
    check = Check("account balances")
    wanted = {a["account"]: a for a in expected["accounts"]}
    for name, account in wanted.items():
        balance = Decimal(account["balance"])
        if name not in books.own:
            check.differences.append(f"{name}: missing, dbu6 {money(balance)}")
            continue
        if books.own[name] != balance:
            check.differences.append(
                f"{name}: hledger {money(books.own[name])}, dbu6 {money(balance)}"
            )
        if books.types.get(name) != account["type"]:
            check.differences.append(
                f"{name}: type {books.types.get(name)}, dbu6 {account['type']}"
            )
    for name, balance in books.own.items():
        if name not in wanted and balance != ZERO:
            check.differences.append(f"{name}: hledger {money(balance)}, not in dbu6")
    check.detail = f"{len(wanted)} accounts with entries"
    return check


def section(report: dict, index: int) -> Decimal:
    return total(report["cbrSubreports"][index][1]["prTotals"]["prrTotal"])


def check_balance_sheet(expected: dict) -> tuple[Check, list]:
    bs, bse, income = (hledger_json(r) for r in ("bs", "bse", "is"))
    sheet = expected["balance_sheet"]
    figures = [
        ("Assets", sheet["assets"], section(bs, 0), "bs Assets"),
        ("Liabilities", sheet["liabilities"], section(bs, 1), "bs Liabilities"),
        ("Equity accounts", sheet["equity"], section(bse, 2), "bse Equity"),
        ("Income less spending", sheet["income_less_spending"],
         total(income["cbrTotals"]["prrTotal"]), "is Net"),
        ("Net worth", sheet["net_worth"], total(bs["cbrTotals"]["prrTotal"]),
         "bs Net"),
    ]  # fmt: skip
    rows = [(label, Decimal(dbu6), found, src) for label, dbu6, found, src in figures]
    check = Check("balance sheet")
    check.detail = f"{len(rows)} figures from hledger bs, bse and is"
    check.differences = [
        f"{label}: hledger ({src}) {money(found)}, dbu6 {money(dbu6)}"
        for label, dbu6, found, src in rows
        if found != dbu6
    ]
    return check, rows


def check_assertions(books: Books, expected: dict) -> Check:
    check = Check("balance assertions")
    tagged: dict[int, set] = {}
    untagged = set()
    for t in books.transactions:
        asserted = {
            (p["paccount"], quantity(p["pbalanceassertion"]["baamount"]))
            for p in t["tpostings"]
            if p.get("pbalanceassertion")
        }
        journal_id = dbu6_id(t)
        if journal_id is None:
            untagged |= {(t["tdate"], account, b) for account, b in asserted}
        else:
            tagged.setdefault(journal_id, set()).update(asserted)
    moved = 0
    for a in expected["assertions"]:
        balance = Decimal(a["balance"])
        if (a["account"], balance) in tagged.get(a["dbu6_id"], set()):
            continue
        if (a["date"], a["account"], balance) in untagged:
            moved += 1
            continue
        check.differences.append(
            f"dbu6-id {a['dbu6_id']} {a['date']} {a['account']} = {money(balance)}:"
            " not in the journal"
        )
    check.detail = f"{len(expected['assertions'])} recorded, {moved} at end of day"
    return check


def check_samples(books: Books, expected: dict) -> Check:
    check = Check("sample transactions")
    by_id = {dbu6_id(t): t for t in books.transactions}
    for sample in expected["sample_transactions"]:
        label = f"dbu6-id {sample['dbu6_id']}"
        found = by_id.get(sample["dbu6_id"])
        if found is None:
            check.differences.append(f"{label}: not in the journal")
            continue
        if found["tdate"] != sample["date"]:
            check.differences.append(
                f"{label}: date {found['tdate']}, dbu6 {sample['date']}"
            )
        if found["tdescription"] != sample["description"]:
            check.differences.append(
                f"{label}: description {found['tdescription']!r},"
                f" dbu6 {sample['description']!r}"
            )
        want = [(p["account"], Decimal(p["amount"])) for p in sample["postings"]]
        if postings(found) != want:
            check.differences.append(f"{label}: postings differ")
            check.differences += [
                f"    hledger {account}  {money(amount)}"
                for account, amount in postings(found)
            ] + [f"    dbu6    {account}  {money(amount)}" for account, amount in want]
    check.detail = f"{len(expected['sample_transactions'])} picked at export"
    return check


# --- the report ---


def table(rows: list, right: set) -> list[str]:
    widths = [max(len(str(r[i])) for r in rows) for i in range(len(rows[0]))]
    return [
        "  ".join(
            str(cell).rjust(w) if i in right else str(cell).ljust(w)
            for i, (cell, w) in enumerate(zip(row, widths))
        ).rstrip()
        for row in rows
    ]


def main() -> int:
    if shutil.which("hledger") is None:
        print("hledger is not on PATH: https://hledger.org/install.html")
        return 2
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    version = hledger("--version", check=False).stdout.strip() or "hledger"
    print(f"Checking {JOURNAL.name} against {EXPECTED.name}")
    print(f"  exported   {expected['generated_at']}")
    print(f"  last entry {expected['last_date'] or '—'}")
    print(f"  {version}")
    print()

    checks = [check_journal()]
    try:
        if shutil.which("hledger-web"):
            books = read_with_hledger_web()
        else:
            print("hledger-web is not on PATH; reading with hledger print and bal.")
            books = read_with_hledger_cli()
        sheet_check, sheet_rows = check_balance_sheet(expected)
    except Unrunnable as error:
        for line in table(
            [("PASS" if c.passed else "FAIL", c.name, c.detail) for c in checks],
            set(),
        ):
            print(line)
        print(f"\nThe other checks need hledger to read the journal: {error}")
        return 1
    checks += [
        check_count(books, expected),
        check_accounts(books, expected),
        sheet_check,
        check_assertions(books, expected),
        check_samples(books, expected),
    ]

    for line in table(
        [("PASS" if c.passed else "FAIL", c.name, c.detail) for c in checks], set()
    ):
        print(line)

    for check in checks:
        if check.passed:
            continue
        print(f"\n{check.name}:")
        for line in check.differences[:SHOWN]:
            print(f"  {line}")
        if len(check.differences) > SHOWN:
            print(f"  … {len(check.differences) - SHOWN} more")

    print()
    for line in table(
        [("", "dbu6", "hledger", "")]
        + [(label, money(d), money(h), src) for label, d, h, src in sheet_rows],
        {1, 2},
    ):
        print(f"  {line}")
    print(
        "  hledger leaves revenue and expenses unclosed: bse's Net is dbu6's"
        " Income less spending, and bs's Net is dbu6's net worth."
    )
    print(f"  Read with {books.source}.")

    failed = sum(not c.passed for c in checks)
    print()
    if failed:
        print(f"{failed} of {len(checks)} checks failed")
        return 1
    print(f"All {len(checks)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
