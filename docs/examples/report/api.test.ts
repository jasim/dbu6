// Run with `node --test reports/spending-by-weekday/api.test.ts`, or through
// `dbu6 check`. The function under test takes a ledger, so the test needs no
// server: `openTestLedger` is dbu6's schema in memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gridDatasetSchema, openTestLedger } from "dbu6/server";
import { spendingByWeekdayReport } from "./api.ts";

function books() {
  const books = openTestLedger();
  const bank = books.addAccount({ name: "Sample Bank", account_type: "Asset" });
  const savings = books.addAccount({
    name: "Sample Savings",
    account_type: "Asset",
  });
  const food = books.addAccount({
    name: "Sample Food",
    account_type: "Expense",
  });
  const spend = (date: string, amount: number) =>
    books.addJournal({
      date,
      description: "sample purchase",
      entries: [
        { account_id: food, debit: amount },
        { account_id: bank, credit: amount },
      ],
    });
  spend("2026-03-02", 1000); // a Monday
  spend("2026-03-09", 500); // the next Monday
  spend("2026-03-07", 2000); // a Saturday
  spend("2026-04-06", 4000); // a Monday outside March
  // A Tuesday transfer between the user's own accounts: not spending.
  books.addJournal({
    date: "2026-03-03",
    description: "sample transfer",
    entries: [
      { account_id: savings, debit: 3000 },
      { account_id: bank, credit: 3000 },
    ],
  });
  return books;
}

test("totals spending per weekday within the period, transfers left out", () => {
  const result = spendingByWeekdayReport(books().ledger, {
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
  });

  // What the route answers must satisfy the contract's response schema.
  gridDatasetSchema.parse(result);
  const spending = Object.fromEntries(
    result.nodes.map((node) => [node.columns.weekday, node.columns.spending]),
  );
  assert.deepEqual(spending, {
    Sunday: 0,
    Monday: 1500,
    Tuesday: 0,
    Wednesday: 0,
    Thursday: 0,
    Friday: 0,
    Saturday: 2000,
  });
  assert.equal(result.footerRows?.[0]?.columns.spending, 3500);
});

test("covers all time without a period", () => {
  const result = spendingByWeekdayReport(books().ledger, {
    fromDate: null,
    toDate: null,
  });
  assert.equal(result.footerRows?.[0]?.columns.spending, 7500);
});
