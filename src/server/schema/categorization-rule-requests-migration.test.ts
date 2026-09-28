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
 * Migration 0013_categorization_rule_requests: the lessons table and its
 * index take the name the tab, the prompt and the books guide now use. The
 * rule requests already in a book go with them, so an upgrade loses none.
 */
function booksBefore0013(): Database.Database {
  const sqlite = new Database(":memory:");
  migrateUpTo(sqlite, FIRST_LEDGER_MIGRATION);
  seedBooksAtFirstLedgerSchema(sqlite);
  migrateUpTo(sqlite, "0012_source_narration");
  const scope = `'workspace-sample', 'user-sample'`;
  sqlite.exec(`
    INSERT INTO categorization_lessons
      (workspace_id, scoped_to_user_id, base_account_id, account_id, transactions, note, created_at)
    VALUES (${scope}, 2, 4,
      '[{"date":"2026-01-08","source_narration":"UPI-sample-payee-050505","direction":"withdrawal","amount":500}]',
      'A sample payee.', '2026-01-10T00:00:00Z');
  `);
  return sqlite;
}

const names = (sqlite: Database.Database, type: string, table?: string) =>
  sqlite
    .prepare(
      table === undefined
        ? "SELECT name FROM sqlite_master WHERE type = ? ORDER BY name"
        : "SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = ? ORDER BY name",
    )
    .all(...(table === undefined ? [type] : [type, table]))
    .map((row) => (row as { name: string }).name);

describe("migration 0013_categorization_rule_requests", () => {
  it("renames the lessons table and its index, keeping what is in it", () => {
    const sqlite = booksBefore0013();
    expect(applyNextMigration(sqlite, dbu6MigrationsDir())).toBe(
      "0013_categorization_rule_requests",
    );

    expect(names(sqlite, "table")).toContain("categorization_rule_requests");
    expect(names(sqlite, "table")).not.toContain("categorization_lessons");
    expect(names(sqlite, "index", "categorization_rule_requests")).toContain(
      "categorization_rule_requests_base_account_idx",
    );

    expect(
      sqlite
        .prepare(
          "SELECT base_account_id, account_id, note FROM categorization_rule_requests",
        )
        .get(),
    ).toEqual({ base_account_id: 2, account_id: 4, note: "A sample payee." });
  });
});
