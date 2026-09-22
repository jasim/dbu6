import Database from "better-sqlite3";
import { gridDatasetSchema } from "@sapporta/shared/grid-dataset";
import { describe, expect, it } from "vitest";
import {
  ledgerAccountIds,
  loadAccountLedgerJournalEntries,
  toAccountLedgerResult,
} from "./account-ledger.js";
import { readOnlyLedger } from "../../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

describe("Account Ledger journal entry query", () => {
  it("loads every scoped line for journals matched through a descendant account", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        name TEXT,
        parent_id INTEGER
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
        account_balance_assertion REAL,
        comment TEXT
      );
      CREATE TABLE draft_transactions (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT
      );

      INSERT INTO accounts VALUES
        (1, 'workspace', 'user', 'Assets', NULL),
        (2, 'workspace', 'user', 'Bank', 1),
        (3, 'workspace', 'user', 'Groceries', NULL),
        (4, 'workspace', 'other-user', 'Other user account', NULL);

      INSERT INTO journals VALUES
        (10, 'workspace', 'user', '2026-01-10', 'Matched descendant'),
        (11, 'workspace', 'user', '2026-01-12', 'Unrelated account'),
        (12, 'workspace', 'user', '2025-12-31', 'Outside date range'),
        (13, 'workspace', 'other-user', '2026-01-15', 'Other user journal');

      INSERT INTO journal_entries VALUES
        (101, 'workspace', 'user', 10, 2, 100, 0, 900, 'Bank line'),
        (102, 'workspace', 'user', 10, 3, 0, 100, NULL, 'Counterpart line'),
        (103, 'workspace', 'other-user', 10, 4, 50, 0, NULL, 'Hidden line'),
        (104, 'workspace', 'user', 11, 3, 25, 0, NULL, 'Unrelated line'),
        (105, 'workspace', 'user', 12, 2, 40, 0, NULL, 'Old line'),
        (106, 'workspace', 'other-user', 13, 4, 75, 0, NULL, 'Other user line');
    `);

    const auth = testLedgerAuth();
    const rows = loadAccountLedgerJournalEntries(readOnlyLedger(sqlite, auth), {
      accountId: 1,
      accountIds: ledgerAccountIds(readOnlyLedger(sqlite, auth), 1),
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(rows).toEqual([
      {
        entry_id: 101,
        journal_id: 10,
        account_id: 2,
        account_name: "Bank",
        debit: 100,
        credit: 0,
        assertion: 900,
        comment: "Bank line",
      },
      {
        entry_id: 102,
        journal_id: 10,
        account_id: 3,
        account_name: "Groceries",
        debit: 0,
        credit: 100,
        assertion: null,
        comment: "Counterpart line",
      },
    ]);
  });
});

describe("Account Ledger result", () => {
  it("lists the journals as its rows, their entries nested in order, under the account's name", () => {
    const result = toAccountLedgerResult(
      {
        id: 1,
        name: "Bank",
        opening_balance: 50,
      },
      [
        {
          journal_id: 10,
          date: "2026-01-10",
          description: "Deposit",
          accounts: "Income",
          debit: 20,
          credit: 0,
        },
        {
          journal_id: 11,
          date: "2026-01-12",
          description: "Fee",
          accounts: "Bank Fees",
          debit: 0,
          credit: 5,
        },
      ],
      [
        {
          entry_id: 102,
          journal_id: 10,
          account_id: 3,
          account_name: "Income",
          debit: 0,
          credit: 20,
          assertion: null,
          comment: null,
        },
        {
          entry_id: 101,
          journal_id: 10,
          account_id: 1,
          account_name: "Bank",
          debit: 20,
          credit: 0,
          assertion: 70,
          comment: "Matched line",
        },
        {
          entry_id: 201,
          journal_id: 11,
          account_id: 1,
          account_name: "Bank",
          debit: 0,
          credit: 5,
          assertion: null,
          comment: "Monthly fee",
        },
      ],
      "2026-01-01",
    );

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.label).toBe("Account Ledger: Bank");
    expect(result.rootLevel).toBe("entries");
    expect(result.levels.entries).toMatchObject({
      childLevels: ["journal_entries"],
      defaultCollapsed: true,
    });
    expect(
      result.levels.journal_entries?.columns.map((column) => column.id),
    ).toEqual([
      "entry_id",
      "account_id",
      "account_name",
      "debit",
      "credit",
      "assertion",
      "comment",
    ]);

    const ledgerRows = result.nodes;
    expect(ledgerRows.map((row) => row.rowKey)).toEqual([
      "opening:2026-01-01",
      "journal:10",
      "journal:11",
    ]);
    expect(ledgerRows[0]?.kind).toBe("opening");
    expect(ledgerRows[0]?.children).toBeUndefined();
    expect(ledgerRows[1]?.columns.balance).toBe(70);
    expect(ledgerRows[2]?.columns.balance).toBe(65);

    const firstJournalEntries = ledgerRows[1]?.children?.journal_entries ?? [];
    expect(firstJournalEntries.map((row) => row.rowKey)).toEqual([
      "entry:101",
      "entry:102",
    ]);
    expect(firstJournalEntries.map((row) => row.columns)).toEqual([
      {
        entry_id: 101,
        journal_id: 10,
        account_id: 1,
        account_name: "Bank",
        debit: 20,
        credit: 0,
        assertion: 70,
        comment: "Matched line",
      },
      {
        entry_id: 102,
        journal_id: 10,
        account_id: 3,
        account_name: "Income",
        debit: 0,
        credit: 20,
        assertion: null,
        comment: null,
      },
    ]);

    // The opening balance counts toward the closing balance but not toward
    // the period's debit and credit totals.
    expect(result.footerRows?.map((row) => row.columns)).toEqual([
      { description: "Closing balance", debit: 20, credit: 5, balance: 65 },
    ]);
  });

  it("is empty for an account out of scope", () => {
    const result = toAccountLedgerResult(null, [], [], null);

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.label).toBe("Account Ledger");
    expect(result.nodes).toEqual([]);
    expect(result.footerRows).toBeUndefined();
  });
});
