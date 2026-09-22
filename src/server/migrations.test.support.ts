/**
 * Shared by the fingerprint and `migrateSafely` tests: books seeded at the
 * oldest schema that has ledger tables, and migration directories that extend
 * ours with one more migration.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { applyNextMigration } from "./migrate-safely.js";
import { dbu6MigrationsDir } from "./runtime.js";

/** The migration that creates accounts, journals, entries and drafts. */
export const FIRST_LEDGER_MIGRATION = "0001_organic_menace";

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dbu6-${prefix}-`));
}

/** Applies migrations one at a time until `tag` is the last one applied. */
export function migrateUpTo(
  sqlite: Database.Database,
  tag: string,
  migrationsDir: string = dbu6MigrationsDir(),
): void {
  for (;;) {
    const applied = applyNextMigration(sqlite, migrationsDir);
    if (applied === tag) return;
    if (applied === null) throw new Error(`No migration ${tag}.`);
  }
}

/**
 * Small books in the columns of `FIRST_LEDGER_MIGRATION`: a two-level account
 * tree, three balanced journals, and drafts with and without a category.
 */
export function seedBooksAtFirstLedgerSchema(sqlite: Database.Database): void {
  const at = "2026-01-01T00:00:00Z";
  const scope = `'workspace-sample', 'user-sample'`;
  sqlite.exec(`
    INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at) VALUES
      (1, ${scope}, 'Assets', NULL, 'asset', '${at}', '${at}'),
      (2, ${scope}, 'Sample Bank', 1, 'asset', '${at}', '${at}'),
      (3, ${scope}, 'Expenses', NULL, 'expense', '${at}', '${at}'),
      (4, ${scope}, 'Food', 3, 'expense', '${at}', '${at}'),
      (5, ${scope}, 'Income', NULL, 'income', '${at}', '${at}');
    INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at) VALUES
      (1, ${scope}, '2026-01-05', 'sample salary', '${at}', '${at}'),
      (2, ${scope}, '2026-01-06', 'sample groceries', '${at}', '${at}'),
      (3, ${scope}, '2026-01-07', 'sample dinner', '${at}', '${at}');
    INSERT INTO journal_entries (workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at) VALUES
      (${scope}, 1, 2, 50000, 0, '${at}', '${at}'),
      (${scope}, 1, 5, 0, 50000, '${at}', '${at}'),
      (${scope}, 2, 4, 2500, 0, '${at}', '${at}'),
      (${scope}, 2, 2, 0, 2500, '${at}', '${at}'),
      (${scope}, 3, 4, 1000, 0, '${at}', '${at}'),
      (${scope}, 3, 2, 0, 1000, '${at}', '${at}');
    INSERT INTO draft_transactions (workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit, account_id, base_account_id, created_at, updated_at) VALUES
      (${scope}, '2026-01-08', 'UPI-sample-payee-050505', 500, 0, 4, 2, '${at}', '${at}'),
      (${scope}, '2026-01-09', 'NOPII sample refund', 0, 200, NULL, 2, '${at}', '${at}');
  `);
}

/**
 * A copy of our migrations with one more at the end, for a test that needs a
 * migration we would never ship. Returns the directory.
 */
export function migrationsDirWith(tag: string, sql: string): string {
  const dir = tempDir("migrations");
  cpSync(dbu6MigrationsDir(), dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  const last = journal.entries.at(-1)!;
  journal.entries.push({
    ...last,
    idx: last.idx + 1,
    when: last.when + 1,
    tag,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, `${tag}.sql`), sql);
  return dir;
}
