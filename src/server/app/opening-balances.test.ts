import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  changeOpeningBalanceResponse,
  listOpeningBalances,
  recordOpeningBalanceResponse,
  removeOpeningBalanceResponse,
} from "./opening-balances.js";

/* Sample Savings (1) has one draft on 3 February; Groceries (2) is an expense. */
function books(): Ledger {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Sample Savings', NULL, 'Asset', '', ''),
      (2, 'workspace', 'user', 'Groceries', NULL, 'Expense', '', '');
    INSERT INTO draft_transactions
      (id, workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit,
       base_account_id, balance_assertion_base_account, created_at, updated_at)
    VALUES (11, 'workspace', 'user', '2026-02-03', 'NOPII deposit', 0, 500, 1, 1500, '', '');
  `);
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

describe("opening balances routes", () => {
  it("lists the accounts in the contract's terms", () => {
    expect(listOpeningBalances(books())).toEqual({
      equity_account: null,
      accounts: [
        {
          account_id: 1,
          name: "Sample Savings",
          path: "Sample Savings",
          account_type: "Asset",
          section: "own",
          first_activity_date: "2026-02-03",
          default_date: "2026-02-02",
          suggested_amount: 1000,
          opening: null,
        },
      ],
    });
  });

  it("answers 201 with the journal, then lists it as recorded", () => {
    const ledger = books();

    const response = recordOpeningBalanceResponse(ledger, {
      accountId: 1,
      date: "2026-02-02",
      amount: 1000,
    });

    expect(response).toEqual({
      status: 201,
      body: {
        journal_id: expect.any(Number),
        equity_account: { id: 3, name: "Opening Balances" },
        equity_account_created: true,
      },
    });
    expect(listOpeningBalances(ledger).accounts[0].opening).toEqual({
      journal_id: (response.body as { journal_id: number }).journal_id,
      date: "2026-02-02",
      amount: 1000,
      description: "Opening balance",
      locked: null,
    });
  });

  it("answers the refusals with 404 and 422 codes", () => {
    const ledger = books();

    expect(
      recordOpeningBalanceResponse(ledger, {
        accountId: 9,
        date: "2026-02-02",
        amount: 1000,
      }),
    ).toMatchObject({ status: 404 });
    expect(
      recordOpeningBalanceResponse(ledger, {
        accountId: 2,
        date: "2026-02-02",
        amount: 1000,
      }),
    ).toMatchObject({ status: 422, body: { code: "not_asset_or_liability" } });
    expect(
      recordOpeningBalanceResponse(ledger, {
        accountId: 1,
        date: "2026-02-10",
        amount: 1000,
      }),
    ).toMatchObject({
      status: 422,
      body: {
        code: "date_not_before_first_activity",
        first_activity_date: "2026-02-03",
      },
    });
    recordOpeningBalanceResponse(ledger, {
      accountId: 1,
      date: "2026-02-02",
      amount: 1000,
    });
    expect(
      recordOpeningBalanceResponse(ledger, {
        accountId: 1,
        date: "2026-02-01",
        amount: 1000,
      }),
    ).toMatchObject({
      status: 422,
      body: {
        code: "already_recorded",
        error:
          "Sample Savings already has an opening balance, from 2026-02-02.",
      },
    });
  });
});

// Records Sample Savings' opening entry, answering its journal's id.
function recorded(ledger: Ledger): number {
  const response = recordOpeningBalanceResponse(ledger, {
    accountId: 1,
    date: "2026-02-02",
    amount: 1000,
  });
  return (response.body as { journal_id: number }).journal_id;
}

describe("changing and removing an opening balance", () => {
  it("answers 200 with the same journal on a change", () => {
    const ledger = books();
    const journalId = recorded(ledger);

    expect(
      changeOpeningBalanceResponse(ledger, {
        accountId: 1,
        date: "2026-02-01",
        amount: 1200,
      }),
    ).toEqual({ status: 200, body: { journal_id: journalId } });
    expect(listOpeningBalances(ledger).accounts[0].opening).toMatchObject({
      journal_id: journalId,
      date: "2026-02-01",
      amount: 1200,
    });
  });

  it("answers 200 with the removed journal, then 404 as there is none", () => {
    const ledger = books();
    const journalId = recorded(ledger);

    expect(removeOpeningBalanceResponse(ledger, 1)).toEqual({
      status: 200,
      body: { removed_journal_id: journalId },
    });
    expect(listOpeningBalances(ledger).accounts[0].opening).toBeNull();
    expect(removeOpeningBalanceResponse(ledger, 1)).toEqual({
      status: 404,
      body: {
        code: "not_recorded",
        error: "Sample Savings has no opening balance to remove.",
      },
    });
  });

  it("answers the refusals with 404, 409 and 422 codes", () => {
    const ledger = books();
    const change = (accountId: number, date = "2026-02-01") =>
      changeOpeningBalanceResponse(ledger, { accountId, date, amount: 5 });

    expect(change(9)).toEqual({
      status: 404,
      body: {
        code: "account_not_found",
        error: "That account isn't in your books any more.",
      },
    });
    expect(change(2)).toEqual({
      status: 422,
      body: {
        code: "not_asset_or_liability",
        error:
          "Groceries isn't an asset or a liability, so it takes no opening balance.",
      },
    });
    expect(change(1)).toEqual({
      status: 404,
      body: {
        code: "not_recorded",
        error: "Sample Savings has no opening balance to change.",
      },
    });
    recorded(ledger);
    expect(change(1, "2026-02-03")).toEqual({
      status: 422,
      body: {
        code: "date_not_before_first_activity",
        error:
          "Pick a day before 2026-02-03, Sample Savings's first transaction.",
        first_activity_date: "2026-02-03",
      },
    });
    expect(removeOpeningBalanceResponse(ledger, 9)).toMatchObject({
      status: 404,
      body: { code: "account_not_found" },
    });
    expect(removeOpeningBalanceResponse(ledger, 2)).toMatchObject({
      status: 404,
      body: { code: "not_asset_or_liability" },
    });
  });

  it("answers 409 with the journal once the account has other entries", () => {
    const ledger = books();
    const journalId = recorded(ledger);
    ledger.sqlite.exec(`
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES (40, 'workspace', 'user', '2026-02-10', 'NOPII groceries', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
      VALUES
        (401, 'workspace', 'user', 40, 2, 100, 0, '', ''),
        (402, 'workspace', 'user', 40, 1, 0, 100, '', '');
    `);
    const refusal = {
      status: 409,
      body: {
        code: "account_has_entries",
        error:
          "Sample Savings has other transactions. Change its opening balance in its journal entry.",
        journal_id: journalId,
      },
    };

    expect(
      changeOpeningBalanceResponse(ledger, {
        accountId: 1,
        date: "2026-02-01",
        amount: 5,
      }),
    ).toEqual(refusal);
    expect(removeOpeningBalanceResponse(ledger, 1)).toEqual(refusal);
    expect(listOpeningBalances(ledger).accounts[0].opening?.locked).toBe(
      "has_entries",
    );
  });

  it("answers 409 for a journal that opens other accounts too", () => {
    const ledger = books();
    ledger.sqlite.exec(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES
        (3, 'workspace', 'user', 'Sample Card', NULL, 'Liability', '', ''),
        (4, 'workspace', 'user', 'Opening Balances', NULL, 'Equity', '', '');
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES (31, 'workspace', 'user', '2026-01-31', 'Opening balances', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
      VALUES
        (311, 'workspace', 'user', 31, 1, 1000, 0, '', ''),
        (312, 'workspace', 'user', 31, 3, 0, 2500, '', ''),
        (313, 'workspace', 'user', 31, 4, 1500, 0, '', '');
    `);

    expect(removeOpeningBalanceResponse(ledger, 3)).toEqual({
      status: 409,
      body: {
        code: "opening_entry_shared",
        error:
          "Sample Card's opening balance shares a journal entry with other accounts. Change it there.",
        journal_id: 31,
      },
    });
  });
});
