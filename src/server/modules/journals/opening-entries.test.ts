import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { testLedgerAuth } from "../ledger-sql/testing.js";
import { packageDir } from "../../paths.js";
import {
  deleteOpeningEntry,
  loadEntriesBesideOpening,
  loadOpeningEntries,
  rewriteOpeningEntry,
} from "./opening-entries.js";

/*
 * Sample Savings (2) is opened alone by journal 20 on 31 January, against
 * Opening Balances (7), and has a deposit from Sample Salary (6) on
 * 10 February. Sample Card (4) and Sample Wallet (3) are opened together by
 * journal 30, so theirs is shared. Sample Wallet also has a draft, which is
 * not posted.
 */
function books() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '', ''),
      (2, 'workspace', 'user', 'Sample Savings', 1, 'Asset', '', ''),
      (3, 'workspace', 'user', 'Sample Wallet', 1, 'Asset', '', ''),
      (4, 'workspace', 'user', 'Sample Card', NULL, 'Liability', '', ''),
      (6, 'workspace', 'user', 'Sample Salary', NULL, 'Revenue', '', ''),
      (7, 'workspace', 'user', 'Opening Balances', NULL, 'Equity', '', '');
    INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
    VALUES
      (20, 'workspace', 'user', '2026-01-31', 'Opening balance', '', ''),
      (21, 'workspace', 'user', '2026-02-10', 'NOPII salary', '', ''),
      (30, 'workspace', 'user', '2026-01-15', 'Opening balances', '', '');
    INSERT INTO journal_entries
      (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit,
       account_balance_assertion, comment, created_at, updated_at)
    VALUES
      (201, 'workspace', 'user', 20, 2, 1000, 0, 1000, 'Opening balance', '', ''),
      (202, 'workspace', 'user', 20, 7, 0, 1000, NULL, 'Opening balance', '', ''),
      (211, 'workspace', 'user', 21, 2, 500, 0, NULL, NULL, '', ''),
      (212, 'workspace', 'user', 21, 6, 0, 500, NULL, NULL, '', ''),
      (301, 'workspace', 'user', 30, 3, 200, 0, 200, NULL, '', ''),
      (302, 'workspace', 'user', 30, 4, 0, 2500, -2500, NULL, '', ''),
      (303, 'workspace', 'user', 30, 7, 2300, 0, NULL, NULL, '', '');
    INSERT INTO draft_transactions
      (id, workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit,
       base_account_id, created_at, updated_at)
    VALUES (41, 'workspace', 'user', '2026-01-20', 'NOPII draft', 50, 0, 3, '', '');
  `);
  return { db, sqlite, auth: testLedgerAuth() };
}

function lines(sqlite: Database.Database, journalId: number) {
  return sqlite
    .prepare(
      `SELECT id, account_id, debit, credit, account_balance_assertion AS assertion
       FROM journal_entries WHERE journal_id = ? ORDER BY id`,
    )
    .all(journalId);
}

describe("loadOpeningEntries", () => {
  it("marks a journal of the account's line and one Equity line standalone", () => {
    const { sqlite, auth } = books();
    const openings = loadOpeningEntries(sqlite, auth);

    expect(openings.get(2)).toEqual({
      account_id: 2,
      journal_id: 20,
      date: "2026-01-31",
      amount: 1000,
      description: "Opening balance",
      standalone: true,
      onOpeningBalances: true,
    });
    expect(openings.get(3)).toMatchObject({
      journal_id: 30,
      amount: 200,
      standalone: false,
    });
    expect(openings.get(4)).toMatchObject({
      journal_id: 30,
      amount: -2500,
      standalone: false,
    });
    expect([
      ...loadOpeningEntries(sqlite, auth, { accountId: 4 }).keys(),
    ]).toEqual([4]);
  });
});

describe("loadEntriesBesideOpening", () => {
  it("counts posted entries outside the opening journal, and no drafts", () => {
    const { sqlite, auth } = books();

    expect(loadEntriesBesideOpening(sqlite, auth)).toEqual(
      new Map([
        [2, { entries: 1, first_date: "2026-02-10" }],
        // No opening entry of its own, so all of its entries count.
        [6, { entries: 1, first_date: "2026-02-10" }],
        [7, { entries: 2, first_date: "2026-01-15" }],
      ]),
    );
  });
});

describe("rewriteOpeningEntry", () => {
  it("rewrites the journal and both lines in place, keeping their ids", () => {
    const { db, sqlite, auth } = books();
    const opening = loadOpeningEntries(sqlite, auth).get(2)!;

    db.transaction((tx: any) =>
      rewriteOpeningEntry(tx, auth, opening, {
        date: "2026-01-20",
        amount: -300,
        description: "From the NOPII statement",
      }),
    );

    expect(
      sqlite
        .prepare("SELECT date, description FROM journals WHERE id = 20")
        .get(),
    ).toEqual({ date: "2026-01-20", description: "From the NOPII statement" });
    expect(lines(sqlite, 20)).toEqual([
      { id: 201, account_id: 2, debit: 0, credit: 300, assertion: -300 },
      { id: 202, account_id: 7, debit: 300, credit: 0, assertion: null },
    ]);
    expect(loadOpeningEntries(sqlite, auth).get(2)).toMatchObject({
      journal_id: 20,
      date: "2026-01-20",
      amount: -300,
      standalone: true,
    });
  });

  it("won't rewrite a journal that opens other accounts too", () => {
    const { db, sqlite, auth } = books();
    const shared = loadOpeningEntries(sqlite, auth).get(4)!;

    expect(() =>
      db.transaction((tx: any) =>
        rewriteOpeningEntry(tx, auth, shared, {
          date: "2026-01-15",
          amount: -3000,
          description: "Opening balances",
        }),
      ),
    ).toThrow(/opens more than/);
    expect(lines(sqlite, 30)).toHaveLength(3);
  });
});

describe("deleteOpeningEntry", () => {
  it("deletes the lines and then the journal, under foreign keys", () => {
    const { db, sqlite, auth } = books();
    const opening = loadOpeningEntries(sqlite, auth).get(2)!;

    db.transaction((tx: any) => deleteOpeningEntry(tx, auth, opening));

    expect(lines(sqlite, 20)).toEqual([]);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM journals WHERE id = 20").get(),
    ).toEqual({ n: 0 });
    expect(loadOpeningEntries(sqlite, auth).has(2)).toBe(false);
    // The Equity account and everything else stay.
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id = 7").get(),
    ).toEqual({ n: 1 });
    expect(lines(sqlite, 21)).toHaveLength(2);
  });
});
