import { describe, expect, it } from "vitest";
import type {
  AddAccountCandidate,
  StatementAccounts,
} from "../../shared/index";
import { readAddUrl } from "./state";
import {
  accountsInBooks,
  addedName,
  addMonthsLabel,
  balanceTitle,
  bankLine,
  candidateName,
  categorizerLine,
  contextLine,
  downloadLine,
  gapTitle,
  howFarBackTitle,
  lateStartTitle,
  periodLine,
  severalTitle,
  startFromLabel,
} from "./words";

/* What /add's cards say: few words, the accounting terms kept. */

const url = (search: string) => readAddUrl(new URLSearchParams(search));

function candidate(
  overrides: Partial<AddAccountCandidate> = {},
): AddAccountCandidate {
  return {
    key: "account:new:bank:050505000012",
    status: "new",
    account: null,
    institution: "Sample Bank",
    institution_listed: true,
    kind: "bank",
    identifier: "050505000012",
    parsers: ["sample-bank-xls"],
    file_names: ["jan.xls", "feb.xls"],
    period: { first_date: "2025-01-01", last_date: "2025-02-28" },
    transactions: 40,
    opening: { date: "2024-12-31", amount: 10000 },
    needs_opening: false,
    opening_refusal: null,
    refusal: null,
    ...overrides,
  };
}

const DATA: StatementAccounts = {
  institutions: [{ name: "Sample Bank", parsers: ["sample-bank-xls"] }],
  accounts: [
    {
      account_id: 3,
      name: "Sample Card",
      kind: "card",
      institution: "Sample Card Co",
      account_identifiers: ["050505XXXXXX0505"],
      parent: { id: 2, name: "Credit Cards" },
      in_ledger: true,
      entries: 0,
      drafts: 12,
    },
    {
      account_id: 4,
      name: "Sample Joint",
      kind: "bank",
      institution: "Sample Bank",
      account_identifiers: ["050505000023"],
      parent: { id: 1, name: "Bank Accounts" },
      in_ledger: true,
      entries: 0,
      drafts: 0,
    },
    {
      account_id: 9,
      name: "Sample Deleted",
      kind: "bank",
      institution: "Sample Bank",
      account_identifiers: ["050505000034"],
      parent: null,
      in_ledger: false,
      entries: 5,
      drafts: 0,
    },
  ],
  parents: {
    bank: [{ id: 1, name: "Bank Accounts", path: "Assets:Bank Accounts" }],
    card: [{ id: 2, name: "Credit Cards", path: "Liabilities:Credit Cards" }],
  },
  default_parents: { bank: 1, card: 2 },
  mixed_parents: { bank: false, card: false },
  unlisted: [],
  account_names: ["Assets", "Bank Accounts", "Sample Card", "Sample Joint"],
};

describe("card 2", () => {
  it("asks the first run about the books, a later add about the account", () => {
    expect(howFarBackTitle(url("?run=setup"))).toBe(
      "How far back should your books go?",
    );
    expect(howFarBackTitle(url(""))).toBe(
      "How far back do you want this bank or card's transactions?",
    );
  });

  it("says what to download", () => {
    expect(downloadLine({ kind: "month", month: "2025-01" })).toBe(
      "Download your statements from Jan 2025 to now, then come back.",
    );
    expect(downloadLine({ kind: "latest" })).toBe(
      "Download your latest statement, then come back.",
    );
  });
});

describe("the context line", () => {
  it("counts the first run's accounts from the books", () => {
    // A card with drafts counts; one with nothing yet and a deleted one don't.
    expect(accountsInBooks(DATA)).toBe(1);
    expect(contextLine(url("?run=setup"), 0)).toBe("Setting up your books");
    expect(contextLine(url("?run=setup"), 2)).toBe(
      "Setting up your books · 2 accounts added",
    );
    expect(contextLine(url("?run=setup"), 1)).toBe(
      "Setting up your books · 1 account added",
    );
    expect(contextLine(url(""), 5)).toBe("Adding a bank or card");
  });
});

describe("naming the account", () => {
  it("names an account by the books, else by the name Confirm suggests", () => {
    expect(
      candidateName(
        candidate({ account: { id: 4, name: "Sample Joint" } }),
        "bank",
        DATA,
      ),
    ).toBe("Sample Joint");
    expect(candidateName(candidate(), "bank", DATA)).toBe("Sample Savings");
    expect(candidateName(candidate(), "card", DATA)).toBe("Sample Credit Card");
    expect(candidateName(candidate(), null, DATA)).toBe("Sample Bank");
    expect(candidateName(candidate(), "bank", undefined)).toBe("Sample Bank");
    expect(candidateName(candidate({ institution: "" }), "bank", DATA)).toBe(
      "This account",
    );
  });

  it("names card 5's account from the books", () => {
    expect(addedName(4, DATA)).toBe("Sample Joint");
    expect(addedName(99, DATA)).toBeNull();
    expect(addedName(4, undefined)).toBeNull();
  });

  it("names both accounts of a drop, by their numbers", () => {
    expect(
      severalTitle(
        [
          candidate(),
          candidate({
            institution: "Sample Card Co",
            kind: "card",
            identifier: "050505XXXXXX0505",
          }),
        ],
        DATA,
      ),
    ).toBe(
      "These are from Sample Savings ending 0012 and Sample Card Co Credit Card ending 0505.",
    );
  });
});

describe("the conditional cards", () => {
  it("words the gap and late-start cards", () => {
    const gap = { endsIn: "2025-02", resumesIn: "2025-04", before: [] };
    expect(gapTitle(gap)).toBe(
      "A statement between Feb and Apr 2025 is missing",
    );
    expect(gapTitle({ ...gap, endsIn: "2024-12", resumesIn: "2025-02" })).toBe(
      "A statement between Dec 2024 and Feb 2025 is missing",
    );
    expect(startFromLabel("2025-04")).toBe("Start from Apr");

    expect(lateStartTitle("2025-01", "2025-03")).toBe(
      "These start in Mar 2025, not Jan",
    );
    expect(lateStartTitle("2024-11", "2025-03")).toBe(
      "These start in Mar 2025, not Nov 2024",
    );
    expect(addMonthsLabel("2025-01", "2025-03")).toBe("Add Jan–Feb");
    expect(addMonthsLabel("2025-01", "2025-02")).toBe("Add Jan 2025");
    expect(addMonthsLabel("2024-11", "2025-02")).toBe("Add Nov 2024–Jan 2025");
  });

  it("asks what a bank held, or what was owed on a card", () => {
    expect(balanceTitle("Sample Savings", "bank", "31 Dec 2024")).toBe(
      "What did Sample Savings hold on 31 Dec 2024?",
    );
    expect(balanceTitle("Sample Credit Card", "card", "31 Dec 2024")).toBe(
      "What did you owe on Sample Credit Card on 31 Dec 2024?",
    );
  });
});

describe("Confirm's facts", () => {
  it("puts each in a line", () => {
    expect(bankLine(candidate(), "bank")).toBe("Sample Bank · ending 0012");
    expect(bankLine(candidate({ identifier: null }), "bank")).toBe(
      "Sample Bank",
    );
    expect(bankLine(candidate({ institution: "" }), "bank")).toBe(
      "Account ending 0012",
    );
    expect(
      bankLine(
        candidate({ institution: "", identifier: "050505XXXXXX0505" }),
        "card",
      ),
    ).toBe("Card ending 0505");
    expect(
      bankLine(candidate({ institution: "", identifier: null }), "card"),
    ).toBe("New card");
    expect(
      periodLine(
        candidate({
          period: { first_date: "2025-01-03", last_date: "2026-08-28" },
          transactions: 600,
        }),
      ),
    ).toBe("Jan 2025 – Aug 2026 · 600 transactions");
    expect(periodLine(candidate({ transactions: 1 }))).toBe(
      "Jan – Feb 2025 · 1 transaction",
    );
  });

  it("says who categorizes, or why nobody does", () => {
    expect(categorizerLine({ ready: true, name: "Sample Agent" })).toBe(
      "Categorized by Sample Agent",
    );
    expect(
      categorizerLine({
        ready: false,
        name: "no coding agent",
        reason: "No coding agent is installed.",
      }),
    ).toBe("Not categorized: No coding agent is installed.");
  });
});
