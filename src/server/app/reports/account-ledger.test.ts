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
        comment: "Bank line",
      },
      {
        entry_id: 102,
        journal_id: 10,
        account_id: 3,
        account_name: "Groceries",
        debit: 0,
        credit: 100,
        comment: "Counterpart line",
      },
    ]);
  });
});

describe("Account Ledger result", () => {
  const line = (
    entry_id: number,
    journal_id: number,
    [account_id, account_name]: [number, string],
    debit: number,
    credit: number,
    comment: string | null,
  ) => ({
    entry_id,
    journal_id,
    account_id,
    account_name,
    debit,
    credit,
    comment,
  });
  const bank: [number, string] = [1, "Bank"];
  const income: [number, string] = [3, "Income"];
  const food: [number, string] = [4, "Food"];
  const fuel: [number, string] = [5, "Fuel"];
  const loan: [number, string] = [6, "Loan"];
  const interest: [number, string] = [7, "Interest"];

  const journals = [
    // A statement row, as the importer writes one now.
    {
      journal_id: 10,
      date: "2026-01-10",
      description: "NOPII sample employer",
    },
    // A day's statement rows, as the importer grouped them before.
    { journal_id: 11, date: "2026-01-12", description: "Expenses" },
    // A compound entry: one bank payment, two expenses, each with a memo.
    { journal_id: 12, date: "2026-01-15", description: "Loan instalment" },
  ];
  const lines = [
    line(101, 10, bank, 2000, 0, null),
    line(102, 10, income, 0, 2000, "NOPII sample employer"),
    line(111, 11, food, 100, 0, "UPI-sample-grocer-050505"),
    line(112, 11, fuel, 50, 0, "UPI-sample-fuel-050505"),
    line(113, 11, bank, 0, 150, null),
    line(121, 12, loan, 800, 0, "Principal"),
    line(122, 12, interest, 200, 0, "Interest"),
    line(123, 12, bank, 0, 1000, null),
  ];

  it("gives each line on the account a row against the other side, under the account's name", () => {
    const result = toAccountLedgerResult(
      { id: 1, name: "Bank", opening_balance: 50 },
      [1],
      journals,
      lines,
      "2026-01-01",
    );

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.label).toBe("Account Ledger: Bank");
    expect(result.rootLevel).toBe("entries");
    // Against before the narration; the journal a link away, not nested.
    const entries = result.levels.entries;
    expect(
      entries?.columns
        .filter((column) => !column.visuallyHidden)
        .map((column) => column.id),
    ).toEqual(["date", "against", "narration", "debit", "credit", "balance"]);
    expect(entries?.childLevels).toEqual([]);
    expect(entries?.rowLinks?.map((link) => link.label)).toEqual([
      "Open journal",
      "Open journal entry",
    ]);

    const rows = result.nodes;
    expect(rows[0]).toMatchObject({
      rowKey: "opening:2026-01-01",
      kind: "opening",
    });
    expect(rows[0]?.children).toBeUndefined();
    expect(
      rows.slice(1).map(({ rowKey, columns }) => ({
        rowKey,
        narration: columns.narration,
        against: columns.against,
        against_account_id: columns.against_account_id,
        debit: columns.debit,
        credit: columns.credit,
        balance: columns.balance,
      })),
    ).toEqual([
      // One line against one: the statement row's narration, from the
      // counterparty's line.
      {
        rowKey: "entry:101",
        narration: "NOPII sample employer",
        against: "Income",
        against_account_id: 3,
        debit: 2000,
        credit: 0,
        balance: 2050,
      },
      // The grouped day comes apart into its statement rows.
      {
        rowKey: "entry:113:111",
        narration: "UPI-sample-grocer-050505",
        against: "Food",
        against_account_id: 4,
        debit: 0,
        credit: 100,
        balance: 1950,
      },
      {
        rowKey: "entry:113:112",
        narration: "UPI-sample-fuel-050505",
        against: "Fuel",
        against_account_id: 5,
        debit: 0,
        credit: 50,
        balance: 1900,
      },
      // The compound entry stays one payment, against both accounts.
      {
        rowKey: "entry:123",
        narration: "Loan instalment",
        against: "Loan, Interest",
        against_account_id: null,
        debit: 0,
        credit: 1000,
        balance: 900,
      },
    ]);

    expect(rows.some((row) => row.children)).toBe(false);

    // The opening balance counts toward the closing balance but not toward
    // the period's debit and credit totals.
    expect(result.footerRows?.map((row) => row.columns)).toEqual([
      {
        against: "Closing balance",
        debit: 2000,
        credit: 1150,
        balance: 900,
      },
    ]);
  });

  it("puts a line that shares its side against the one line opposite, in its own words", () => {
    const result = toAccountLedgerResult(
      { id: 4, name: "Food", opening_balance: 0 },
      [4],
      [journals[1]],
      lines.filter((entry) => entry.journal_id === 11),
      null,
    );

    expect(result.nodes.map((row) => row.columns)).toEqual([
      {
        journal_id: 11,
        date: "2026-01-12",
        entry_id: 111,
        narration: "UPI-sample-grocer-050505",
        against: "Bank",
        against_account_id: 1,
        debit: 100,
        credit: 0,
        balance: 100,
      },
    ]);
  });

  it("gives each of the account's lines its own row when a journal moves money inside it", () => {
    const transfer = [
      line(131, 13, [2, "Savings"], 500, 0, null),
      line(132, 13, bank, 0, 500, null),
    ];
    const result = toAccountLedgerResult(
      { id: 8, name: "Assets", opening_balance: 0 },
      [8, 1, 2],
      [{ journal_id: 13, date: "2026-01-20", description: "NOPII transfer" }],
      transfer,
      null,
    );

    expect(
      result.nodes.map(({ columns }) => [
        columns.against,
        columns.debit,
        columns.credit,
        columns.balance,
      ]),
    ).toEqual([
      ["Bank", 500, 0, 500],
      ["Savings", 0, 500, 0],
    ]);
  });

  it("is empty for an account out of scope", () => {
    const result = toAccountLedgerResult(null, [], [], [], null);

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.label).toBe("Account Ledger");
    expect(result.nodes).toEqual([]);
    expect(result.footerRows).toBeUndefined();
  });
});
