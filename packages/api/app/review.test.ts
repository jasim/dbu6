import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { listReviewAccounts, loadReviewAccount } from "./review.js";

const scope = { workspaceId: "workspace", userId: "user" };

/*
 * Sample Savings (2) has a balance assertion of 1,500 on 10 Feb and three
 * drafts: a pair repeating one source key, whose second balance misses by 40,
 * and an uncategorised one. Sample Card (1) has one categorised draft. Sample
 * Loan (4) is a Liability with no preset. Cash (6) has no drafts.
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
      comment TEXT, source_reference TEXT, source_transaction_key TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, narration TEXT,
      withdrawal REAL, deposit REAL, account_id INTEGER, base_account_id INTEGER,
      balance_assertion_base_account REAL, source_reference TEXT, source_transaction_key TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'liabilities:credit-cards:sample-card', NULL, 'Liability'),
      (2, 'workspace', 'user', 'assets:bank:sample-savings', NULL, 'Asset'),
      (3, 'workspace', 'user', 'expenses:groceries', NULL, 'Expense'),
      (4, 'workspace', 'user', 'liabilities:loans:sample-loan', NULL, 'Liability'),
      (5, 'workspace', 'other-user', 'assets:bank:other-050505', NULL, 'Asset'),
      (6, 'workspace', 'user', 'assets:cash', NULL, 'Asset');

    INSERT INTO journals VALUES (10, 'workspace', 'user', '2026-02-10', 'Opening');
    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 2, 1500, 0, 1500, NULL, NULL, NULL),
      (102, 'workspace', 'user', 10, 3, 0, 1500, NULL, NULL, NULL, NULL);

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, 1460, NULL, 'k-201'),
      (202, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, 1460, NULL, 'k-201'),
      (203, 'workspace', 'user', '2026-03-13', 'NOPII shop', 60, 0, NULL, 2, NULL, NULL, 'k-203'),
      (204, 'workspace', 'user', '2026-03-04', 'NOPII card shop', 25, 0, 3, 1, NULL, NULL, 'k-204'),
      (205, 'workspace', 'user', '2026-03-05', 'NOPII loan', 10, 0, 3, 4, NULL, NULL, 'k-205'),
      (206, 'workspace', 'other-user', '2026-03-05', 'NOPII other', 10, 0, NULL, 5, NULL, NULL, 'k-206');
  `);
  return sqlite;
}

const presets = [
  {
    name: "Sample Savings",
    base_account: "assets:bank:sample-savings",
    custom_mappings_filenames: [],
  },
  {
    name: "Sample Card",
    base_account: "liabilities:credit-cards:sample-card",
    custom_mappings_filenames: [],
    is_credit_card: true,
  },
];

describe("listReviewAccounts", () => {
  it("lists only the accounts with drafts, named from presets or their path, by name", () => {
    expect(listReviewAccounts(ledger(), scope, presets)).toEqual([
      {
        account_id: 1,
        path: "liabilities:credit-cards:sample-card",
        name: "Sample Card",
        kind: "card",
        drafts: 1,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
        draft_span: { first_date: "2026-03-04", last_date: "2026-03-04" },
      },
      {
        account_id: 4,
        path: "liabilities:loans:sample-loan",
        name: "Sample loan",
        kind: "card",
        drafts: 1,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
        draft_span: { first_date: "2026-03-05", last_date: "2026-03-05" },
      },
      {
        account_id: 2,
        path: "assets:bank:sample-savings",
        name: "Sample Savings",
        kind: "bank",
        drafts: 3,
        uncategorised: 1,
        duplicates: 1,
        balance_checks: 2,
        failing_checks: 1,
        draft_span: { first_date: "2026-03-02", last_date: "2026-03-13" },
      },
    ]);
  });
});

describe("loadReviewAccount", () => {
  it("says what blocks one account's drafts and which other accounts have drafts", () => {
    const detail = loadReviewAccount(ledger(), scope, presets, 2);

    expect(detail).toMatchObject({
      account: {
        account_id: 2,
        name: "Sample Savings",
        drafts: 3,
        balance_checks: 2,
      },
      checkpoint: { date: "2026-02-10", balance: 1500 },
      closing: { date: "2026-03-02", balance: 1460 },
      failing: [
        {
          date: "2026-03-02",
          draft_id: 202,
          running_balance: 1420,
          assertion: 1460,
          diff: -40,
        },
      ],
      other_accounts: [
        { account_id: 1, name: "Sample Card", drafts: 1 },
        { account_id: 4, name: "Sample loan", drafts: 1 },
      ],
    });
    expect(detail?.duplicates).toEqual([
      {
        date: "2026-03-02",
        draft_id: 201,
        other_draft_id: 202,
        matched_journal_id: null,
        matched_journal_entry_id: null,
        match_kind: "draft-draft",
        match_type: "source-key",
        confidence: 1,
        direction: "withdrawal",
        amount: 40,
        narration: "NOPII grocer",
        other_narration: "NOPII grocer",
        draft_category: "expenses:groceries",
        matched_category: "expenses:groceries",
      },
    ]);
  });

  it("answers for an account whose drafts are all in the books", () => {
    const detail = loadReviewAccount(ledger(), scope, presets, 6);

    expect(detail).toEqual({
      account: {
        account_id: 6,
        path: "assets:cash",
        name: "Cash",
        kind: "bank",
        drafts: 0,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
        draft_span: null,
      },
      checkpoint: null,
      closing: null,
      failing: [],
      duplicates: [],
      other_accounts: [
        { account_id: 1, name: "Sample Card", drafts: 1 },
        { account_id: 4, name: "Sample loan", drafts: 1 },
        { account_id: 2, name: "Sample Savings", drafts: 3 },
      ],
    });
  });

  it("finds nothing for an unknown account or another user's", () => {
    expect(loadReviewAccount(ledger(), scope, presets, 99)).toBeNull();
    expect(loadReviewAccount(ledger(), scope, presets, 5)).toBeNull();
  });
});
