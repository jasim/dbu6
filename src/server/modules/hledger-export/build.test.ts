import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHledgerBooks,
  sanitizeComment,
  sanitizeDescription,
} from "./build.js";
import type {
  ExportAccount,
  ExportEntry,
  ExportJournal,
  HledgerExportInput,
} from "./model.js";
import { formatPaise, renderHledgerBooks } from "./render.js";

const ACCOUNTS: ExportAccount[] = [
  { id: 10, name: "Expenses", parent_id: null, account_type: "Expense" },
  { id: 11, name: "Food", parent_id: 10, account_type: "Expense" },
  { id: 1, name: "Assets", parent_id: null, account_type: "Asset" },
  { id: 2, name: "Sample Savings", parent_id: 1, account_type: "Asset" },
  { id: 3, name: "Sample Wallet", parent_id: 1, account_type: "Asset" },
  { id: 4, name: "Liabilities", parent_id: null, account_type: "Liability" },
  { id: 5, name: "Sample Card", parent_id: 4, account_type: "Liability" },
  { id: 6, name: "Equity", parent_id: null, account_type: "Equity" },
  { id: 7, name: "Opening Balances", parent_id: 6, account_type: "Equity" },
  { id: 8, name: "Income", parent_id: null, account_type: "Revenue" },
];

const SAVINGS = 2;
const WALLET = 3;
const CARD = 5;
const OPENING = 7;
const FOOD = 11;

let nextEntryId = 100;
function entry(
  account_id: number,
  amount: number,
  more: Partial<ExportEntry> = {},
): ExportEntry {
  return {
    id: nextEntryId++,
    account_id,
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? -amount : 0,
    assertion: null,
    comment: null,
    source_narration: null,
    ...more,
  };
}

function journal(
  id: number,
  date: string,
  description: string,
  entries: ExportEntry[],
): ExportJournal {
  return { id, date, description, entries };
}

// Savings opens at 5000 and the card at 0. On 2026-01-05 the card is spent
// on (journal 9, the card's own file) and then paid off from savings
// (journal 10, a transfer, so the savings file, included first). The card's
// statement asserts 500 after the payment, its day's last row: true in the
// ledger's order, but hledger reads the savings file first, sees the
// payment before the spend, and so can only prove 500 at the day's end.
function sampleBooks(): HledgerExportInput {
  nextEntryId = 100;
  return {
    accounts: ACCOUNTS,
    statementAccounts: [
      { account_id: SAVINGS, name: "Sample Savings" },
      { account_id: 999, name: "NOPII Closed Account" },
      { account_id: CARD, name: "Sample Card" },
      { account_id: SAVINGS, name: "Sample Savings again" },
    ],
    journals: [
      journal(10, "2026-01-05", "Card payment", [
        entry(CARD, 1000, { assertion: 500 }),
        entry(SAVINGS, -1000, { assertion: 4000 }),
      ]),
      journal(1, "2026-01-01", "Opening balance", [
        entry(SAVINGS, 5000, { assertion: 5000 }),
        entry(OPENING, -5000),
      ]),
      journal(9, "2026-01-05", "Groceries", [
        entry(FOOD, 500, {
          comment: "Weekly shop",
          source_narration: "POS 050505 sample store",
        }),
        entry(CARD, -500),
      ]),
      journal(11, "2026-01-06", "Cash top-up", [
        entry(WALLET, 2500),
        entry(OPENING, -2500),
      ]),
    ],
  };
}

describe("buildHledgerBooks", () => {
  it("declares every account depth-first, roots by type", () => {
    const books = buildHledgerBooks(sampleBooks());
    expect(books.accounts).toEqual([
      { name: "Assets", type: "A" },
      { name: "Assets:Sample Savings", type: "A" },
      { name: "Assets:Sample Wallet", type: "A" },
      { name: "Liabilities", type: "L" },
      { name: "Liabilities:Sample Card", type: "L" },
      { name: "Equity", type: "E" },
      { name: "Equity:Opening Balances", type: "E" },
      { name: "Income", type: "R" },
      { name: "Expenses", type: "X" },
      { name: "Expenses:Food", type: "X" },
    ]);
  });

  it("writes a transfer once, in the first statement account's file", () => {
    const books = buildHledgerBooks(sampleBooks());
    const ids = (path: string) =>
      books.files
        .find((file) => file.path === path)!
        .transactions.map((transaction) => transaction.journalId);
    expect(books.files.map((file) => file.path)).toEqual([
      "sample-savings.journal",
      "sample-card.journal",
      "general-journals.journal",
      "balance-assertions.journal",
    ]);
    expect(ids("sample-savings.journal")).toEqual([1, 10]);
    expect(ids("sample-card.journal")).toEqual([9]);
    expect(ids("general-journals.journal")).toEqual([11]);
  });

  it("keeps an assertion hledger proves on its line, and moves one it proves only at the day's end", () => {
    const books = buildHledgerBooks(sampleBooks());
    const savings = books.files[0]!.transactions;
    expect(savings[0]!.postings[0]!.assertion).toBe(500000);
    expect(savings[1]!.postings.map((posting) => posting.assertion)).toEqual([
      null,
      400000,
    ]);
    expect(books.files[3]!.transactions).toEqual([
      {
        date: "2026-01-05",
        description: "balance assertion",
        journalId: null,
        postings: [
          {
            account: "Liabilities:Sample Card",
            amount: 0,
            assertion: 50000,
            comment: "dbu6 journal 10",
          },
        ],
      },
    ]);
  });

  it("leaves no assertions file when every assertion holds on its line", () => {
    const input = sampleBooks();
    input.statementAccounts = [{ account_id: CARD, name: "Sample Card" }];
    const books = buildHledgerBooks(input);
    expect(books.files.map((file) => file.path)).toEqual([
      "sample-card.journal",
      "general-journals.journal",
    ]);
  });

  it("keeps an assertion the ledger itself disagrees with on its line", () => {
    const input = sampleBooks();
    input.journals[1]!.entries[0]!.assertion = 4999;
    const books = buildHledgerBooks(input);
    expect(books.files[0]!.transactions[0]!.postings[0]!.assertion).toBe(
      499900,
    );
  });

  it("names files uniquely, never as the export's own files", () => {
    const input = sampleBooks();
    input.statementAccounts = [
      { account_id: SAVINGS, name: "Main" },
      { account_id: CARD, name: "main!" },
      { account_id: WALLET, name: "***" },
    ];
    expect(buildHledgerBooks(input).files.map((file) => file.path)).toEqual([
      "main-2.journal",
      "main-5.journal",
      "account-3.journal",
      "general-journals.journal",
      "balance-assertions.journal",
    ]);
  });
});

describe("sanitizeDescription", () => {
  it("keeps the description one header line with no comment, payee or code", () => {
    expect(sanitizeDescription("Rent; March | sample\npayee")).toBe(
      "Rent, March / sample payee",
    );
    expect(sanitizeDescription("(UPI) sample payment")).toBe(
      "UPI) sample payment",
    );
    expect(sanitizeDescription("  ")).toBe("no description");
  });
});

describe("sanitizeComment", () => {
  it("lets no tag or posting date be read from the text", () => {
    expect(sanitizeComment("paid date: tomorrow [12-03]")).toBe(
      "paid date∶ tomorrow (12-03)",
    );
    expect(sanitizeComment(" \n ")).toBeNull();
  });
});

describe("formatPaise", () => {
  it("prints whole paise as ungrouped rupees with two decimals", () => {
    expect(formatPaise(0)).toBe("0.00");
    expect(formatPaise(-5)).toBe("-0.05");
    expect(formatPaise(123456789)).toBe("1234567.89");
    expect(formatPaise(-100000)).toBe("-1000.00");
  });
});

describe("renderHledgerBooks", () => {
  it("prints main.journal and each included file", () => {
    const files = renderHledgerBooks(buildHledgerBooks(sampleBooks()));
    expect(Object.fromEntries(files.map((f) => [f.path, f.content]))).toEqual({
      "main.journal": `commodity 1,00,00,000.00  ; https://hledger.org/1.29/hledger.html#commodity-directive

account Assets  ; type: A
account Assets:Sample Savings  ; type: A
account Assets:Sample Wallet  ; type: A
account Liabilities  ; type: L
account Liabilities:Sample Card  ; type: L
account Equity  ; type: E
account Equity:Opening Balances  ; type: E
account Income  ; type: R
account Expenses  ; type: X
account Expenses:Food  ; type: X

include sample-savings.journal
include sample-card.journal
include general-journals.journal
include balance-assertions.journal
`,
      "sample-savings.journal": `; Transactions of Sample Savings

2026-01-01 * Opening balance  ; dbu6-id: 1
    Assets:Sample Savings     5000.00 = 5000.00
    Equity:Opening Balances  -5000.00

2026-01-05 * Card payment  ; dbu6-id: 10
    Liabilities:Sample Card   1000.00
    Assets:Sample Savings    -1000.00 = 4000.00
`,
      "sample-card.journal": `; Transactions of Sample Card

2026-01-05 * Groceries  ; dbu6-id: 9
    Expenses:Food             500.00  ; Weekly shop / POS 050505 sample store
    Liabilities:Sample Card  -500.00
`,
      "general-journals.journal": `; Transactions that touch none of the statement accounts

2026-01-06 * Cash top-up  ; dbu6-id: 11
    Assets:Sample Wallet      2500.00
    Equity:Opening Balances  -2500.00
`,
      "balance-assertions.journal": `; Balance assertions checked at the end of their day, after every file's transactions

2026-01-05 * balance assertion
    Liabilities:Sample Card  0.00 = 500.00  ; dbu6 journal 10
`,
    });
  });
});

const hledger = (() => {
  try {
    execFileSync("hledger", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hledger)("hledger reads the export", () => {
  function check(input: HledgerExportInput): string {
    const dir = mkdtempSync(join(tmpdir(), "dbu6-hledger-export-"));
    try {
      for (const file of renderHledgerBooks(buildHledgerBooks(input))) {
        writeFileSync(join(dir, file.path), file.content);
      }
      execFileSync(
        "hledger",
        ["-f", join(dir, "main.journal"), "check", "-s", "ordereddates"],
        { stdio: "pipe" },
      );
      return execFileSync(
        "hledger",
        ["-f", join(dir, "main.journal"), "balance", "--flat", "-N"],
        { encoding: "utf8" },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("passes strict checks, the moved assertion included", () => {
    const balances = check(sampleBooks());
    expect(balances).toContain("Liabilities:Sample Card");
  });

  it("passes strict checks with names that need escaping", () => {
    const input = sampleBooks();
    input.accounts = input.accounts.map((account) =>
      account.id === CARD
        ? { ...account, name: "(Old)  Sample:Card;\tNOPII" }
        : account.id === FOOD
          ? { ...account, name: "*Food [home]" }
          : account,
    );
    input.journals[2]!.description = "(UPI) sample; store | NOPII";
    input.journals[2]!.entries[0]!.comment = "date: 2026-13-45 [12-03]";
    expect(check(input)).toContain("Liabilities:Old Sample-Card; NOPII");
  });

  it("fails when an assertion is wrong, so the checks have teeth", () => {
    const input = sampleBooks();
    input.journals[1]!.entries[0]!.assertion = 4999;
    expect(() => check(input)).toThrow(/balance assertion/i);
  });
});
