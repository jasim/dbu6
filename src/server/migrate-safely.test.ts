import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingMigrations } from "@sapporta/server";
import { acquireDataLock, LOCK_FILE } from "./data-lock.js";
import { journalTags, ledgerFingerprint } from "./ledger-fingerprint.js";
import { migrateSafely } from "./migrate-safely.js";
import {
  FIRST_LEDGER_MIGRATION,
  migrateUpTo,
  migrationsDirWith,
  seedBooksAtFirstLedgerSchema,
  tempDir,
} from "./migrations.test.support.js";
import { dbu6MigrationsDir } from "./paths.js";

let root: string;
let dataDir: string;
let dbFile: string;

beforeEach(() => {
  root = tempDir("project");
  dataDir = join(root, "data");
  dbFile = join(dataDir, "sqlite.db");
  vi.stubEnv("SAPPORTA_DATA_DIR", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Books at the oldest ledger schema, closed, as a server would leave them. */
function seedProject(): void {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  migrateUpTo(sqlite, FIRST_LEDGER_MIGRATION);
  seedBooksAtFirstLedgerSchema(sqlite);
  sqlite.close();
}

function fingerprintOf(file: string, migrationsDir?: string) {
  const sqlite = new Database(file, { readonly: true });
  try {
    return ledgerFingerprint(sqlite, migrationsDir);
  } finally {
    sqlite.close();
  }
}

/** Everything in data/ except SQLite's own -wal and -shm of the database. */
function dataFiles(): string[] {
  return readdirSync(dataDir)
    .filter((name) => name !== "sqlite.db-wal" && name !== "sqlite.db-shm")
    .sort();
}

describe("migrateSafely", () => {
  it("migrates seeded books to the newest schema with the same fingerprint", async () => {
    seedProject();
    const before = fingerprintOf(dbFile);
    const tags = journalTags(dbu6MigrationsDir());

    const result = await migrateSafely(root);

    expect(result).toEqual({
      status: "migrated",
      applied: tags.slice(tags.indexOf(FIRST_LEDGER_MIGRATION) + 1),
    });
    expect(fingerprintOf(dbFile)).toEqual(before);
    expect(readdirSync(dataDir)).toEqual(["sqlite.db"]);

    expect(await migrateSafely(root)).toEqual({ status: "up-to-date" });
    expect(readdirSync(dataDir)).toEqual(["sqlite.db"]);
  });

  it("creates the database of a project that has none", async () => {
    const result = await migrateSafely(root);

    expect(result).toEqual({
      status: "migrated",
      applied: journalTags(dbu6MigrationsDir()),
    });
    expect(readdirSync(dataDir)).toEqual(["sqlite.db"]);
    const sqlite = new Database(dbFile, { readonly: true });
    expect(pendingMigrations(sqlite, dbu6MigrationsDir())).toEqual([]);
    sqlite.close();
  });

  it("carries rows still in the original's WAL into the migrated database", async () => {
    seedProject();
    // A server that was killed: its last write is in the WAL, not the file.
    const writer = new Database(dbFile);
    writer.pragma("wal_autocheckpoint = 0");
    writer.exec(
      "UPDATE draft_transactions SET narration = 'sample, written late' WHERE id = 1",
    );
    const walHeld = new Database(dbFile, { readonly: true });
    walHeld.prepare("SELECT 1").get();
    // better-sqlite3 checkpoints on close unless another connection is open.
    writer.close();
    expect(existsSync(`${dbFile}-wal`)).toBe(true);
    walHeld.close();

    const result = await migrateSafely(root);

    expect(result.status).toBe("migrated");
    const sqlite = new Database(dbFile, { readonly: true });
    expect(
      sqlite
        .prepare("SELECT narration FROM draft_transactions WHERE id = 1")
        .get(),
    ).toEqual({ narration: "sample, written late" });
    sqlite.close();
  });

  it("rejects a migration that alters an amount, leaving the original byte-identical and no copy", async () => {
    seedProject();
    const migrationsDir = migrationsDirWith(
      "9000_sample_rounding",
      "UPDATE journal_entries SET debit = debit + 1 WHERE debit > 0;",
    );
    const original = readFileSync(dbFile);

    const result = await migrateSafely(root, { migrationsDir });

    expect(result).toMatchObject({
      status: "rejected",
      migration: "9000_sample_rounding",
    });
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.differences).toContain(
      "account.balance:2: 46500.0000 -> 46501.0000",
    );
    expect(result.differences).toContain("trial-balance: 0.0000 -> 3.0000");
    expect(readFileSync(dbFile).equals(original)).toBe(true);
    expect(dataFiles()).toEqual(["sqlite.db"]);
  });

  it("accepts that migration once it declares the figures it changes, and no others", async () => {
    seedProject();
    const migrationsDir = migrationsDirWith(
      "9000_sample_rounding",
      "UPDATE journal_entries SET debit = debit + 1 WHERE debit > 0;",
    );

    const partly = await migrateSafely(root, {
      migrationsDir,
      figuresChanged: { "9000_sample_rounding": ["entries.hash"] },
    });
    expect(partly.status).toBe("rejected");

    const fully = await migrateSafely(root, {
      migrationsDir,
      figuresChanged: {
        "9000_sample_rounding": [
          "entries.hash",
          "account.balance",
          "journals.unbalanced",
          "trial-balance",
        ],
      },
    });
    expect(fully.status).toBe("migrated");
    expect(fingerprintOf(dbFile, migrationsDir)["trial-balance"]).toBe(
      "3.0000",
    );
  });

  it("rejects a migration whose SQL fails, naming it", async () => {
    seedProject();
    const migrationsDir = migrationsDirWith(
      "9000_sample_broken",
      "ALTER TABLE no_such_table ADD COLUMN sample text;",
    );
    const original = readFileSync(dbFile);

    const result = await migrateSafely(root, { migrationsDir });

    expect(result).toMatchObject({
      status: "rejected",
      migration: "9000_sample_broken",
      differences: [],
    });
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reason).toContain("no_such_table");
    expect(readFileSync(dbFile).equals(original)).toBe(true);
    expect(dataFiles()).toEqual(["sqlite.db"]);
  });

  it("leaves no copy behind when it throws", async () => {
    seedProject();
    const original = readFileSync(dbFile);
    // A migrations directory with a journal and no SQL files.
    const migrationsDir = tempDir("migrations-broken");
    mkdirSync(join(migrationsDir, "meta"));
    writeFileSync(
      join(migrationsDir, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [
          { idx: 0, version: "6", when: 1, tag: "0000_sample_missing" },
        ],
      }),
    );

    await expect(migrateSafely(root, { migrationsDir })).rejects.toThrow();

    expect(readFileSync(dbFile).equals(original)).toBe(true);
    expect(dataFiles()).toEqual(["sqlite.db"]);
  });

  describe("after a crash", () => {
    it("puts the original back when it stopped between the two renames", async () => {
      seedProject();
      const before = fingerprintOf(dbFile);
      const original = readFileSync(dbFile);
      // The original aside, a copy not yet in place.
      writeFileSync(`${dbFile}.replaced`, original);
      writeFileSync(`${dbFile}.migrating`, "not a database");
      rmSync(dbFile);

      const result = await migrateSafely(root);

      // Put back, then migrated normally from the original.
      expect(result.status).toBe("migrated");
      expect(fingerprintOf(dbFile)).toEqual(before);
      expect(readdirSync(dataDir)).toEqual(["sqlite.db"]);
    });

    it("deletes the replaced original when the new database is already in place", async () => {
      seedProject();
      writeFileSync(`${dbFile}.replaced`, "the old database");
      writeFileSync(`${dbFile}.replaced-wal`, "its wal");

      const result = await migrateSafely(root);

      expect(result.status).toBe("migrated");
      expect(readdirSync(dataDir)).toEqual(["sqlite.db"]);
    });

    it("deletes a leftover copy even when nothing is pending", async () => {
      await migrateSafely(root);
      writeFileSync(`${dbFile}.migrating`, "a copy from a crashed run");
      writeFileSync(`${dbFile}.migrating-journal`, "its journal");

      expect(await migrateSafely(root)).toEqual({ status: "up-to-date" });
      expect(dataFiles()).toEqual(["sqlite.db"]);
    });
  });

  describe("the lock", () => {
    it("takes over a lock left by a process that is gone", async () => {
      seedProject();
      writeFileSync(join(dataDir, LOCK_FILE), `${await deadPid()}\n`);

      const result = await migrateSafely(root);

      expect(result.status).toBe("migrated");
      expect(readdirSync(dataDir)).toEqual(["sqlite.db"]);
    });

    it("refuses while a running process holds the lock, and touches nothing", async () => {
      seedProject();
      const original = readFileSync(dbFile);
      const holder = spawn(process.execPath, [
        "-e",
        "setInterval(() => {}, 1000)",
      ]);
      try {
        writeFileSync(join(dataDir, LOCK_FILE), `${holder.pid}\n`);

        const result = await migrateSafely(root);

        expect(result).toMatchObject({ status: "rejected", migration: null });
        if (result.status !== "rejected") throw new Error("unreachable");
        expect(result.reason).toContain(`pid ${holder.pid}`);
        expect(readFileSync(dbFile).equals(original)).toBe(true);
        expect(dataFiles()).toEqual([LOCK_FILE, "sqlite.db"]);
      } finally {
        holder.kill();
      }
    });

    it("refuses while a server in this process holds it, and is free after release", async () => {
      seedProject();
      const serving = acquireDataLock(dataDir);
      expect((await migrateSafely(root)).status).toBe("rejected");
      serving.release();
      expect((await migrateSafely(root)).status).toBe("migrated");
    });
  });
});

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}
