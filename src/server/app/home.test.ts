import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadHomeSummary } from "./home.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";

const auth = testLedgerAuth();

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
      comment TEXT, source_reference TEXT, source_transaction_key TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, narration TEXT,
      withdrawal REAL, deposit REAL, account_id INTEGER, base_account_id INTEGER,
      balance_assertion_base_account REAL, source_reference TEXT, source_transaction_key TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Card', NULL, 'Liability'),
      (2, 'workspace', 'user', 'Sample Savings', NULL, 'Asset'),
      (3, 'workspace', 'user', 'Groceries', NULL, 'Expense'),
      (4, 'workspace', 'user', 'No Preset Bank', NULL, 'Asset'),
      (5, 'workspace', 'other-user', 'Sample Savings', NULL, 'Asset'),
      (6, 'workspace', 'user', 'Sample Loan', NULL, 'Liability');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-10', 'Opening'),
      (11, 'workspace', 'user', '2026-02-10', 'Latest savings assertion'),
      (12, 'workspace', 'user', '2026-02-20', 'Card assertion');

    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 2, 1000, 0, 1000, NULL, NULL, NULL),
      (102, 'workspace', 'user', 10, 3, 0, 1000, NULL, NULL, NULL, NULL),
      (103, 'workspace', 'user', 11, 2, 500, 0, 1500, NULL, NULL, NULL),
      (104, 'workspace', 'user', 11, 3, 0, 500, NULL, NULL, NULL, NULL),
      (105, 'workspace', 'user', 12, 1, 0, 300, 300, NULL, NULL, NULL),
      (106, 'workspace', 'user', 12, 3, 300, 0, NULL, NULL, NULL, NULL);
  `);
  return sqlite;
}

const presets = [
  {
    name: "Sample Savings Statement",
    base_account: "Sample Savings",
    custom_mappings_filenames: [],
  },
  {
    name: "Sample Card Statement",
    base_account: "Sample Card",
    custom_mappings_filenames: [],
    is_credit_card: true,
  },
  {
    name: "Not Yet Added",
    base_account: "Missing Bank 050505",
    custom_mappings_filenames: [],
  },
];

describe("Home summary", () => {
  it("lists the preset accounts, oldest balance assertion first, with their draft counts and problems", () => {
    const sqlite = ledger();
    sqlite.exec(`
      INSERT INTO draft_transactions VALUES
        (201, 'workspace', 'user', '2026-03-01', 'NOPII salary', 0, 100, NULL, 2, 999, NULL, 'k-201'),
        (202, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, NULL, NULL, 'k-202'),
        (203, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, NULL, NULL, 'k-202'),
        (204, 'workspace', 'user', '2026-03-03', 'NOPII no preset', 5, 0, NULL, 4, NULL, NULL, 'k-204'),
        (205, 'workspace', 'other-user', '2026-03-03', 'NOPII other', 5, 0, NULL, 2, NULL, NULL, 'k-205');
    `);

    const summary = loadHomeSummary(sqlite, auth, presets);

    // The account the ledger lacks has no assertion, so it leads; then
    // Sample Savings (10 Feb) before Sample Card (20 Feb). The card's books
    // come to -300 where its statement says 300, so it doesn't match.
    expect(summary.accounts).toEqual([
      {
        in_ledger: false,
        path: "Missing Bank 050505",
        name: "Not Yet Added",
        kind: "bank",
      },
      {
        in_ledger: true,
        account_id: 2,
        path: "Sample Savings",
        name: "Sample Savings Statement",
        kind: "bank",
        checkpoint: { date: "2026-02-10", balance: 1500 },
        statement_differences: 0,
        drafts: 3,
        uncategorised: 1,
        duplicates: 1,
        balance_checks: 1,
        failing_checks: 1,
      },
      {
        in_ledger: true,
        account_id: 1,
        path: "Sample Card",
        name: "Sample Card Statement",
        kind: "card",
        checkpoint: { date: "2026-02-20", balance: 300 },
        statement_differences: 1,
        drafts: 0,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
      },
    ]);
    // Drafts on the account no preset names still count towards the totals.
    expect(summary.totals).toEqual({
      drafts: 4,
      uncategorised: 2,
      duplicates: 1,
      balance_checks: 1,
      failing_checks: 1,
    });
    expect(summary.has_journals).toBe(true);
  });

  it("names and kinds an account the way Review does", () => {
    // A loan preset that doesn't say it is a card: the ledger's Liability
    // type decides, on Home as on Review.
    const summary = loadHomeSummary(ledger(), auth, [
      {
        name: "Sample Loan Statement",
        base_account: "Sample Loan",
        custom_mappings_filenames: [],
      },
    ]);

    expect(summary.accounts).toMatchObject([
      {
        in_ledger: true,
        name: "Sample Loan Statement",
        kind: "card",
        checkpoint: null,
      },
    ]);
  });

  it("reports nothing imported when the preset accounts have no entries", () => {
    const sqlite = ledger();
    sqlite.exec(`DELETE FROM journal_entries; DELETE FROM journals;`);

    const summary = loadHomeSummary(sqlite, auth, presets.slice(0, 2));

    expect(summary.has_journals).toBe(false);
    expect(summary.totals.drafts).toBe(0);
    expect(
      summary.accounts.map((a) => [a.name, a.in_ledger && a.checkpoint]),
    ).toEqual([
      ["Sample Card Statement", null],
      ["Sample Savings Statement", null],
    ]);
  });

  it("returns no accounts without presets", () => {
    const summary = loadHomeSummary(ledger(), auth, []);
    expect(summary.accounts).toEqual([]);
    expect(summary.has_journals).toBe(false);
  });
});
