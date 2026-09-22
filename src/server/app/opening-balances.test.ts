import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  listOpeningBalances,
  recordOpeningBalanceResponse,
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
    ).toMatchObject({ status: 422, body: { code: "already_recorded" } });
  });
});
