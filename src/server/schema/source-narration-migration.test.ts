import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyNextMigration } from "../migrate-safely.js";
import {
  FIRST_LEDGER_MIGRATION,
  migrateUpTo,
  seedBooksAtFirstLedgerSchema,
} from "../migrations.test.support.js";
import { dbu6MigrationsDir } from "../paths.js";

/*
 * Migration 0012_source_narration: a draft's narration becomes its source
 * narration, every entry's comment moves to its source narration, and a
 * lesson's copied drafts name their text the same way.
 */
function booksBefore0012(): Database.Database {
  const sqlite = new Database(":memory:");
  migrateUpTo(sqlite, FIRST_LEDGER_MIGRATION);
  seedBooksAtFirstLedgerSchema(sqlite);
  migrateUpTo(sqlite, "0011_categorization_lesson_transactions");
  const scope = `'workspace-sample', 'user-sample'`;
  sqlite.exec(`
    UPDATE journal_entries SET comment = 'UPI-sample-payee-050505' WHERE id = 3;
    UPDATE journal_entries SET comment = 'sample note typed by hand' WHERE id = 5;
    UPDATE journal_entries SET comment = '   ' WHERE id = 6;
    INSERT INTO categorization_lessons
      (workspace_id, scoped_to_user_id, base_account_id, account_id, transactions, note, created_at)
    VALUES (${scope}, 2, 4,
      '[{"date":"2026-01-08","narration":"UPI-sample-payee-050505","direction":"withdrawal","amount":500}]',
      '', '2026-01-10T00:00:00Z');
  `);
  return sqlite;
}

describe("migration 0012_source_narration", () => {
  it("moves every entry's comment to its source narration and leaves the comment null", () => {
    const sqlite = booksBefore0012();
    expect(applyNextMigration(sqlite, dbu6MigrationsDir())).toBe(
      "0012_source_narration",
    );

    expect(
      sqlite
        .prepare(
          "SELECT id, comment, source_narration FROM journal_entries ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: 1, comment: null, source_narration: null },
      { id: 2, comment: null, source_narration: null },
      { id: 3, comment: null, source_narration: "UPI-sample-payee-050505" },
      { id: 4, comment: null, source_narration: null },
      // A typed note moves too: imported and typed can't be told apart.
      { id: 5, comment: null, source_narration: "sample note typed by hand" },
      // A blank comment is no text; it stays where it was.
      { id: 6, comment: "   ", source_narration: null },
    ]);
  });

  it("keeps a draft's narration as its source narration, with no comment", () => {
    const sqlite = booksBefore0012();
    applyNextMigration(sqlite, dbu6MigrationsDir());

    expect(
      sqlite
        .prepare(
          "SELECT source_narration, comment FROM draft_transactions ORDER BY id",
        )
        .all(),
    ).toEqual([
      { source_narration: "UPI-sample-payee-050505", comment: null },
      { source_narration: "NOPII sample refund", comment: null },
    ]);
  });

  it("names a lesson's copied text source_narration", () => {
    const sqlite = booksBefore0012();
    applyNextMigration(sqlite, dbu6MigrationsDir());

    const { transactions } = sqlite
      .prepare("SELECT transactions FROM categorization_lessons")
      .get() as { transactions: string };
    expect(JSON.parse(transactions)).toEqual([
      {
        date: "2026-01-08",
        source_narration: "UPI-sample-payee-050505",
        direction: "withdrawal",
        amount: 500,
      },
    ]);
  });
});
