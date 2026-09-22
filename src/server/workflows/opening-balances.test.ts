import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { findFailingChecks } from "../modules/drafts/index.js";
import { lookupLastReconciled } from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  loadOpeningBalances,
  recordOpeningBalance,
} from "./opening-balances.js";

/*
 * Sample Savings (2, under Assets 1) has two drafts from its statement: 500 in
 * on 3 February and 200 out on 5 February, where the statement printed 1,300.
 * So it opened at 1,000, and with nothing in the books its check fails by
 * that. Sample Card (4, under Liabilities 3) has nothing yet, and Groceries
 * (5) is an expense. There is no Equity account.
 */
function books(extra = ""): Ledger {
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
      (3, 'workspace', 'user', 'Liabilities', NULL, 'Liability', '', ''),
      (4, 'workspace', 'user', 'Sample Card', 3, 'Liability', '', ''),
      (5, 'workspace', 'user', 'Groceries', NULL, 'Expense', '', '');
    INSERT INTO draft_transactions
      (id, workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit,
       account_id, base_account_id, balance_assertion_base_account, created_at, updated_at)
    VALUES
      (11, 'workspace', 'user', '2026-02-03', 'NOPII deposit', 0, 500, NULL, 2, NULL, '', ''),
      (12, 'workspace', 'user', '2026-02-05', 'NOPII groceries', 200, 0, 5, 2, 1300, '', '');
    ${extra}
  `);
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

function account(ledger: Ledger, accountId: number) {
  return loadOpeningBalances(ledger).accounts.find(
    (a) => a.accountId === accountId,
  );
}

function entries(ledger: Ledger, journalId: number) {
  return ledger.sqlite
    .prepare(
      `SELECT account_id, debit, credit, account_balance_assertion AS assertion, comment
       FROM journal_entries WHERE journal_id = ? ORDER BY id`,
    )
    .all(journalId);
}

describe("loadOpeningBalances", () => {
  it("lists assets and liabilities by path, with dates and a suggestion from the drafts", () => {
    const ledger = books();

    expect(loadOpeningBalances(ledger)).toEqual({
      equityAccount: null,
      accounts: [
        {
          accountId: 1,
          name: "Assets",
          path: "Assets",
          accountType: "Asset",
          firstActivityDate: null,
          defaultDate: null,
          suggestedAmount: null,
          opening: null,
        },
        {
          accountId: 2,
          name: "Sample Savings",
          path: "Assets:Sample Savings",
          accountType: "Asset",
          firstActivityDate: "2026-02-03",
          defaultDate: "2026-02-02",
          suggestedAmount: 1000,
          opening: null,
        },
        {
          accountId: 3,
          name: "Liabilities",
          path: "Liabilities",
          accountType: "Liability",
          firstActivityDate: null,
          defaultDate: null,
          suggestedAmount: null,
          opening: null,
        },
        {
          accountId: 4,
          name: "Sample Card",
          path: "Liabilities:Sample Card",
          accountType: "Liability",
          firstActivityDate: null,
          defaultDate: null,
          suggestedAmount: null,
          opening: null,
        },
      ],
    });
  });

  it("dates from the first posted entry and suggests nothing once something is posted", () => {
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (6, 'workspace', 'user', 'Sample Salary', NULL, 'Revenue', '', '');
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES (20, 'workspace', 'user', '2026-01-10', 'Deposits', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
      VALUES
        (201, 'workspace', 'user', 20, 2, 100, 0, '', ''),
        (202, 'workspace', 'user', 20, 6, 0, 100, '', '');
    `);

    expect(account(ledger, 2)).toMatchObject({
      firstActivityDate: "2026-01-10",
      defaultDate: "2026-01-09",
      suggestedAmount: null,
      opening: null,
    });
  });

  it("finds opening entries by their Equity line, one journal opening many accounts", () => {
    // The seed's shape: one journal opens both accounts against Equity, with
    // no assertion on the card. A transfer between them touches no Equity.
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (7, 'workspace', 'user', 'Sample Equity', NULL, 'Equity', '', '');
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES
        (30, 'workspace', 'user', '2026-01-15', 'Card payment', '', ''),
        (31, 'workspace', 'user', '2026-01-31', 'Opening balances', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit,
         account_balance_assertion, created_at, updated_at)
      VALUES
        (301, 'workspace', 'user', 30, 4, 100, 0, NULL, '', ''),
        (302, 'workspace', 'user', 30, 2, 0, 100, NULL, '', ''),
        (311, 'workspace', 'user', 31, 2, 1000, 0, 1000, '', ''),
        (312, 'workspace', 'user', 31, 4, 0, 2500, NULL, '', ''),
        (313, 'workspace', 'user', 31, 7, 1500, 0, NULL, '', '');
    `);

    expect(account(ledger, 2)?.opening).toEqual({
      account_id: 2,
      journal_id: 31,
      date: "2026-01-31",
      amount: 1000,
      description: "Opening balances",
    });
    expect(account(ledger, 4)?.opening).toEqual({
      account_id: 4,
      journal_id: 31,
      date: "2026-01-31",
      amount: -2500,
      description: "Opening balances",
    });
    expect(account(ledger, 1)?.opening).toBeNull();
    // Only an Equity account named Opening Balances is the default.
    expect(loadOpeningBalances(ledger).equityAccount).toBeNull();
  });
});

describe("recordOpeningBalance", () => {
  it("posts the entry with its assertion, creating Opening Balances, and the checks pass", () => {
    const ledger = books();
    expect(findFailingChecks(ledger.sqlite, ledger.auth)).toHaveLength(1);

    const outcome = recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
      description: "From the NOPII March statement",
    });

    expect(outcome).toMatchObject({
      kind: "recorded",
      accountName: "Sample Savings",
      equityAccountCreated: true,
      equityAccount: { name: "Opening Balances" },
    });
    if (outcome.kind !== "recorded") throw new Error("not recorded");
    const equityId = outcome.equityAccount.id;
    expect(entries(ledger, outcome.journalId)).toEqual([
      {
        account_id: 2,
        debit: 1000,
        credit: 0,
        assertion: 1000,
        comment: "Opening balance",
      },
      {
        account_id: equityId,
        debit: 0,
        credit: 1000,
        assertion: null,
        comment: "Opening balance",
      },
    ]);
    // No Equity root yet, so Opening Balances is one.
    expect(
      ledger.sqlite
        .prepare("SELECT parent_id, account_type FROM accounts WHERE id = ?")
        .get(equityId),
    ).toEqual({ parent_id: null, account_type: "Equity" });

    expect(findFailingChecks(ledger.sqlite, ledger.auth)).toEqual([]);
    expect(
      lookupLastReconciled(ledger.sqlite, ledger.auth, "Sample Savings"),
    ).toEqual({ date: "2026-02-02", balance: 1000 });
    expect(account(ledger, 2)).toMatchObject({
      suggestedAmount: null,
      opening: {
        journal_id: outcome.journalId,
        date: "2026-02-02",
        amount: 1000,
        description: "From the NOPII March statement",
      },
    });
    expect(loadOpeningBalances(ledger).equityAccount).toEqual(
      outcome.equityAccount,
    );
  });

  it("names the journal for the books when the user says nothing", () => {
    const ledger = books();

    const outcome = recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
      description: "   ",
    });

    if (outcome.kind !== "recorded") throw new Error("not recorded");
    expect(account(ledger, 2)?.opening?.description).toBe("Opening balance");
  });

  it("credits money owed, reusing Opening Balances", () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
    });

    const outcome = recordOpeningBalance(ledger, {
      accountId: 4,
      date: "2026-01-31",
      amount: -2500,
    });

    expect(outcome).toMatchObject({
      kind: "recorded",
      equityAccountCreated: false,
    });
    if (outcome.kind !== "recorded") throw new Error("not recorded");
    expect(entries(ledger, outcome.journalId)).toEqual([
      expect.objectContaining({
        account_id: 4,
        debit: 0,
        credit: 2500,
        assertion: -2500,
      }),
      expect.objectContaining({ debit: 2500, credit: 0, assertion: null }),
    ]);
  });

  it("creates Opening Balances under the one Equity root", () => {
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (7, 'workspace', 'user', 'Equity', NULL, 'Equity', '', '');
    `);

    const outcome = recordOpeningBalance(ledger, {
      accountId: 4,
      date: "2026-01-31",
      amount: 0,
    });

    if (outcome.kind !== "recorded") throw new Error("not recorded");
    expect(
      ledger.sqlite
        .prepare("SELECT parent_id FROM accounts WHERE id = ?")
        .get(outcome.equityAccount.id),
    ).toEqual({ parent_id: 7 });
  });

  it("refuses a second opening entry", () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
    });

    expect(
      recordOpeningBalance(ledger, {
        accountId: 2,
        date: "2026-01-01",
        amount: 2000,
      }),
    ).toMatchObject({
      kind: "already-recorded",
      opening: { date: "2026-02-02", amount: 1000 },
    });
  });

  it("refuses a date on or after the account's first activity, writing nothing", () => {
    const ledger = books();

    expect(
      recordOpeningBalance(ledger, {
        accountId: 2,
        date: "2026-02-03",
        amount: 1000,
      }),
    ).toEqual({
      kind: "date-not-before-first-activity",
      accountName: "Sample Savings",
      firstActivityDate: "2026-02-03",
    });
    expect(
      ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM journals").get(),
    ).toEqual({ n: 0 });
  });

  it("refuses an account that isn't an asset or liability, and one not in the books", () => {
    const ledger = books();

    expect(
      recordOpeningBalance(ledger, {
        accountId: 5,
        date: "2026-01-01",
        amount: 1000,
      }),
    ).toEqual({ kind: "not-asset-or-liability", accountName: "Groceries" });
    expect(
      recordOpeningBalance(ledger, {
        accountId: 99,
        date: "2026-01-01",
        amount: 1000,
      }),
    ).toEqual({ kind: "account-not-found" });
  });

  it("refuses when Opening Balances exists but isn't Equity", () => {
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (7, 'workspace', 'user', 'Opening Balances', NULL, 'Revenue', '', '');
    `);

    expect(
      recordOpeningBalance(ledger, {
        accountId: 4,
        date: "2026-01-01",
        amount: -1000,
      }),
    ).toEqual({ kind: "opening-balances-not-equity" });
  });
});
