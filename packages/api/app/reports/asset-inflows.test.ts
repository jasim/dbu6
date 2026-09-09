import Database from "better-sqlite3";
import { gridDatasetSchema } from "@sapporta/shared/grid-dataset";
import { describe, expect, it } from "vitest";
import {
  loadAssetInflows,
  toAssetInflowsResult,
  type AssetInflowRow,
} from "./asset-inflows.js";

describe("Asset inflows query", () => {
  it("excludes asset-to-asset movements while retaining separate revenue gains", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        name TEXT,
        parent_id INTEGER,
        account_type TEXT
      );
      CREATE TABLE journals (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        date TEXT,
        description TEXT
      );
      CREATE TABLE journal_entries (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        journal_id INTEGER,
        account_id INTEGER,
        debit REAL,
        credit REAL,
        comment TEXT
      );
      CREATE TABLE draft_transactions (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT
      );

      INSERT INTO accounts VALUES
        (1, 'workspace', 'user', 'assets:bank', NULL, 'Asset'),
        (2, 'workspace', 'user', 'assets:fixed-deposit', NULL, 'Asset'),
        (3, 'workspace', 'user', 'income:salary', NULL, 'Revenue'),
        (4, 'workspace', 'user', 'expenses:reimbursement', NULL, 'Expense'),
        (5, 'workspace', 'other-user', 'assets:hidden', NULL, 'Asset'),
        (6, 'other-workspace', 'user', 'assets:other-workspace', NULL, 'Asset'),
        (7, 'workspace', 'user', 'income:investment-gains', NULL, 'Revenue');

      INSERT INTO journals VALUES
        (10, 'workspace', 'user', '2026-01-10', 'Salary deposit'),
        (11, 'workspace', 'user', '2026-01-12', 'Expense offset'),
        (12, 'workspace', 'user', '2026-01-14', 'Fixed deposit redemption'),
        (13, 'workspace', 'user', '2026-01-15', 'Separate investment gain'),
        (14, 'workspace', 'user', '2025-12-31', 'Before period'),
        (15, 'workspace', 'other-user', '2026-01-16', 'Other user'),
        (16, 'other-workspace', 'user', '2026-01-17', 'Other workspace');

      INSERT INTO journal_entries VALUES
        (101, 'workspace', 'user', 10, 1, 100, 0, 'Bank line'),
        (102, 'workspace', 'user', 10, 3, 0, 100, NULL),
        (103, 'workspace', 'user', 11, 2, 40, 0, 'Deposit line'),
        (104, 'workspace', 'user', 11, 4, 0, 25, NULL),
        (105, 'workspace', 'user', 11, 3, 0, 15, NULL),
        (106, 'workspace', 'user', 12, 1, 105, 0, 'Redemption receipt'),
        (107, 'workspace', 'user', 12, 2, 0, 100, NULL),
        (108, 'workspace', 'user', 12, 7, 0, 5, NULL),
        (109, 'workspace', 'user', 13, 1, 5, 0, 'Gain receipt'),
        (110, 'workspace', 'user', 13, 7, 0, 5, NULL),
        (111, 'workspace', 'user', 14, 1, 30, 0, NULL),
        (112, 'workspace', 'user', 14, 3, 0, 30, NULL),
        (113, 'workspace', 'other-user', 15, 5, 50, 0, NULL),
        (114, 'workspace', 'other-user', 15, 3, 0, 50, NULL),
        (115, 'other-workspace', 'user', 16, 6, 60, 0, NULL),
        (116, 'other-workspace', 'user', 16, 3, 0, 60, NULL);
    `);

    const rows = loadAssetInflows(sqlite, {
      workspaceId: "workspace",
      userId: "user",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(rows).toEqual([
      {
        entry_id: 101,
        journal_id: 10,
        account_id: 1,
        date: "2026-01-10",
        asset_account: "assets:bank",
        source_accounts: "income:salary",
        description: "Salary deposit",
        comment: "Bank line",
        amount: 100,
      },
      {
        entry_id: 103,
        journal_id: 11,
        account_id: 2,
        date: "2026-01-12",
        asset_account: "assets:fixed-deposit",
        source_accounts: "expenses:reimbursement, income:salary",
        description: "Expense offset",
        comment: "Deposit line",
        amount: 40,
      },
      {
        entry_id: 109,
        journal_id: 13,
        account_id: 1,
        date: "2026-01-15",
        asset_account: "assets:bank",
        source_accounts: "income:investment-gains",
        description: "Separate investment gain",
        comment: "Gain receipt",
        amount: 5,
      },
    ]);
  });
});

describe("Asset inflows result", () => {
  it("returns a valid record-level dataset with stable hidden identities", () => {
    const rows: AssetInflowRow[] = [
      {
        entry_id: 101,
        journal_id: 10,
        account_id: 1,
        date: "2026-01-10",
        asset_account: "assets:bank",
        source_accounts: "income:salary",
        description: "Salary deposit",
        comment: "Bank line",
        amount: 100,
      },
    ];

    const result = toAssetInflowsResult(rows);

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      name: "asset-inflows",
      label: "All In-flows to asset accounts",
      rootLevel: "inflow",
    });
    expect(result.levels.inflow?.columns.slice(0, 3)).toEqual([
      expect.objectContaining({ id: "entry_id", visuallyHidden: true }),
      expect.objectContaining({ id: "journal_id", visuallyHidden: true }),
      expect.objectContaining({ id: "account_id", visuallyHidden: true }),
    ]);
    expect(result.nodes).toEqual([
      {
        rowKey: "entry:101",
        levelName: "inflow",
        columns: rows[0],
      },
    ]);
  });

  it("returns an empty valid dataset when no entries match", () => {
    const result = toAssetInflowsResult([]);

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.nodes).toEqual([]);
  });
});
