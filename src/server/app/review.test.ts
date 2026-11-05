import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { listReviewAccounts, loadReviewAccount } from "./review.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";

const auth = testLedgerAuth();

/*
 * Sample Savings (2) has a balance assertion of 1,500 on 10 Feb and three
 * drafts: a pair repeating one source key, whose second balance misses by 40,
 * and an uncategorised one. Sample Card (1) has one categorised draft. Sample
 * Loan (4) is a Liability with no preset. Cash (6) has no drafts. Sample
 * Savings sits under Assets (7). Its uncategorised draft is in a rule request
 * waiting for the coding agent; another user's account has one too.
 */
function ledger(): Ledger {
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
      comment TEXT, source_reference TEXT, source_transaction_key TEXT, source_narration TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, source_narration TEXT,
      withdrawal REAL, deposit REAL, account_id INTEGER, base_account_id INTEGER,
      balance_assertion_base_account REAL, source_reference TEXT, source_transaction_key TEXT, comment TEXT
    );
    CREATE TABLE import_presets (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT,
      parsers TEXT, accounts TEXT, updated_at TEXT
    );
    CREATE TABLE categorization_rule_requests (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, base_account_id INTEGER,
      account_id INTEGER, transactions TEXT, note TEXT, created_at TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Card', NULL, 'Liability'),
      (2, 'workspace', 'user', 'Sample Savings', 7, 'Asset'),
      (3, 'workspace', 'user', 'Groceries', NULL, 'Expense'),
      (4, 'workspace', 'user', 'Sample Loan', NULL, 'Liability'),
      (5, 'workspace', 'other-user', 'Other Bank 050505', NULL, 'Asset'),
      (6, 'workspace', 'user', 'Cash', NULL, 'Asset'),
      (7, 'workspace', 'user', 'Assets', NULL, 'Asset');

    INSERT INTO journals VALUES (10, 'workspace', 'user', '2026-02-10', 'Opening');
    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 2, 1500, 0, 1500, NULL, NULL, NULL, NULL),
      (102, 'workspace', 'user', 10, 3, 0, 1500, NULL, NULL, NULL, NULL, NULL);

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, 1460, NULL, 'k-201', NULL),
      (202, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, 1460, NULL, 'k-201', NULL),
      (203, 'workspace', 'user', '2026-03-13', 'NOPII shop', 60, 0, NULL, 2, NULL, NULL, 'k-203', NULL),
      (204, 'workspace', 'user', '2026-03-04', 'NOPII card shop', 25, 0, 3, 1, NULL, NULL, 'k-204', NULL),
      (205, 'workspace', 'user', '2026-03-05', 'NOPII loan', 10, 0, 3, 4, NULL, NULL, 'k-205', NULL),
      (206, 'workspace', 'other-user', '2026-03-05', 'NOPII other', 10, 0, NULL, 5, NULL, NULL, 'k-206', NULL);

    INSERT INTO categorization_rule_requests VALUES
      (301, 'workspace', 'user', 2, 3,
        '[{"date":"2026-03-13","source_narration":"NOPII shop","direction":"withdrawal","amount":60}]',
        '', '2026-03-14T00:00:00Z'),
      (302, 'workspace', 'other-user', 5, 3,
        '[{"date":"2026-03-05","source_narration":"NOPII other","direction":"withdrawal","amount":10}]',
        '', '2026-03-14T00:00:00Z');
  `);
  return { db: drizzle(sqlite), sqlite, auth };
}

const account = (id: number, name: string, isCreditCard = false) => ({
  account_id: id,
  name,
  is_credit_card: isCreditCard,
  account_identifiers: [],
  custom_mappings_filenames: [],
});

const presets = [
  {
    id: 1,
    name: "Sample Bank",
    parsers: ["sample-bank-xls"],
    accounts: [account(2, "Sample Savings Statement")],
  },
  {
    id: 2,
    name: "Sample Cards",
    parsers: ["sample-cc-xls"],
    accounts: [account(1, "Sample Card Statement", true)],
  },
];

describe("listReviewAccounts", () => {
  it("lists only the accounts with drafts, named from presets or their own name, by name, with their rule requests", () => {
    expect(listReviewAccounts(ledger(), presets).accounts).toEqual([
      {
        account_id: 1,
        path: "Sample Card",
        parent_path: null,
        name: "Sample Card Statement",
        kind: "card",
        drafts: 1,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
        relies_on: [],
        draft_span: { first_date: "2026-03-04", last_date: "2026-03-04" },
        rule_requests: 0,
      },
      {
        account_id: 4,
        path: "Sample Loan",
        parent_path: null,
        name: "Sample Loan",
        kind: "card",
        drafts: 1,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
        relies_on: [],
        draft_span: { first_date: "2026-03-05", last_date: "2026-03-05" },
        rule_requests: 0,
      },
      {
        account_id: 2,
        path: "Sample Savings",
        parent_path: "Assets",
        name: "Sample Savings Statement",
        kind: "bank",
        drafts: 3,
        uncategorised: 1,
        duplicates: 1,
        balance_checks: 2,
        failing_checks: 1,
        relies_on: [],
        draft_span: { first_date: "2026-03-02", last_date: "2026-03-13" },
        rule_requests: 1,
      },
    ]);
  });
});

describe("loadReviewAccount", () => {
  it("says what blocks one account's drafts and which other accounts have drafts", () => {
    const detail = loadReviewAccount(ledger(), presets, 2);

    expect(detail).toMatchObject({
      account: {
        account_id: 2,
        parent_path: "Assets",
        name: "Sample Savings Statement",
        drafts: 3,
        balance_checks: 2,
        rule_requests: 1,
      },
      checkpoint: { date: "2026-02-10", balance: 1500 },
      // Journal 10 opens it against Groceries, not Equity.
      has_opening_entry: false,
      no_starting_balance: [{ account_id: 2, name: "Sample Savings" }],
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
        { account_id: 1, name: "Sample Card Statement", drafts: 1 },
        { account_id: 4, name: "Sample Loan", drafts: 1 },
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
        draft_account: "Groceries",
        matched_account: "Groceries",
      },
    ]);
  });

  it("answers for an account whose drafts are all in the books", () => {
    const detail = loadReviewAccount(ledger(), presets, 6);

    expect(detail).toEqual({
      account: {
        account_id: 6,
        path: "Cash",
        parent_path: null,
        name: "Cash",
        kind: "bank",
        drafts: 0,
        uncategorised: 0,
        duplicates: 0,
        balance_checks: 0,
        failing_checks: 0,
        relies_on: [],
        draft_span: null,
        rule_requests: 0,
      },
      checkpoint: null,
      has_opening_entry: false,
      no_starting_balance: [{ account_id: 6, name: "Cash" }],
      closing: null,
      failing: [],
      duplicates: [],
      other_accounts: [
        { account_id: 1, name: "Sample Card Statement", drafts: 1 },
        { account_id: 4, name: "Sample Loan", drafts: 1 },
        { account_id: 2, name: "Sample Savings Statement", drafts: 3 },
      ],
    });
  });

  it("finds nothing for an unknown account or another user's", () => {
    expect(loadReviewAccount(ledger(), presets, 99)).toBeNull();
    expect(loadReviewAccount(ledger(), presets, 5)).toBeNull();
  });
});
