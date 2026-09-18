import Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  gridDatasetSchema,
  type GridDataset,
} from "@sapporta/shared/grid-dataset";
import { incomeExpensesSchema, type IncomeExpensesAccount } from "dbu6-shared";
import { describe, expect, it } from "vitest";
import accountLedgerApi, {
  ledgerAccountIds,
  loadAccountLedgerJournalEntries,
} from "./account-ledger.js";
import { balanceSheetReport } from "./balance-sheet.js";
import { expenseBreakdownReport } from "./expense-breakdown.js";
import { incomeExpensesReport } from "./income-expenses.js";
import { incomeStatementReport } from "./income-statement.js";
import { monthlySummaryReport } from "./monthly-summary.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

const auth = testLedgerAuth();
const january = { fromDate: "2026-01-01", toDate: "2026-01-31" };

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
      (1, 'workspace', 'user', 'Food', NULL, 'Expense'),
      (2, 'workspace', 'user', 'Groceries', 1, 'Expense'),
      (3, 'workspace', 'user', 'Dining', 1, 'Expense'),
      (4, 'workspace', 'user', 'Restaurants', 3, 'Expense'),
      (5, 'workspace', 'user', 'Rent', NULL, 'Expense'),
      (6, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (7, 'workspace', 'user', 'Bonus', 6, 'Revenue'),
      (8, 'workspace', 'user', 'Bank', NULL, 'Asset'),
      (9, 'workspace', 'user', 'Sample Savings', 8, 'Asset');

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

type Breakdown = Record<
  string,
  { total: number; categories: Record<string, Section> }
>;

/** The Expense breakdown's top accounts, each with its categories. */
function breakdown(result: GridDataset): Breakdown {
  const parsed = gridDatasetSchema.parse(result);
  return Object.fromEntries(
    parsed.nodes.map((top) => [
      String(top.columns.top_name),
      {
        total: Number(top.rollup?.top_total),
        categories: Object.fromEntries(
          (top.children?.category ?? []).map((category) => [
            String(category.columns.category_name),
            {
              total: Number(category.rollup?.category_total),
              accounts: (category.children?.accounts ?? []).map(
                (row): [string, number] => [
                  String(row.columns.name),
                  Number(row.columns.amount),
                ],
              ),
            },
          ]),
        ),
      },
    ]),
  );
}

function footer(result: GridDataset, column: string): number[] {
  return (result.footerRows ?? []).map((row) => Number(row.columns[column]));
}

describe("reports over an account tree", () => {
  it("income statement counts entries on parent accounts", () => {
    const result = incomeStatementReport(ledger(), auth, january);

    expect(sections(result, "section", "section_total", "balance")).toEqual({
      Revenue: {
        total: 100000,
        accounts: [
          ["Bonus", 10000],
          ["Salary", 90000],
        ],
      },
      Expense: {
        total: 26000,
        accounts: [
          ["Dining", 1000],
          ["Food", 500],
          ["Groceries", 3000],
          ["Rent", 20000],
          ["Restaurants", 1500],
        ],
      },
    });
    expect(footer(result, "section_total")).toEqual([74000]);
  });

  it("balance sheet counts entries on parent accounts", () => {
    const result = balanceSheetReport(ledger(), auth, {
      asOfDate: "2026-01-31",
    });

    expect(
      sections(result, "section", "section_total", "balance").Asset,
    ).toEqual({
      total: 74000,
      accounts: [
        ["Bank", 2000],
        ["Sample Savings", 72000],
      ],
    });
  });

  it("spending breakdown lists each top account with its sub-accounts as categories, each entry once", () => {
    const result = expenseBreakdownReport(ledger(), auth, january);

    expect(breakdown(result)).toEqual({
      Rent: {
        total: 20000,
        categories: {
          Rent: { total: 20000, accounts: [["Rent", 20000]] },
        },
      },
      Food: {
        total: 6000,
        categories: {
          Groceries: { total: 3000, accounts: [["Groceries", 3000]] },
          Dining: {
            total: 2500,
            accounts: [
              ["Restaurants", 1500],
              ["Dining", 1000],
            ],
          },
          "Food, not in a sub-account": {
            total: 500,
            accounts: [["Food", 500]],
          },
        },
      },
    });
    expect(footer(result, "top_total")).toEqual([26000]);
  });

  it("spending breakdown shows one level below a single top account, such as Expenses", () => {
    const sqlite = ledger();
    sqlite.exec(`
      INSERT INTO accounts VALUES (20, 'workspace', 'user', 'Expenses', NULL, 'Expense');
      UPDATE accounts SET parent_id = 20 WHERE id IN (1, 5);
    `);
    const result = expenseBreakdownReport(sqlite, auth, january);

    expect(
      Object.entries(breakdown(result)).map(([name, top]) => [
        name,
        top.total,
        Object.entries(top.categories).map(([category, { total }]) => [
          category,
          total,
        ]),
      ]),
    ).toEqual([
      [
        "Expenses",
        26000,
        [
          ["Rent", 20000],
          ["Food", 6000],
        ],
      ],
    ]);
    const levels = gridDatasetSchema.parse(result).levels;
    expect(levels.top?.defaultCollapsed).toBeUndefined();
    expect(levels.category?.defaultCollapsed).toBe(true);
  });

  it("account ledger takes the account's whole branch", () => {
    const sqlite = ledger();
    const lines = loadAccountLedgerJournalEntries(sqlite, auth, {
      ...january,
      accountId: 3,
      accountIds: ledgerAccountIds(sqlite, auth, 3),
    });

    expect(lines.map((line) => line.entry_id)).toEqual([
      111, 112, 113, 114, 115, 116,
    ]);
  });

  describe("on a loop in parent_id", () => {
    function looped(): Database.Database {
      const sqlite = ledger();
      // Food (1) now sits under its own grandchild, restaurants (4).
      sqlite.exec("UPDATE accounts SET parent_id = 4 WHERE id = 1");
      return sqlite;
    }
    const loop = "parent_id loops through accounts 1 → 4 → 3 → 1";

    it("the account ledger throws, even for an account outside the loop", () => {
      expect(() => ledgerAccountIds(looped(), auth, 1)).toThrow(loop);
      expect(() => ledgerAccountIds(looped(), auth, 8)).toThrow(loop);
    });

    it("spending breakdown throws", () => {
      expect(() => expenseBreakdownReport(looped(), auth, january)).toThrow(
        loop,
      );
    });
  });
});

/*
 * Five levels, food (1) down to tips (5), with entries on food and
 * restaurants as well as their children, and none on dining (3). Travel (7)
 * has entries and a child without any. Snacks (10) sits under transport (9),
 * which has no entries of its own. Unused
 * (11) and its child have no entries at all. The bank (15) has entries of
 * its own under savings (16). Three categorised drafts on savings, two of
 * them on parent accounts, are never posted.
 */
function treeLedger(): Database.Database {
  const sqlite = new Database(":memory:");
  const stamp = "'2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z'";
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
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, narration TEXT NOT NULL,
      withdrawal REAL NOT NULL DEFAULT 0, deposit REAL NOT NULL DEFAULT 0,
      account_id INTEGER, base_account_id INTEGER, balance_assertion_base_account REAL,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Food', NULL, 'Expense'),
      (2, 'workspace', 'user', 'Groceries', 1, 'Expense'),
      (3, 'workspace', 'user', 'Dining', 1, 'Expense'),
      (4, 'workspace', 'user', 'Restaurants', 3, 'Expense'),
      (5, 'workspace', 'user', 'Tips', 4, 'Expense'),
      (6, 'workspace', 'user', 'Rent', NULL, 'Expense'),
      (7, 'workspace', 'user', 'Travel', NULL, 'Expense'),
      (8, 'workspace', 'user', 'Flights', 7, 'Expense'),
      (9, 'workspace', 'user', 'Transport', NULL, 'Expense'),
      (10, 'workspace', 'user', 'Snacks', 9, 'Expense'),
      (11, 'workspace', 'user', 'Unused', NULL, 'Expense'),
      (12, 'workspace', 'user', 'Sub', 11, 'Expense'),
      (13, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (14, 'workspace', 'user', 'Bonus', 13, 'Revenue'),
      (15, 'workspace', 'user', 'Bank', NULL, 'Asset'),
      (16, 'workspace', 'user', 'Sample Savings', 15, 'Asset');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-01', 'Salary'),
      (11, 'workspace', 'user', '2026-01-05', 'Spending'),
      (12, 'workspace', 'user', '2026-01-06', 'Cash to the bank');

    INSERT INTO journal_entries
      (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit)
    VALUES
      (101, 'workspace', 'user', 10, 16, 100000, 0),
      (102, 'workspace', 'user', 10, 13, 0, 90000),
      (103, 'workspace', 'user', 10, 14, 0, 10000),
      (111, 'workspace', 'user', 11, 1, 500, 0),
      (112, 'workspace', 'user', 11, 2, 3000, 0),
      (113, 'workspace', 'user', 11, 4, 1500, 0),
      (114, 'workspace', 'user', 11, 5, 50, 0),
      (115, 'workspace', 'user', 11, 6, 20000, 0),
      (116, 'workspace', 'user', 11, 7, 800, 0),
      (117, 'workspace', 'user', 11, 10, 200, 0),
      (118, 'workspace', 'user', 11, 16, 0, 26050),
      (121, 'workspace', 'user', 12, 15, 2000, 0),
      (122, 'workspace', 'user', 12, 16, 0, 2000);

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-01-20', 'NOPII sample grocer', 700, 0, 2, 16, NULL, NULL, 'k-201', ${stamp}),
      (202, 'workspace', 'user', '2026-01-20', 'NOPII sample cafe', 900, 0, 1, 16, NULL, NULL, 'k-202', ${stamp}),
      (203, 'workspace', 'user', '2026-01-20', 'NOPII sample employer', 0, 5000, 13, 16, NULL, NULL, 'k-203', ${stamp});
  `);
  return sqlite;
}

/** Each node as [name, own, total, children]. */
type Shape = [string, number, number, Shape[]];

function shape(accounts: IncomeExpensesAccount[]): Shape[] {
  return accounts.map((account) => [
    account.name,
    account.own,
    account.total,
    shape(account.children),
  ]);
}

/** The account ledger route, as the workspace's user sees it. */
function ledgerRoute(sqlite: Database.Database): TsRestApi<SapportaEnv> {
  const app = new TsRestApi<SapportaEnv>();
  app.use(async (c, next) => {
    c.set("sqlite", sqlite);
    c.set("auth", auth);
    await next();
  });
  app.route("/", accountLedgerApi);
  return app;
}

async function januaryLedger(
  sqlite: Database.Database,
  accountId: number,
): Promise<GridDataset> {
  const response = await ledgerRoute(sqlite).request(
    `/reports/account-ledger?account_id=${accountId}&from_date=2026-01-01&to_date=2026-01-31`,
  );
  expect(response.status).toBe(200);
  return gridDatasetSchema.parse(await response.json());
}

function closingRow(ledger: GridDataset): Record<string, unknown> {
  return ledger.nodes[0]?.childFooterRows?.entries?.[0]?.columns ?? {};
}

describe("reports over a deep account tree, with drafts filed on parents", () => {
  it("Income and Expenses counts each account's own entries once, at every depth, by parent_id", () => {
    const report = incomeExpensesSchema.parse(
      incomeExpensesReport(treeLedger(), auth, january),
    );

    expect(report.spending.total).toBe(26050);
    // Flights, Unused and Sub have nothing on or below them, so they don't appear.
    expect(shape(report.spending.accounts)).toEqual([
      ["Rent", 20000, 20000, []],
      [
        "Food",
        500,
        5050,
        [
          ["Groceries", 3000, 3000, []],
          [
            "Dining",
            0,
            1550,
            [["Restaurants", 1500, 1550, [["Tips", 50, 50, []]]]],
          ],
        ],
      ],
      ["Travel", 800, 800, []],
      ["Transport", 0, 200, [["Snacks", 200, 200, []]]],
    ]);
    expect(report.income.total).toBe(100000);
    expect(shape(report.income.accounts)).toEqual([
      ["Salary", 90000, 100000, [["Bonus", 10000, 10000, []]]],
    ]);
  });

  it("spending breakdown lists each account under its parent_id branch", () => {
    const result = expenseBreakdownReport(treeLedger(), auth, january);

    expect(breakdown(result)).toEqual({
      Rent: {
        total: 20000,
        categories: { Rent: { total: 20000, accounts: [["Rent", 20000]] } },
      },
      Food: {
        total: 5050,
        categories: {
          Groceries: { total: 3000, accounts: [["Groceries", 3000]] },
          Dining: {
            total: 1550,
            accounts: [
              ["Restaurants", 1500],
              ["Tips", 50],
            ],
          },
          "Food, not in a sub-account": {
            total: 500,
            accounts: [["Food", 500]],
          },
        },
      },
      Travel: {
        total: 800,
        categories: {
          Travel: { total: 800, accounts: [["Travel", 800]] },
        },
      },
      Transport: {
        total: 200,
        categories: {
          Snacks: { total: 200, accounts: [["Snacks", 200]] },
        },
      },
    });
    expect(footer(result, "top_total")).toEqual([26050]);
  });

  it("the income statement, monthly summary and balance sheet agree with Income and Expenses", () => {
    const sqlite = treeLedger();

    const statement = sections(
      incomeStatementReport(sqlite, auth, january),
      "section",
      "section_total",
      "balance",
    );
    expect(statement.Revenue?.total).toBe(100000);
    expect(statement.Expense).toEqual({
      total: 26050,
      accounts: [
        ["Food", 500],
        ["Groceries", 3000],
        ["Rent", 20000],
        ["Restaurants", 1500],
        ["Snacks", 200],
        ["Tips", 50],
        ["Travel", 800],
      ],
    });

    expect(
      monthlySummaryReport(sqlite, auth, january).nodes.map((node) => [
        node.columns.month,
        node.columns.income,
        node.columns.expenses,
      ]),
    ).toEqual([["2026-01-01", 100000, 26050]]);

    expect(
      sections(
        balanceSheetReport(sqlite, auth, { asOfDate: "2026-01-31" }),
        "section",
        "section_total",
        "balance",
      ).Asset,
    ).toEqual({
      total: 73950,
      accounts: [
        ["Bank", 2000],
        ["Sample Savings", 71950],
      ],
    });
  });

  it("the account ledger closes every spending account at its Income and Expenses total", async () => {
    const sqlite = treeLedger();
    const accounts = {
      food: 1,
      dining: 3,
      restaurants: 4,
      tips: 5,
      travel: 7,
      transport: 9,
      rent: 6,
    };

    const closing: Record<string, number> = {};
    for (const [name, accountId] of Object.entries(accounts)) {
      const row = closingRow(await januaryLedger(sqlite, accountId));
      closing[name] = Number(row.debit) - Number(row.credit);
    }

    expect(closing).toEqual({
      food: 5050,
      dining: 1550,
      restaurants: 1550,
      tips: 50,
      travel: 800,
      transport: 200,
      rent: 20000,
    });
  });

  it("the account ledger lists an account outside the branch among a journal's other accounts, whatever its name", async () => {
    const food = await januaryLedger(treeLedger(), 1);
    const spending = food.nodes[0]?.children?.entries?.find(
      (row) => row.columns.journal_id === 11,
    );

    expect(String(spending?.columns.accounts).split(", ")).toContain("Snacks");
  });

  it("the account ledger closes the bank at the balance sheet's assets", async () => {
    const bank = await januaryLedger(treeLedger(), 15);

    expect(closingRow(bank).balance).toBe(73950);
  });
});
