import { describe, expect, it } from "vitest";
import { buildHledgerExpectations } from "./expectations.js";
import type {
  ExpectedBalanceSheet,
  ExportJournal,
  HledgerExportInput,
} from "./model.js";

const BALANCE_SHEET: ExpectedBalanceSheet = {
  assets: "0.00",
  liabilities: "0.00",
  equity: "0.00",
  income_less_spending: "0.00",
  net_worth: "0.00",
};

/** A repeatable stand-in for Math.random: the fractions of seed × k × φ. */
function seeded(seed: number): () => number {
  let k = 0;
  return () => {
    k += 1;
    const x = seed * k * 0.6180339887;
    return x - Math.floor(x);
  };
}

function spend(id: number, date: string, amount: number): ExportJournal {
  return {
    id,
    date,
    description: `NOPII spend ${id}`,
    entries: [
      {
        id: id * 10 + 1,
        account_id: 3,
        debit: amount,
        credit: 0,
        assertion: null,
        comment: null,
        source_narration: null,
      },
      {
        id: id * 10 + 2,
        account_id: 2,
        debit: 0,
        credit: amount,
        assertion: null,
        comment: null,
        source_narration: null,
      },
    ],
  };
}

function input(journals: ExportJournal[]): HledgerExportInput {
  return {
    accounts: [
      { id: 1, name: "Assets", parent_id: null, account_type: "Asset" },
      { id: 2, name: "Sample Bank", parent_id: 1, account_type: "Asset" },
      { id: 3, name: "Food", parent_id: null, account_type: "Expense" },
      { id: 4, name: "Unused", parent_id: null, account_type: "Expense" },
    ],
    journals,
    statementAccounts: [{ account_id: 2, name: "Sample Bank" }],
  };
}

function expectations(
  journals: ExportJournal[],
  seed = 1,
  sampleSize?: number,
) {
  return buildHledgerExpectations({
    input: input(journals),
    balanceSheet: BALANCE_SHEET,
    generatedAt: "2026-03-01T00:00:00.000Z",
    random: seeded(seed),
    sampleSize,
  });
}

const thirty = Array.from({ length: 30 }, (_, index) =>
  spend(index + 1, `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, 100),
);

describe("what hledger should find in the export", () => {
  it("sums each account's own entries, by path, skipping accounts without any", () => {
    const result = expectations([
      spend(1, "2026-01-02", 100),
      spend(2, "2026-01-03", 250),
    ]);

    expect(result.accounts).toEqual([
      { account: "Assets:Sample Bank", type: "A", balance: "-350.00" },
      { account: "Food", type: "X", balance: "350.00" },
    ]);
    expect(result.journal_count).toBe(2);
    expect(result.last_date).toBe("2026-01-03");
    expect(result.balance_sheet).toBe(BALANCE_SHEET);
  });

  it("sums in paise, so float amounts come out exact", () => {
    const result = expectations([
      spend(1, "2026-01-02", 0.1),
      spend(2, "2026-01-03", 0.2),
    ]);

    expect(result.accounts.find((a) => a.account === "Food")?.balance).toBe(
      "0.30",
    );
  });

  it("lists every recorded balance assertion", () => {
    const journal = spend(5, "2026-02-01", 100);
    journal.entries[1]!.assertion = -100;

    expect(expectations([journal]).assertions).toEqual([
      {
        dbu6_id: 5,
        date: "2026-02-01",
        account: "Assets:Sample Bank",
        balance: "-100.00",
      },
    ]);
  });

  it("samples distinct journals in date order, the same set for the same seed", () => {
    const first = expectations(thirty, 7).sample_transactions;
    const ids = first.map((transaction) => transaction.dbu6_id);

    expect(first).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(expectations(thirty, 7).sample_transactions).toEqual(first);
    expect(
      expectations(thirty, 8).sample_transactions.map((t) => t.dbu6_id),
    ).not.toEqual(ids);
    const keys = first.map((t) => `${t.date} ${String(t.dbu6_id).padStart(3)}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("takes every journal when there are fewer than the sample size", () => {
    const sample = expectations(thirty.slice(0, 3), 1).sample_transactions;

    expect(sample.map((transaction) => transaction.dbu6_id)).toEqual([1, 2, 3]);
    expect(sample[0]).toEqual({
      dbu6_id: 1,
      date: "2026-01-01",
      description: "NOPII spend 1",
      postings: [
        { account: "Food", amount: "100.00" },
        { account: "Assets:Sample Bank", amount: "-100.00" },
      ],
    });
  });

  it("describes a sampled journal as the export prints it", () => {
    const journal = spend(9, "2026-01-05", 100);
    journal.description = "(UPI) NOPII; payee | note";

    expect(expectations([journal]).sample_transactions[0]?.description).toBe(
      "UPI) NOPII, payee / note",
    );
  });
});
