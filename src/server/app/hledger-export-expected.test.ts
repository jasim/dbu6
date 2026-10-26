import { describe, expect, it } from "vitest";
import { openTestLedger } from "../report-kit.js";
import { expectedBalanceSheet } from "./hledger-export-expected.js";

/*
 * Opening Balances (equity) funds Sample Bank with 5000; Salary pays in 1000,
 * Groceries takes 400 and Sample Card owes 250 for Fuel. Income less
 * spending is 1000 − 400 − 250 = 350.
 */
function books() {
  const ledger = openTestLedger();
  const bank = ledger.addAccount({
    name: "Sample Bank",
    account_type: "Asset",
  });
  const card = ledger.addAccount({
    name: "Sample Card",
    account_type: "Liability",
  });
  const opening = ledger.addAccount({
    name: "Opening Balances",
    account_type: "Equity",
  });
  const salary = ledger.addAccount({ name: "Salary", account_type: "Revenue" });
  const groceries = ledger.addAccount({
    name: "Groceries",
    account_type: "Expense",
  });
  const fuel = ledger.addAccount({ name: "Fuel", account_type: "Expense" });
  ledger.addJournal({
    date: "2026-01-01",
    description: "NOPII opening",
    entries: [
      { account_id: bank, debit: 5000 },
      { account_id: opening, credit: 5000 },
    ],
  });
  ledger.addJournal({
    date: "2026-01-15",
    description: "NOPII salary",
    entries: [
      { account_id: bank, debit: 1000 },
      { account_id: salary, credit: 1000 },
    ],
  });
  ledger.addJournal({
    date: "2026-02-01",
    description: "NOPII grocer",
    entries: [
      { account_id: groceries, debit: 400 },
      { account_id: bank, credit: 400 },
    ],
  });
  // Far in the future: the figures count every journal, as hledger does.
  ledger.addJournal({
    date: "2099-03-01",
    description: "NOPII fuel",
    entries: [
      { account_id: fuel, debit: 250 },
      { account_id: card, credit: 250 },
    ],
  });
  return ledger;
}

describe("the Balance Sheet's figures for the export's check", () => {
  it("reads each section, the income less spending row and net worth off the report", () => {
    expect(expectedBalanceSheet(books().ledger)).toEqual({
      assets: "5600.00",
      liabilities: "250.00",
      equity: "5000.00",
      income_less_spending: "350.00",
      net_worth: "5350.00",
    });
  });

  it("is all zeros for empty books", () => {
    expect(expectedBalanceSheet(openTestLedger().ledger)).toEqual({
      assets: "0.00",
      liabilities: "0.00",
      equity: "0.00",
      income_less_spending: "0.00",
      net_worth: "0.00",
    });
  });
});
