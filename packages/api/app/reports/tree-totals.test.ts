import Database from "better-sqlite3";
import {
  gridDatasetSchema,
  type GridDataset,
} from "@sapporta/shared/grid-dataset";
import { describe, expect, it } from "vitest";
import { loadAccountLedgerJournalEntries } from "./account-ledger.js";
import { balanceSheetReport } from "./balance-sheet.js";
import { expenseBreakdownReport } from "./expense-breakdown.js";
import { incomeStatementReport } from "./income-statement.js";

const scope = { workspaceId: "workspace", userId: "user" };
const january = { ...scope, fromDate: "2026-01-01", toDate: "2026-01-31" };

/*
 * Entries sit on parent accounts as well as leaves: salary (6) and bank (8)
 * have children and entries of their own, and so do food (1) and dining (3).
 * Restaurants (4) is three levels down. Rent (5) is a top-level account with
 * no children. In January, 1,00,000 comes in and 26,000 goes out.
 */
function ledger(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT,
      parent_id INTEGER, account_type TEXT
    );
    CREATE TABLE journals (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, description TEXT
    );
    CREATE TABLE journal_entries (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER,
      account_id INTEGER, debit REAL, credit REAL, account_balance_assertion REAL,
      comment TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'expenses:food', NULL, 'Expense'),
      (2, 'workspace', 'user', 'expenses:food:groceries', 1, 'Expense'),
      (3, 'workspace', 'user', 'expenses:food:dining', 1, 'Expense'),
      (4, 'workspace', 'user', 'expenses:food:dining:restaurants', 3, 'Expense'),
      (5, 'workspace', 'user', 'expenses:rent', NULL, 'Expense'),
      (6, 'workspace', 'user', 'income:salary', NULL, 'Revenue'),
      (7, 'workspace', 'user', 'income:salary:bonus', 6, 'Revenue'),
      (8, 'workspace', 'user', 'assets:bank', NULL, 'Asset'),
      (9, 'workspace', 'user', 'assets:bank:sample-savings', 8, 'Asset');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-01', 'Salary'),
      (11, 'workspace', 'user', '2026-01-05', 'Spending'),
      (12, 'workspace', 'user', '2026-01-06', 'Cash to the bank');

    INSERT INTO journal_entries
      (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit)
    VALUES
      (101, 'workspace', 'user', 10, 9, 100000, 0),
      (102, 'workspace', 'user', 10, 6, 0, 90000),
      (103, 'workspace', 'user', 10, 7, 0, 10000),
      (111, 'workspace', 'user', 11, 2, 3000, 0),
      (112, 'workspace', 'user', 11, 1, 500, 0),
      (113, 'workspace', 'user', 11, 3, 1000, 0),
      (114, 'workspace', 'user', 11, 4, 1500, 0),
      (115, 'workspace', 'user', 11, 5, 20000, 0),
      (116, 'workspace', 'user', 11, 9, 0, 26000),
      (121, 'workspace', 'user', 12, 8, 2000, 0),
      (122, 'workspace', 'user', 12, 9, 0, 2000);
  `);
  return sqlite;
}

type Section = { total: number; accounts: [string, number][] };

/** Each root row's total and its child rows as [name, amount]. */
function sections(
  result: GridDataset,
  labelColumn: string,
  totalColumn: string,
  amountColumn: string,
): Record<string, Section> {
  const parsed = gridDatasetSchema.parse(result);
  return Object.fromEntries(
    parsed.nodes.map((node) => [
      String(node.columns[labelColumn]),
      {
        total: Number(node.rollup?.[totalColumn]),
        accounts: Object.values(node.children ?? {})
          .flat()
          .map((child): [string, number] => [
            String(child.columns.name),
            Number(child.columns[amountColumn]),
          ]),
      },
    ]),
  );
}

function footer(result: GridDataset, column: string): number[] {
  return (result.footerRows ?? []).map((row) => Number(row.columns[column]));
}

describe("reports over an account tree", () => {
  it("income statement counts entries on parent accounts", () => {
    const result = incomeStatementReport(ledger(), january);

    expect(sections(result, "section", "section_total", "balance")).toEqual({
      Revenue: {
        total: 100000,
        accounts: [
          ["income:salary", 90000],
          ["income:salary:bonus", 10000],
        ],
      },
      Expense: {
        total: 26000,
        accounts: [
          ["expenses:food", 500],
          ["expenses:food:dining", 1000],
          ["expenses:food:dining:restaurants", 1500],
          ["expenses:food:groceries", 3000],
          ["expenses:rent", 20000],
        ],
      },
    });
    expect(footer(result, "section_total")).toEqual([74000]);
  });

  it("balance sheet counts entries on parent accounts", () => {
    const result = balanceSheetReport(ledger(), {
      ...scope,
      asOfDate: "2026-01-31",
    });

    expect(
      sections(result, "section", "section_total", "balance").Asset,
    ).toEqual({
      total: 74000,
      accounts: [
        ["assets:bank", 2000],
        ["assets:bank:sample-savings", 72000],
      ],
    });
  });

  it("spending breakdown puts each account under the top of its branch, once", () => {
    const result = expenseBreakdownReport(ledger(), january);

    expect(
      sections(result, "category_name", "category_total", "amount"),
    ).toEqual({
      "expenses:rent": {
        total: 20000,
        accounts: [["expenses:rent", 20000]],
      },
      "expenses:food": {
        total: 6000,
        accounts: [
          ["expenses:food:groceries", 3000],
          ["expenses:food:dining:restaurants", 1500],
          ["expenses:food:dining", 1000],
          ["expenses:food", 500],
        ],
      },
    });
    expect(footer(result, "category_total")).toEqual([26000]);
  });

  // A regression here hangs rather than fails: better-sqlite3 runs the
  // recursive query synchronously, out of reach of the test timeout.
  it("account ledger ends on a loop in parent_id", () => {
    const sqlite = ledger();
    // Food (1) now sits under its own grandchild, restaurants (4).
    sqlite.exec("UPDATE accounts SET parent_id = 4 WHERE id = 1");

    const lines = loadAccountLedgerJournalEntries(sqlite, {
      ...january,
      accountId: 1,
    });

    expect(lines.map((line) => line.entry_id)).toEqual([
      111, 112, 113, 114, 115, 116,
    ]);
  });
});
