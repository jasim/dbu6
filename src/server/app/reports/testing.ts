import Database from "better-sqlite3";
import { applyMigrations } from "@sapporta/server";
import {
  readOnlyLedger,
  type ReportLedger,
} from "../../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";
import { dbu6MigrationsDir } from "../../paths.js";
import type { AccountType } from "../../schema/accounts.js";

/** An empty set of books in memory, for a report's test to fill and read. */
export interface TestLedger {
  /** The database, with dbu6's schema: insert the accounts and journals here. */
  sqlite: Database.Database;
  /** What the report's function takes: `owner`'s rows, read-only. */
  ledger: ReportLedger;
  /**
   * The two columns every ledger row carries. A row inserted without these
   * values belongs to someone else, and `ledger` does not see it.
   */
  owner: { workspace_id: string; scoped_to_user_id: string };
  /** Adds one of `owner`'s accounts and returns its id. */
  addAccount(account: {
    name: string;
    account_type: AccountType;
    parent_id?: number;
  }): number;
  /** Adds one of `owner`'s journals with its entries and returns its id. */
  addJournal(journal: {
    date: string;
    description: string;
    entries: {
      account_id: number;
      debit?: number;
      credit?: number;
      comment?: string;
    }[];
  }): number;
}

/**
 * dbu6's schema in an in-memory database, migrated by this version's
 * migrations, and a `ReportLedger` over one user's rows of it. Nothing on
 * disk is opened.
 */
export function openTestLedger(): TestLedger {
  const sqlite = new Database(":memory:");
  applyMigrations(sqlite, dbu6MigrationsDir());
  const owner = { workspace_id: "workspace", scoped_to_user_id: "user" };
  const auth = testLedgerAuth(owner.scoped_to_user_id, owner.workspace_id);
  const stamp = {
    ...owner,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };

  const insertAccount = sqlite.prepare(
    `INSERT INTO accounts
       (workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
     VALUES (@workspace_id, @scoped_to_user_id, @name, @parent_id, @account_type, @created_at, @updated_at)`,
  );
  const insertJournal = sqlite.prepare(
    `INSERT INTO journals
       (workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
     VALUES (@workspace_id, @scoped_to_user_id, @date, @description, @created_at, @updated_at)`,
  );
  const insertEntry = sqlite.prepare(
    `INSERT INTO journal_entries
       (workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, comment, created_at, updated_at)
     VALUES (@workspace_id, @scoped_to_user_id, @journal_id, @account_id, @debit, @credit, @comment, @created_at, @updated_at)`,
  );

  return {
    sqlite,
    ledger: readOnlyLedger(sqlite, auth),
    owner,
    addAccount: ({ name, account_type, parent_id = undefined }) =>
      Number(
        insertAccount.run({
          ...stamp,
          name,
          account_type,
          parent_id: parent_id ?? null,
        }).lastInsertRowid,
      ),
    addJournal: ({ date, description, entries }) => {
      const journal_id = Number(
        insertJournal.run({ ...stamp, date, description }).lastInsertRowid,
      );
      for (const { account_id, debit = 0, credit = 0, comment } of entries) {
        insertEntry.run({
          ...stamp,
          journal_id,
          account_id,
          debit,
          credit,
          comment: comment ?? null,
        });
      }
      return journal_id;
    },
  };
}
