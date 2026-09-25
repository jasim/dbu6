import { describe, expect, it } from "vitest";
import type { FirstStatementRow, RecognizedFinding } from "../../shared/index";
import {
  balanceFact,
  importedSummary,
  importWaiting,
  numberFact,
  openingAmount,
  stillToImport,
  withFinding,
} from "./first-statements";

/*
 * A read statement for Sample Savings: 42 rows in August, opening at 12,000
 * on 31 July, printing the number the account doesn't have yet.
 */
const FINDING: RecognizedFinding = {
  outcome: "recognized",
  parser: "sample-bank-xls",
  printed_identifier: "050505000012",
  printed_institution: "SAMPLE BANK LTD",
  period: { first_date: "2026-08-01", last_date: "2026-08-31" },
  transactions: 42,
  opening: { date: "2026-07-31", amount: 12000 },
  existing_opening: null,
  parser_institution: null,
  institution: "Sample Bank",
  moves: false,
  identifier_state: "set",
  changes: [],
};

const ROW: FirstStatementRow = {
  account_id: 2,
  name: "Sample Savings",
  kind: "bank",
  institution: "Sample Bank",
  account_identifiers: [],
  activity: { entries: 0, drafts: 0, uncategorized: 0 },
  status: "needs_statement",
};

const NOTHING_TYPED = { numberAccepted: false, typedBalance: "" };

describe("numberFact", () => {
  it("saves a number new to the account, or the same one", () => {
    expect(numberFact(ROW, FINDING, false)).toEqual({
      state: "saved",
      value: "ending 0012",
    });
    expect(
      numberFact(
        { account_identifiers: ["050505000012"] },
        { ...FINDING, identifier_state: "same" },
        false,
      ),
    ).toEqual({ state: "saved", value: "ending 0012" });
  });

  it("says so when the statement prints none", () => {
    expect(
      numberFact(
        { account_identifiers: ["050505000099"] },
        {
          ...FINDING,
          printed_identifier: null,
          identifier_state: "none_printed",
        },
        false,
      ),
    ).toEqual({ state: "not_on_statement", value: "ending 0099" });
  });

  it("sets the two numbers side by side until the statement's is taken", () => {
    const differing = {
      ...FINDING,
      identifier_state: "different" as const,
    };
    const own = { account_identifiers: ["050505000099"] };
    expect(numberFact(own, differing, false)).toEqual({
      state: "differs",
      printed: "ending 0012",
      own: "ending 0099",
    });
    expect(numberFact(own, differing, true)).toEqual({
      state: "saved",
      value: "ending 0012",
    });
  });
});

describe("balanceFact", () => {
  it("takes a bank's balance from the statement", () => {
    expect(balanceFact("bank", FINDING)).toEqual({
      state: "from_statement",
      label: "Balance on 31 Jul 2026",
      value: "12,000.00",
    });
  });

  it("reads a card's ledger balance as the amount owed", () => {
    expect(
      balanceFact("card", {
        ...FINDING,
        opening: { date: "2026-07-31", amount: -12000 },
      }),
    ).toEqual({
      state: "from_statement",
      label: "Amount owed on 31 Jul 2026",
      value: "12,000.00",
    });
  });

  it("asks when the statement prints no balance", () => {
    const none = { ...FINDING, opening: { date: "2026-07-31", amount: null } };
    expect(balanceFact("bank", none)).toEqual({
      state: "ask",
      label: "Balance on 31 Jul 2026",
      caption: "Not on the statement. What it held on 31 Jul 2026.",
    });
    expect(balanceFact("card", none)).toMatchObject({
      caption: "Not on the statement. What you owed on 31 Jul 2026.",
    });
  });

  it("reads nothing owed on a card as 0, and money on it as in credit", () => {
    const card = (amount: number) =>
      balanceFact("card", {
        ...FINDING,
        opening: { date: "2026-07-31", amount },
      });
    expect(card(0)).toEqual({
      state: "from_statement",
      label: "Amount owed on 31 Jul 2026",
      value: "0.00",
    });
    expect(card(500)).toEqual({
      state: "from_statement",
      label: "Balance on 31 Jul 2026",
      value: "500.00 in credit",
    });
  });

  it("shows the opening entry already in the books, and records none", () => {
    const inBooks = {
      ...FINDING,
      existing_opening: { date: "2026-06-30", amount: -2000 },
    };
    expect(balanceFact("bank", inBooks)).toEqual({
      state: "in_books",
      label: "Balance on 30 Jun 2026",
      value: "-2,000.00",
    });
    expect(balanceFact("card", inBooks)).toEqual({
      state: "in_books",
      label: "Amount owed on 30 Jun 2026",
      value: "2,000.00",
    });
  });
});

describe("openingAmount", () => {
  it("reads a typed amount, and a card's as owed", () => {
    expect(openingAmount("bank", "12,000.50")).toBe(12000.5);
    expect(openingAmount("card", "12000")).toBe(-12000);
    expect(openingAmount("card", "0")).toBe(0);
    expect(openingAmount("bank", "")).toBeNull();
    expect(openingAmount("bank", "twelve")).toBeNull();
  });
});

describe("importWaiting", () => {
  it("waits on a number that differs until the statement's is taken", () => {
    const differing = { ...FINDING, identifier_state: "different" as const };
    expect(importWaiting("bank", differing, NOTHING_TYPED)).toBe(
      "The numbers differ",
    );
    expect(
      importWaiting("bank", differing, {
        numberAccepted: true,
        typedBalance: "",
      }),
    ).toBeUndefined();
  });

  it("waits on a balance the statement doesn't give", () => {
    const none = { ...FINDING, opening: { date: "2026-07-31", amount: null } };
    expect(importWaiting("bank", none, NOTHING_TYPED)).toBe(
      "Enter the balance",
    );
    expect(
      importWaiting("bank", none, {
        numberAccepted: false,
        typedBalance: "12000",
      }),
    ).toBeUndefined();
    expect(
      importWaiting(
        "bank",
        {
          ...none,
          existing_opening: { date: "2026-07-31", amount: 12000 },
        },
        NOTHING_TYPED,
      ),
    ).toBeUndefined();
  });

  it("imports a statement that gives everything", () => {
    expect(importWaiting("bank", FINDING, NOTHING_TYPED)).toBeUndefined();
  });
});

describe("importedSummary", () => {
  it("counts what is left to review, else what is in the books", () => {
    expect(importedSummary({ entries: 0, drafts: 42, uncategorized: 4 })).toBe(
      "42 to review · 4 need a category",
    );
    expect(importedSummary({ entries: 0, drafts: 42, uncategorized: 1 })).toBe(
      "42 to review · 1 needs a category",
    );
    expect(importedSummary({ entries: 0, drafts: 42, uncategorized: 0 })).toBe(
      "42 to review",
    );
    expect(importedSummary({ entries: 42, drafts: 0, uncategorized: 0 })).toBe(
      "42 in your books",
    );
  });
});

describe("rows", () => {
  it("move to read or unreadable with a finding", () => {
    expect(withFinding(ROW, FINDING)).toEqual({
      ...ROW,
      status: "read",
      finding: FINDING,
    });
    const unread = {
      outcome: "unrecognized" as const,
      saved_path: "tmp/statement-uploads/setup-sample-2/NOPII.pdf",
      tried: [],
    };
    expect(
      withFinding({ ...ROW, status: "read", finding: FINDING }, unread),
    ).toEqual({ ...ROW, status: "unreadable", finding: unread });
  });

  it("count the accounts still to import", () => {
    expect(
      stillToImport([
        ROW,
        { ...ROW, account_id: 4, status: "imported" },
        { ...ROW, account_id: 6, status: "read", finding: FINDING },
      ]),
    ).toBe(2);
  });
});
