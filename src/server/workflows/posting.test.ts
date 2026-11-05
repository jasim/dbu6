import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import type { PostingBlock } from "../../shared/index.js";
import { loadDraftStatus } from "../modules/drafts/index.js";
import type { PlannedJournal } from "../modules/journal-plan/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { countPostedAssertionFailures } from "../modules/reconciliation/index.js";
import {
  decidePress,
  postingOrder,
  postPress,
  reliesOnAlone,
} from "./posting.js";

const auth = testLedgerAuth();
const STAMP = "'2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'";

const NAMES = new Map([
  [1, "Sample Bank"],
  [2, "Sample Savings"],
  [3, "Sample Wallet"],
  [4, "Sample Other Bank"],
  [8, "Groceries"],
  [9, "Salary"],
]);

/*
 * Four statement accounts' drafts, each copy of a transfer already removed
 * from one side, so each transfer is one draft categorized to the other
 * account:
 *
 * - Sample Bank (1) gets 1,000 salary, sends 100 to Sample Savings on 2 Mar,
 *   and spends 10 on 4 Mar, by when Savings has sent it 50: 940.
 * - Sample Savings (2) sends Bank 50 on 3 Mar, which with Bank's 100 leaves
 *   50, and 20 to Sample Wallet on 5 Mar.
 * - Sample Wallet (3) spends 5 of Savings' 20 on 6 Mar: 15.
 * - Sample Other Bank (4) gets 300 salary and relies on no one.
 *
 * So Bank and Savings rely on each other, Wallet on Savings, and Other Bank
 * on nothing.
 */
function ledger() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, name TEXT NOT NULL, parent_id INTEGER,
      account_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE draft_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, source_narration TEXT NOT NULL,
      withdrawal REAL NOT NULL DEFAULT 0, deposit REAL NOT NULL DEFAULT 0,
      account_id INTEGER, base_account_id INTEGER, balance_assertion_base_account REAL,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, comment TEXT
    );
    CREATE TABLE journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, journal_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL, debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0, account_balance_assertion REAL, comment TEXT,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source_narration TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Bank', NULL, 'Asset', ${STAMP}),
      (2, 'workspace', 'user', 'Sample Savings', NULL, 'Asset', ${STAMP}),
      (3, 'workspace', 'user', 'Sample Wallet', NULL, 'Asset', ${STAMP}),
      (4, 'workspace', 'user', 'Sample Other Bank', NULL, 'Asset', ${STAMP}),
      (8, 'workspace', 'user', 'Groceries', NULL, 'Expense', ${STAMP}),
      (9, 'workspace', 'user', 'Salary', NULL, 'Revenue', ${STAMP});

    INSERT INTO draft_transactions VALUES
      (101, 'workspace', 'user', '2026-03-01', 'NOPII salary', 0, 1000, 9, 1, 1000, NULL, 'k-101', ${STAMP}, NULL),
      (102, 'workspace', 'user', '2026-03-02', 'NOPII to savings', 100, 0, 2, 1, 900, NULL, 'k-102', ${STAMP}, NULL),
      (103, 'workspace', 'user', '2026-03-04', 'NOPII grocer', 10, 0, 8, 1, 940, NULL, 'k-103', ${STAMP}, NULL),
      (201, 'workspace', 'user', '2026-03-03', 'NOPII to bank', 50, 0, 1, 2, 50, NULL, 'k-201', ${STAMP}, NULL),
      (202, 'workspace', 'user', '2026-03-05', 'NOPII to wallet', 20, 0, 3, 2, NULL, NULL, 'k-202', ${STAMP}, NULL),
      (301, 'workspace', 'user', '2026-03-06', 'NOPII shop', 5, 0, 8, 3, 15, NULL, 'k-301', ${STAMP}, NULL),
      (401, 'workspace', 'user', '2026-03-01', 'NOPII salary', 0, 300, 9, 4, 300, NULL, 'k-401', ${STAMP}, NULL);
  `);
  const press = (ids: number[]) =>
    decidePress(sqlite, auth, ids, loadDraftStatus(sqlite, auth), NAMES);
  return { sqlite, ledger: { db: drizzle(sqlite), sqlite, auth }, press };
}

const reliesOn = (...ids: number[]): PostingBlock => ({
  kind: "balance-checks",
  state: "blocks",
  severity: "problem",
  count: 1,
  relies_on: ids.map((id) => ({ account_id: id, name: NAMES.get(id)! })),
});

describe("decidePress", () => {
  it("adds an account that relies on no other", () => {
    expect(ledger().press([4])).toEqual({ adds: [4], left: new Map() });
  });

  it("adds two accounts that rely on each other together, and neither alone", () => {
    const { press } = ledger();
    expect(press([2, 1])).toEqual({ adds: [2, 1], left: new Map() });
    expect(press([1])).toEqual({
      adds: [],
      left: new Map([[1, reliesOn(2)]]),
    });
    expect(press([2])).toEqual({
      adds: [],
      left: new Map([[2, reliesOn(1)]]),
    });
  });

  it("adds a chain together, and drops what relies on an account left out", () => {
    const { press } = ledger();
    expect(press([3, 2, 1, 4])).toEqual({
      adds: [3, 2, 1, 4],
      left: new Map(),
    });
    // Savings drops for want of Bank, and then Wallet for want of Savings.
    expect(press([3, 2, 4])).toEqual({
      adds: [4],
      left: new Map([
        [2, reliesOn(1)],
        [3, reliesOn(2)],
      ]),
    });
  });

  it("drops an account that relies on one that isn't ready", () => {
    const { sqlite, press } = ledger();
    sqlite.exec(
      `UPDATE draft_transactions SET account_id = NULL WHERE id = 103`,
    );
    expect(press([1, 2, 3, 4])).toEqual({
      adds: [4],
      left: new Map([
        [
          1,
          {
            kind: "categorization",
            state: "blocks",
            severity: "attention",
            count: 1,
            on_own_account: 0,
          },
        ],
        [2, reliesOn(1)],
        [3, reliesOn(2)],
      ]),
    });
  });

  it("leaves out an account with a draft on its own statement's account", () => {
    const { sqlite, press } = ledger();
    sqlite.exec(`UPDATE draft_transactions SET account_id = 4 WHERE id = 401`);
    expect(press([4])).toEqual({
      adds: [],
      left: new Map([
        [
          4,
          {
            kind: "categorization",
            state: "blocks",
            severity: "attention",
            count: 1,
            on_own_account: 1,
          },
        ],
      ]),
    });
  });

  it("leaves out an account with no drafts, and one with a failing check names no one", () => {
    const { sqlite, press } = ledger();
    sqlite.exec(`
      DELETE FROM draft_transactions WHERE base_account_id = 3;
      UPDATE draft_transactions SET balance_assertion_base_account = 299 WHERE id = 401;
    `);
    expect(press([3, 4])).toEqual({
      adds: [],
      left: new Map([[4, { ...reliesOn(), relies_on: [] }]]),
    });
  });
});

describe("reliesOnAlone", () => {
  it("names, for each account clear of its own blocks, the accounts its own Add would wait on", () => {
    const { sqlite } = ledger();
    expect(
      reliesOnAlone(sqlite, auth, loadDraftStatus(sqlite, auth), NAMES),
    ).toEqual(
      new Map([
        [1, [{ account_id: 2, name: "Sample Savings" }]],
        [2, [{ account_id: 1, name: "Sample Bank" }]],
        [3, [{ account_id: 2, name: "Sample Savings" }]],
      ]),
    );
  });
});

describe("postPress", () => {
  it("posts accounts that rely on each other in one go, their balance assertions holding in the books", () => {
    const { sqlite, ledger: books } = ledger();
    expect(postPress(books, [3, 2, 1], NAMES)).toMatchObject({
      kind: "done",
      posted: [
        { accountId: 3, draftsPosted: 1 },
        { accountId: 2, draftsPosted: 2 },
        { accountId: 1, draftsPosted: 3 },
      ],
      left: [],
      journalsCreated: 6,
    });
    expect(countPostedAssertionFailures(sqlite, auth)).toEqual(new Map());
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM draft_transactions`).get(),
    ).toEqual({ n: 1 });
  });

  it("posts nothing when nothing can go in", () => {
    const { sqlite, ledger: books } = ledger();
    expect(postPress(books, [1], NAMES)).toMatchObject({
      kind: "done",
      posted: [],
      left: [{ accountId: 1, block: reliesOn(2) }],
      journalsCreated: 0,
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM journals`).get()).toEqual({
      n: 0,
    });
  });

  it("posts nothing of an account with a draft on its own statement's account, and the rest", () => {
    // Its balance check passes on the statement's side alone, but posting it
    // would write both lines on Other Bank, netting to nothing.
    const { sqlite, ledger: books } = ledger();
    sqlite.exec(`UPDATE draft_transactions SET account_id = 4 WHERE id = 401`);
    expect(postPress(books, [3, 2, 1, 4], NAMES)).toMatchObject({
      kind: "done",
      posted: [{ accountId: 3 }, { accountId: 2 }, { accountId: 1 }],
      left: [
        {
          accountId: 4,
          block: { kind: "categorization", count: 1, on_own_account: 1 },
        },
      ],
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM journal_entries WHERE account_id = 4`,
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT id FROM draft_transactions`).all()).toEqual([
      { id: 401 },
    ]);
  });

  it("adds nothing when no order of the journals holds the books' balance checks", () => {
    // Bank and Savings each end 1 Mar on a transfer to the other, and each
    // statement's balance counts the other's: any order of the two journals
    // leaves the first one's balance missing the second.
    const { sqlite, ledger: books } = ledger();
    sqlite.exec(`
      DELETE FROM draft_transactions;
      INSERT INTO draft_transactions VALUES
        (500, 'workspace', 'user', '2026-02-28', 'NOPII salary', 0, 1000, 9, 1, 1000, NULL, 'k-500', ${STAMP}, NULL),
        (600, 'workspace', 'user', '2026-02-28', 'NOPII salary', 0, 1000, 9, 2, 1000, NULL, 'k-600', ${STAMP}, NULL),
        (501, 'workspace', 'user', '2026-03-01', 'NOPII to savings', 100, 0, 2, 1, 950, NULL, 'k-501', ${STAMP}, NULL),
        (601, 'workspace', 'user', '2026-03-01', 'NOPII to bank', 50, 0, 1, 2, 1050, NULL, 'k-601', ${STAMP}, NULL);
    `);
    expect(postPress(books, [1, 2], NAMES)).toEqual({
      kind: "breaks-posted-checks",
      broken: [{ accountId: 1, name: "Sample Bank", failures: 1 }],
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM journals`).get()).toEqual({
      n: 0,
    });
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM draft_transactions`).get(),
    ).toEqual({ n: 4 });
  });

  it("refuses accounts it can't find", () => {
    expect(postPress(ledger().ledger, [1, 99], NAMES)).toEqual({
      kind: "accounts-not-found",
      accountIds: [99],
    });
  });
});

describe("postingOrder", () => {
  const journal = (
    date: string,
    base: number,
    to: number,
    assertion: number | null,
  ): PlannedJournal<number> => ({
    date,
    description: `NOPII ${base} to ${to}`,
    entries: [
      {
        account: to,
        amount: 10,
        assertion: null,
        comment: null,
        sourceNarration: null,
        sourceReference: null,
        sourceTransactionKey: null,
      },
      {
        account: base,
        amount: -10,
        assertion,
        comment: null,
        sourceNarration: null,
        sourceReference: null,
        sourceTransactionKey: null,
      },
    ],
  });

  it("puts the others' journals to an account ahead of its first asserting journal that day, and keeps each account's order", () => {
    const a1 = journal("2026-03-01", 1, 8, null);
    const a2 = journal("2026-03-01", 1, 8, 100);
    const a3 = journal("2026-03-02", 1, 8, 90);
    const b1 = journal("2026-03-01", 2, 1, 50);
    expect(
      postingOrder([
        { accountId: 1, plan: [a1, a2, a3] },
        { accountId: 2, plan: [b1] },
      ]),
    ).toEqual([a1, b1, a2, a3]);
  });

  it("puts the first account's journal first when two accounts' asserting journals each wait for the other", () => {
    const a = journal("2026-03-01", 1, 2, 100);
    const b = journal("2026-03-01", 2, 1, 50);
    expect(
      postingOrder([
        { accountId: 1, plan: [a] },
        { accountId: 2, plan: [b] },
      ]),
    ).toEqual([a, b]);
  });
});
