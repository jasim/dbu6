import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  fingerprintDifferences,
  journalTags,
  ledgerFingerprint,
} from "./ledger-fingerprint.js";
import { applyNextMigration } from "./migrate-safely.js";
import {
  FIRST_LEDGER_MIGRATION,
  migrateUpTo,
  seedBooksAtFirstLedgerSchema,
} from "./migrations.test.support.js";
import { dbu6MigrationsDir } from "./paths.js";

function seededBooks(): Database.Database {
  const sqlite = new Database(":memory:");
  migrateUpTo(sqlite, FIRST_LEDGER_MIGRATION);
  seedBooksAtFirstLedgerSchema(sqlite);
  return sqlite;
}

describe("ledgerFingerprint", () => {
  it("stays equal through every migration in the repository, one at a time", () => {
    const sqlite = seededBooks();
    const seeded = ledgerFingerprint(sqlite);

    const walked = [];
    for (;;) {
      const tag = applyNextMigration(sqlite, dbu6MigrationsDir());
      if (tag === null) break;
      walked.push(tag);
      expect(ledgerFingerprint(sqlite), `after ${tag}`).toEqual(seeded);
    }

    // Every migration after the one the books were seeded at was walked.
    const tags = journalTags(dbu6MigrationsDir());
    expect(walked).toEqual(
      tags.slice(tags.indexOf(FIRST_LEDGER_MIGRATION) + 1),
    );
  });

  it("holds each account, the counts, the hashes and the balance checks", () => {
    const fingerprint = ledgerFingerprint(seededBooks());
    expect(fingerprint).toMatchObject({
      "account.parent:1": "none",
      "account.parent:2": "1",
      "account.balance:2": "46500.0000",
      "account.balance:4": "3500.0000",
      "account.balance:5": "-50000.0000",
      "account.draft-balance:2": "-300.0000",
      "account.draft-balance:4": "500.0000",
      "journals.count": "3",
      "entries.count": "6",
      "drafts.count": "2",
      "journals.unbalanced": "none",
      "trial-balance": "0.0000",
    });
    expect(fingerprint["entries.hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint["drafts.hash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads a database from before the ledger's tables as empty books", () => {
    const sqlite = new Database(":memory:");
    const empty = ledgerFingerprint(sqlite);
    expect(empty["entries.count"]).toBe("0");

    applyNextMigration(sqlite, dbu6MigrationsDir()); // auth tables only
    expect(ledgerFingerprint(sqlite)).toEqual(empty);
    migrateUpTo(sqlite, FIRST_LEDGER_MIGRATION);
    expect(ledgerFingerprint(sqlite)).toEqual(empty);
  });

  it.each([
    [
      "an amount",
      "UPDATE journal_entries SET debit = 3000 WHERE id = 3",
      "entries.hash",
    ],
    [
      "an entry's account",
      "UPDATE journal_entries SET account_id = 3 WHERE id = 3",
      "account.balance:3",
    ],
    [
      "a journal's date",
      "UPDATE journals SET date = '2026-02-06' WHERE id = 2",
      "entries.hash",
    ],
    [
      "an account's parent",
      "UPDATE accounts SET parent_id = NULL WHERE id = 4",
      "account.parent:4",
    ],
    [
      "a deleted journal",
      "DELETE FROM journal_entries WHERE journal_id = 3; DELETE FROM journals WHERE id = 3",
      "journals.count",
    ],
    [
      "a draft's amount",
      "UPDATE draft_transactions SET withdrawal = 600 WHERE id = 1",
      "drafts.hash",
    ],
    [
      "a draft's category",
      "UPDATE draft_transactions SET account_id = 3 WHERE id = 1",
      "account.draft-balance:3",
    ],
    [
      "a deleted draft",
      "DELETE FROM draft_transactions WHERE id = 2",
      "drafts.count",
    ],
  ])("names the figure when %s changes", (_what, sql, figure) => {
    const sqlite = seededBooks();
    const before = ledgerFingerprint(sqlite);
    sqlite.exec(sql);
    const differences = fingerprintDifferences(
      before,
      ledgerFingerprint(sqlite),
    );
    expect(differences.map((line) => line.split(": ")[0])).toContain(figure);
  });

  it("reports a journal knocked out of balance and the trial balance", () => {
    const sqlite = seededBooks();
    const before = ledgerFingerprint(sqlite);
    sqlite.exec("UPDATE journal_entries SET debit = 3000 WHERE id = 3");
    const differences = fingerprintDifferences(
      before,
      ledgerFingerprint(sqlite),
    );
    expect(differences).toContain("journals.unbalanced: none -> 2");
    expect(differences).toContain("trial-balance: 0.0000 -> 500.0000");
  });

  it("skips only the kinds a migration declares it changes", () => {
    const sqlite = seededBooks();
    const before = ledgerFingerprint(sqlite);
    // Moves 1000 from one account to another, and drops a draft.
    sqlite.exec(`
      UPDATE journal_entries SET account_id = 3 WHERE id = 5;
      DELETE FROM draft_transactions WHERE id = 2;
    `);
    const after = ledgerFingerprint(sqlite);

    const declared = fingerprintDifferences(before, after, [
      "account.balance",
      "entries.hash",
    ]);
    expect(declared.map((line) => line.split(": ")[0])).toEqual([
      "account.draft-balance:2",
      "drafts.count",
      "drafts.hash",
    ]);
  });
});
