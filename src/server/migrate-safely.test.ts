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

const MIGRATED_DATA = ["previous-versions", "sqlite.db"];
const STORED_PATH =
  /previous-versions\/sqlite-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.db$/;

/** The stored databases, without SQLite's own files beside them. */
function storedVersions(): string[] {
  return readdirSync(join(dataDir, "previous-versions"))
    .filter((name) => name.endsWith(".db"))
    .sort();
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
      notes: [],
      previousDatabase: expect.stringMatching(STORED_PATH),
    });
    expect(fingerprintOf(dbFile)).toEqual(before);
    expect(readdirSync(dataDir)).toEqual(MIGRATED_DATA);

    expect(await migrateSafely(root)).toEqual({ status: "up-to-date" });
    expect(readdirSync(dataDir)).toEqual(MIGRATED_DATA);
    expect(storedVersions()).toHaveLength(1);
  });

  it("stores the database as it was, rows still in its WAL included", async () => {
    seedProject();
    const writer = new Database(dbFile);
    writer.pragma("wal_autocheckpoint = 0");
    writer.exec(
      "UPDATE draft_transactions SET narration = 'sample, written late' WHERE id = 1",
    );
    const walHeld = new Database(dbFile, { readonly: true });
    walHeld.prepare("SELECT 1").get();
    writer.close();
    expect(existsSync(`${dbFile}-wal`)).toBe(true);
    walHeld.close();
    const before = fingerprintOf(dbFile);

    const result = await migrateSafely(root);

    if (result.status !== "migrated") throw new Error("unreachable");
    expect(result.previousDatabase).toMatch(STORED_PATH);
    expect(fingerprintOf(result.previousDatabase!)).toEqual(before);
    const stored = new Database(result.previousDatabase!, { readonly: true });
    expect(
      stored
        .prepare("SELECT narration FROM draft_transactions WHERE id = 1")
        .get(),
    ).toEqual({ narration: "sample, written late" });
    expect(
      pendingMigrations(stored, dbu6MigrationsDir()).length,
    ).toBeGreaterThan(0);
    stored.close();
  });

  it("stores a separate file for a second migration on the same day and keeps the first", async () => {
    seedProject();
    await migrateSafely(root);
    const [firstName] = storedVersions();
    const first = readFileSync(join(dataDir, "previous-versions", firstName));

    const result = await migrateSafely(root, {
      migrationsDir: migrationsDirWith(
        "9000_sample_table",
        "CREATE TABLE sample_later (id integer);",
      ),
    });

    expect(result.status).toBe("migrated");
    expect(storedVersions()).toHaveLength(2);
    expect(
      readFileSync(join(dataDir, "previous-versions", firstName)).equals(first),
    ).toBe(true);
  });

  it("creates the database of a project that has none", async () => {
    const result = await migrateSafely(root);

    expect(result).toEqual({
      status: "migrated",
      applied: journalTags(dbu6MigrationsDir()),
      notes: [],
      previousDatabase: null,
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
        .prepare("SELECT source_narration FROM draft_transactions WHERE id = 1")
        .get(),
    ).toEqual({ source_narration: "sample, written late" });
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
      expect(readdirSync(dataDir)).toEqual(MIGRATED_DATA);
    });

    it("deletes the replaced original when the new database is already in place", async () => {
      seedProject();
      writeFileSync(`${dbFile}.replaced`, "the old database");
      writeFileSync(`${dbFile}.replaced-wal`, "its wal");

      const result = await migrateSafely(root);

      expect(result.status).toBe("migrated");
      expect(readdirSync(dataDir)).toEqual(MIGRATED_DATA);
    });

    it("deletes a leftover copy even when nothing is pending", async () => {
      await migrateSafely(root);
      writeFileSync(`${dbFile}.migrating`, "a copy from a crashed run");
      writeFileSync(`${dbFile}.migrating-journal`, "its journal");
      writeFileSync(`${dbFile}.previous`, "an original from a crashed run");

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
      expect(readdirSync(dataDir)).toEqual(MIGRATED_DATA);
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

describe("migrateSafely and user-config/import-presets.json", () => {
  const presetsFile = () => join(root, "user-config", "import-presets.json");
  function writePresetsFile(presets: unknown[]): void {
    mkdirSync(join(root, "user-config"), { recursive: true });
    writeFileSync(presetsFile(), JSON.stringify(presets));
  }
  const bankPreset = {
    name: "Sample Bank XLS",
    base_account: "Sample Bank",
    custom_mappings_filenames: ["custom_mappings_default.prompt"],
    custom_statement_parser_path: "hdfc-bank-xls",
    statement_account_identifier: "05050505050505",
  };
  function presetRows(): unknown[] {
    const sqlite = new Database(dbFile, { readonly: true });
    try {
      return sqlite
        .prepare(
          "SELECT workspace_id, scoped_to_user_id, name, parsers, accounts FROM import_presets",
        )
        .all();
    } finally {
      sqlite.close();
    }
  }

  it("writes the presets for the user whose accounts they name, then deletes the file", async () => {
    seedProject();
    writePresetsFile([bankPreset]);

    const result = await migrateSafely(root);

    expect(result.status === "migrated" && result.notes).toEqual([
      expect.stringContaining(
        "Moved user-config/import-presets.json into the import presets: 1 institution(s), 1 account(s)",
      ),
    ]);
    expect(presetRows()).toEqual([
      {
        workspace_id: "workspace-sample",
        scoped_to_user_id: "user-sample",
        name: "Sample Bank XLS",
        parsers: JSON.stringify(["hdfc-bank-xls"]),
        accounts: JSON.stringify([
          {
            account_id: 2,
            name: "Sample Bank XLS",
            is_credit_card: false,
            account_identifiers: ["05050505050505"],
            custom_mappings_filenames: ["custom_mappings_default.prompt"],
          },
        ]),
      },
    ]);
    expect(existsSync(presetsFile())).toBe(false);
    expect(readdirSync(dataDir)).toEqual(MIGRATED_DATA);
  });

  it("keeps the file, and says why, when it names an account the books lack", async () => {
    seedProject();
    writePresetsFile([
      bankPreset,
      { ...bankPreset, name: "Sample Card", base_account: "Sample Card" },
    ]);

    const result = await migrateSafely(root);

    expect(result.status).toBe("migrated");
    expect(result.status === "migrated" && result.notes).toEqual([
      expect.stringMatching(
        /^Kept user-config\/import-presets\.json.*"Sample Card".*dbu6 check/s,
      ),
    ]);
    expect(presetRows()).toEqual([]);
    expect(existsSync(presetsFile())).toBe(true);
  });

  it("deletes a file that holds no presets", async () => {
    seedProject();
    writePresetsFile([]);

    const result = await migrateSafely(root);

    expect(result.status === "migrated" && result.notes).toEqual([
      "Deleted user-config/import-presets.json, which held no presets.",
    ]);
    expect(existsSync(presetsFile())).toBe(false);
  });

  it("keeps the file when a later migration is rejected", async () => {
    seedProject();
    writePresetsFile([bankPreset]);
    const migrationsDir = migrationsDirWith(
      "9000_sample_failure",
      "UPDATE no_such_table SET x = 1;",
    );

    const result = await migrateSafely(root, { migrationsDir });

    expect(result).toMatchObject({
      status: "rejected",
      migration: "9000_sample_failure",
    });
    expect(existsSync(presetsFile())).toBe(true);
    expect(dataFiles()).toEqual(["sqlite.db"]);
  });
});
