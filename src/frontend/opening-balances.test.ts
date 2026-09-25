import { ApiError } from "@sapporta/shared/client";
import { describe, expect, it } from "vitest";
import type { OpeningBalanceAccount, OpeningBalances } from "../shared/index";
import {
  amountHint,
  balanceSections,
  dateHint,
  fieldsFor,
  focuses,
  journalHref,
  ledgerAmount,
  lockedJournal,
  lockText,
  openingFigure,
  parentLine,
  readBalance,
  recordedSections,
  signReadback,
  typedAmount,
} from "./opening-balances";

/*
 * Opening balances' rules without a screen: which table an
 * account is in, how its balance reads, and what the dialog opens with and
 * sends, the amount always typed the user's way up.
 */

function account(
  name: string,
  path: string,
  more: Partial<OpeningBalanceAccount> = {},
): OpeningBalanceAccount {
  return {
    account_id: path.length,
    name,
    path,
    account_type: path.startsWith("Liabilities") ? "Liability" : "Asset",
    section: path.startsWith("Liabilities") ? "owe" : "own",
    first_activity_date: null,
    default_date: null,
    suggested_amount: null,
    opening: null,
    ...more,
  };
}

const opening = (amount: number, more = {}) => ({
  journal_id: 21,
  date: "2026-03-31",
  amount,
  description: "Opening balance",
  locked: null,
  ...more,
});

const books = (...accounts: OpeningBalanceAccount[]): OpeningBalances => ({
  equity_account: null,
  accounts,
});

describe("the sign rule", () => {
  it("takes what an asset held as is, and what a liability owes below zero", () => {
    expect(ledgerAmount("Asset", "₹ 12,000.50")).toBe(12000.5);
    expect(ledgerAmount("Liability", "3000")).toBe(-3000);
    expect(ledgerAmount("Liability", "-500")).toBe(500);
    expect(Object.is(ledgerAmount("Liability", "0"), 0)).toBe(true);
    expect(ledgerAmount("Asset", ".5")).toBe(0.5);
    expect(ledgerAmount("Asset", "")).toBeNull();
    expect(ledgerAmount("Asset", "twelve")).toBeNull();
  });

  it("shows a ledger amount the same way up", () => {
    expect(typedAmount("Asset", 640000)).toBe("640000.00");
    expect(typedAmount("Liability", -3000)).toBe("3000.00");
    expect(typedAmount("Liability", 0)).toBe("0.00");
  });

  it("says what a typed amount below zero means", () => {
    expect(signReadback("Asset", "-100")).toBe("Below zero: overdrawn.");
    expect(signReadback("Liability", "-500")).toBe("Below zero: in credit.");
    expect(signReadback("Liability", "500")).toBeNull();
    expect(signReadback("Asset", "-")).toBeNull();
  });
});

describe("balanceSections", () => {
  const cash = account("Cash", "Assets:Cash");
  const epf = account("EPF", "Assets:Investments:EPF");
  const group = account("Investments", "Assets:Investments", {
    section: null,
  });
  const loan = account("Sample Car Loan", "Liabilities:Loans:Sample Car Loan");
  const card = account("Sample Card", "Liabilities:Cards:Sample Card", {
    section: "statement",
  });

  it("lists what you own, what you owe, then banks and cards, in tree order", () => {
    const sections = balanceSections(books(card, loan, epf, group, cash), null);
    expect(
      sections.map((one) => [
        `${one.term} · ${one.caption}`,
        one.amountHeading,
        one.accounts.map((a) => a.name),
      ]),
    ).toEqual([
      ["Assets · what you own", "Balance", ["Cash", "EPF"]],
      ["Liabilities · what you owe", "Owed", ["Sample Car Loan"]],
      [
        "Banks & cards · set by each first statement",
        "Balance",
        ["Sample Card"],
      ],
    ]);
  });

  it("leaves an empty section out", () => {
    expect(
      balanceSections(books(card), null).map((one) => one.section),
    ).toEqual(["statement"]);
  });

  it("shows a group account a link names, in its type's section", () => {
    const sections = balanceSections(books(epf, group), "Assets:Investments");
    expect(sections[0].accounts.map((a) => a.name)).toEqual([
      "Investments",
      "EPF",
    ]);
  });

  it("keeps the recorded balances for the page, and the one a link names", () => {
    const recorded = { ...epf, opening: opening(640000) };
    const names = (focus: string | null) =>
      recordedSections(books(cash, recorded, loan, card), focus).map((one) => [
        one.section,
        one.accounts.map((a) => a.name),
      ]);
    expect(names(null)).toEqual([["own", ["EPF"]]]);
    expect(names("Sample Card")).toEqual([
      ["own", ["EPF"]],
      ["statement", ["Sample Card"]],
    ]);
  });

  it("matches a link by the account's name or its path", () => {
    expect(focuses(loan, "Sample Car Loan")).toBe(true);
    expect(focuses(loan, "Liabilities:Loans:Sample Car Loan")).toBe(true);
    expect(focuses(loan, "Loans")).toBe(false);
    expect(focuses(loan, null)).toBe(false);
  });
});

describe("a row's words", () => {
  it("names the parents below the type's top account", () => {
    expect(parentLine(account("Cash", "Assets:Cash"))).toBeNull();
    expect(
      parentLine(
        account("NOPII Fund", "Assets:Investments:Mutual Funds:NOPII Fund"),
      ),
    ).toBe("Investments > Mutual Funds");
  });

  it("reads a balance the user's way up", () => {
    const own = (amount: number) =>
      openingFigure(
        "own",
        account("Cash", "Assets:Cash", { opening: opening(amount) }),
      );
    const owe = (amount: number) =>
      openingFigure(
        "owe",
        account("Loan", "Liabilities:Loan", { opening: opening(amount) }),
      );
    expect(own(640000)).toBe("6,40,000.00");
    expect(own(-100)).toBe("100.00 overdrawn");
    expect(owe(-250000)).toBe("2,50,000.00");
    expect(owe(500)).toBe("500.00 in credit");
    expect(
      openingFigure(
        "statement",
        account("Card", "Liabilities:Card", { opening: opening(-3000) }),
      ),
    ).toBe("3,000.00 owed");
    expect(openingFigure("own", account("Cash", "Assets:Cash"))).toBeNull();
  });

  it("says why a locked balance can't change here", () => {
    expect(lockText("has_entries")).toBe(
      "Has other transactions. Change it in its journal entry.",
    );
    expect(lockText("shared_entry")).toBe(
      "Recorded with other accounts in one entry. Change it there.",
    );
  });

  it("reads the journal a lock refusal names, and nothing else", () => {
    const refused = (status: number, body: unknown) =>
      lockedJournal(new ApiError(status, body));

    expect(
      refused(409, {
        code: "account_has_entries",
        error: "NOPII",
        journal_id: 21,
      }),
    ).toBe(21);
    expect(refused(409, { code: "already_recorded", error: "NOPII" })).toBe(
      null,
    );
    expect(
      refused(422, {
        code: "date_not_before_first_activity",
        error: "NOPII",
        journal_id: 21,
      }),
    ).toBe(null);
    expect(lockedJournal(new Error("offline"))).toBe(null);
    expect(journalHref(21)).toBe("/tables/journals?filter[id][eq]=21");
  });
});

describe("the dialog's fields", () => {
  it("opens an add on the suggestion and the default date, else today", () => {
    const card = account("Card", "Liabilities:Card", {
      suggested_amount: -3000,
      default_date: "2026-03-31",
    });
    expect(fieldsFor(card, "2026-09-25")).toEqual({
      amount: "3000.00",
      date: "2026-03-31",
      note: "",
    });
    expect(fieldsFor(account("Cash", "Assets:Cash"), "2026-09-25")).toEqual({
      amount: "",
      date: "2026-09-25",
      note: "",
    });
  });

  it("opens an edit on the recorded balance, leaving the default note blank", () => {
    const loan = account("Loan", "Liabilities:Loan", {
      opening: opening(-250000),
    });
    expect(fieldsFor(loan, "2026-09-25")).toEqual({
      amount: "250000.00",
      date: "2026-03-31",
      note: "",
    });
    const noted = account("EPF", "Assets:EPF", {
      opening: opening(1000, { description: "From the NOPII passbook" }),
    });
    expect(fieldsFor(noted, "2026-09-25").note).toBe("From the NOPII passbook");
  });

  it("reads the fields, first problem first", () => {
    const loan = account("Loan", "Liabilities:Loan", {
      first_activity_date: "2026-04-05",
    });
    const read = (amount: string, date = "2026-04-04", note = "") =>
      readBalance(loan, { amount, date, note });
    expect(read("3,000")).toEqual({
      ok: true,
      date: "2026-04-04",
      amount: -3000,
    });
    expect(read("0", "2026-04-04", " From the bank ")).toEqual({
      ok: true,
      date: "2026-04-04",
      amount: 0,
      description: "From the bank",
    });
    expect(read(" ", "")).toEqual({
      ok: false,
      problem: "Enter the amount owed.",
    });
    expect(read("abc", "")).toEqual({
      ok: false,
      problem: "Enter the amount as a number.",
    });
    expect(read("10", "")).toEqual({ ok: false, problem: "Pick a date." });
    expect(read("10", "2026-04-05")).toEqual({
      ok: false,
      problem: "Pick a day before 5 Apr 2026, its first transaction.",
    });
    expect(
      readBalance(account("Cash", "Assets:Cash"), {
        amount: "",
        date: "",
        note: "",
      }),
    ).toEqual({ ok: false, problem: "Enter the balance." });
  });

  it("hints what the amount and the date are", () => {
    expect(amountHint("Asset", false)).toBe("What it held.");
    expect(amountHint("Liability", false)).toBe("What you owed.");
    expect(amountHint("Liability", true)).toBe(
      "From its first statement's balances.",
    );

    const cash = account("Cash", "Assets:Cash");
    expect(dateHint({ ...cash, first_activity_date: "2026-04-05" }, true)).toBe(
      "Before its first transaction on 5 Apr 2026.",
    );
    expect(dateHint({ ...cash, default_date: "2026-03-31" }, true)).toBe(
      "When your books start.",
    );
    expect(dateHint(cash, true)).toBe("The day your balance is from.");
    expect(dateHint({ ...cash, default_date: "2026-03-31" }, false)).toBe(
      "The day your balance is from.",
    );
  });
});
