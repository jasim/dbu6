/**
 * `migrateSafely(root)`: the only code that changes a database's schema.
 *
 * There is one `sqlite.db` when it begins and one when it ends, and dbu6 keeps
 * no other copy of a person's books, anywhere. The migrations run on a copy
 * beside the database; the copy's ledger fingerprint is compared with the
 * original's after every migration; and only a copy that still says the same
 * thing about the books takes the original's place. Whatever happens, the
 * copy is gone when this returns or throws.
 *
 * A migration with a data step (data-migrations/) runs it on the copy right
 * after its SQL, before the fingerprint is compared. What a step removes from
 * the project, such as a config file whose contents it moved into the copy,
 * it removes only after the copy has taken the original's place.
 *
 *   sqlite.db            the database
 *   sqlite.db.migrating  the copy being migrated
 *   sqlite.db.replaced   the original, for the instant between the two renames
 *   dbu6.lock            see data-lock.ts
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations, pendingMigrations } from "@sapporta/server";
import { acquireDataLock, DataLockHeldError } from "./data-lock.js";
import { DATA_STEPS, type DataStep } from "./data-migrations/index.js";
import {
  FIGURES_A_MIGRATION_CHANGES,
  fingerprintDifferences,
  journalTags,
  ledgerFingerprint,
  type FigureKind,
} from "./ledger-fingerprint.js";
import { databaseFile, dbu6MigrationsDir } from "./paths.js";

export type MigrateSafelyResult =
  | { status: "up-to-date" }
  | {
      status: "migrated";
      applied: string[];
      /** What the data steps said, for the person running the migration. */
      notes: string[];
    }
  | {
      status: "rejected";
      /** The migration that failed or changed the books; null when none ran. */
      migration: string | null;
      reason: string;
      /** The figures that differ, as `name: before -> after`. */
      differences: string[];
    };

/** What a test replaces. The command passes nothing. */
export interface MigrateSafelyOptions {
  migrationsDir?: string;
  figuresChanged?: Readonly<Record<string, readonly FigureKind[]>>;
  dataSteps?: Readonly<Record<string, DataStep>>;
}

export async function migrateSafely(
  root: string,
  options: MigrateSafelyOptions = {},
): Promise<MigrateSafelyResult> {
  // The file `openDbu6Runtime` opens for the same root.
  const file = databaseFile(root);
  mkdirSync(dirname(file), { recursive: true });

  let lock;
  try {
    lock = acquireDataLock(dirname(file));
  } catch (err) {
    if (!(err instanceof DataLockHeldError)) throw err;
    return {
      status: "rejected",
      migration: null,
      reason: err.message,
      differences: [],
    };
  }
  try {
    settleLeftovers(file);
    return await migrateCopy(
      root,
      file,
      options.migrationsDir ?? dbu6MigrationsDir(),
      options.figuresChanged ?? FIGURES_A_MIGRATION_CHANGES,
      options.dataSteps ?? DATA_STEPS,
    );
  } finally {
    // Every way out, a thrown error included: no copy stays behind, and an
    // original that was renamed aside is back in place.
    settleLeftovers(file);
    lock.release();
  }
}

const copyOf = (file: string) => `${file}.migrating`;
const replacedOf = (file: string) => `${file}.replaced`;
/** A database file and the files SQLite keeps beside it. */
const withSidecars = (file: string) => [
  file,
  `${file}-wal`,
  `${file}-shm`,
  `${file}-journal`,
];

/**
 * Puts the folder back to one database and nothing else, from wherever an
 * earlier run stopped. It is also this run's cleanup.
 *
 * - `.replaced` without `sqlite.db`: stopped between the two renames. The
 *   original goes back, with its WAL.
 * - `.replaced` beside `sqlite.db`: the verified copy is already in place and
 *   only the delete was missed.
 * - `.migrating`: an unverified copy. Deleted.
 */
function settleLeftovers(file: string): void {
  const replaced = replacedOf(file);
  if (existsSync(replaced) && !existsSync(file)) {
    if (existsSync(`${replaced}-wal`)) {
      renameSync(`${replaced}-wal`, `${file}-wal`);
    }
    renameSync(replaced, file);
  }
  for (const path of [
    ...withSidecars(replaced),
    ...withSidecars(copyOf(file)),
  ]) {
    rmSync(path, { force: true });
  }
}

async function migrateCopy(
  root: string,
  file: string,
  migrationsDir: string,
  figuresChanged: Readonly<Record<string, readonly FigureKind[]>>,
  dataSteps: Readonly<Record<string, DataStep>>,
): Promise<MigrateSafelyResult> {
  const copyPath = copyOf(file);
  let before;
  if (existsSync(file)) {
    // Read-only, so closing it checkpoints nothing: a rejected migration
    // leaves the original byte for byte as it was.
    const original = new Database(file, { readonly: true });
    try {
      if (pendingMigrations(original, migrationsDir).length === 0) {
        return { status: "up-to-date" };
      }
      // SQLite's backup API: a consistent copy, WAL contents included.
      await original.backup(copyPath);
      before = ledgerFingerprint(original, migrationsDir);
    } finally {
      original.close();
    }
  }

  // A project with no database yet: the copy starts empty and becomes it.
  const copy = new Database(copyPath);
  const applied: string[] = [];
  const notes: string[] = [];
  const afterCommit: (() => Promise<void>)[] = [];
  try {
    // A rollback journal rather than a WAL, so the migrated copy is one file
    // when it is renamed. The server sets WAL again when it opens it.
    copy.pragma("journal_mode = DELETE");
    before ??= ledgerFingerprint(copy, migrationsDir);

    for (;;) {
      const tag = pendingMigrations(copy, migrationsDir)[0]?.tag;
      if (tag === undefined) break;
      try {
        applyNextMigration(copy, migrationsDir);
        const step = dataSteps[tag];
        if (step) {
          const outcome = await step(copy, root);
          if (outcome.note !== null) notes.push(outcome.note);
          if (outcome.afterCommit) afterCommit.push(outcome.afterCommit);
        }
      } catch (err) {
        return {
          status: "rejected",
          migration: tag,
          reason: `Migration ${tag} failed: ${errorMessage(err)}`,
          differences: [],
        };
      }
      const after = ledgerFingerprint(copy, migrationsDir);
      const differences = fingerprintDifferences(
        before,
        after,
        figuresChanged[tag],
      );
      if (differences.length > 0) {
        return {
          status: "rejected",
          migration: tag,
          reason: `Migration ${tag} changed the books. The database was left as it was.`,
          differences,
        };
      }
      // Figures the migration declared it changes now have their new values.
      before = after;
      applied.push(tag);
    }

    const check = copy.pragma("quick_check", { simple: true });
    if (check !== "ok") {
      return {
        status: "rejected",
        migration: null,
        reason: `The migrated copy failed SQLite's quick_check: ${String(check)}`,
        differences: [],
      };
    }
  } finally {
    copy.close();
  }

  putCopyInPlace(file);
  for (const step of afterCommit) {
    try {
      await step();
    } catch (err) {
      // The books are migrated; what is left over is the project's to tidy.
      notes.push(`Could not finish after migrating: ${errorMessage(err)}`);
    }
  }
  return { status: "migrated", applied, notes };
}

/**
 * The original aside, the copy into place, the original deleted. The
 * original's WAL moves aside with it: left where it is, SQLite would replay it
 * into the new database.
 */
function putCopyInPlace(file: string): void {
  const copyPath = copyOf(file);
  const replaced = replacedOf(file);
  fsyncPath(copyPath);
  if (existsSync(file)) {
    renameSync(file, replaced);
    if (existsSync(`${file}-wal`)) renameSync(`${file}-wal`, `${replaced}-wal`);
    rmSync(`${file}-shm`, { force: true });
  }
  renameSync(copyPath, file);
  for (const path of withSidecars(replaced)) rmSync(path, { force: true });
  fsyncPath(dirname(file));
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } catch (err) {
    // Windows refuses to fsync a directory; the renames are still done.
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
  } finally {
    closeSync(fd);
  }
}

/**
 * Applies the first pending migration in `migrationsDir` and returns its tag,
 * or null when nothing is pending. Drizzle's `migrate()` applies every pending
 * migration in a directory, so this hands it a temporary directory holding the
 * journal only up to that migration. The directory holds our SQL and nothing
 * of the user's.
 */
export function applyNextMigration(
  sqlite: Database.Database,
  migrationsDir: string,
): string | null {
  const next = pendingMigrations(sqlite, migrationsDir)[0];
  if (next === undefined) return null;

  const tags = journalTags(migrationsDir);
  const prefix = tags.slice(0, tags.indexOf(next.tag) + 1);
  const journalPath = join("meta", "_journal.json");
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, journalPath), "utf8"),
  ) as { entries: { tag: string }[] };

  const stepDir = mkdtempSync(join(tmpdir(), "dbu6-migration-"));
  try {
    mkdirSync(join(stepDir, "meta"));
    writeFileSync(
      join(stepDir, journalPath),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((e) => prefix.includes(e.tag)),
      }),
    );
    for (const tag of prefix) {
      copyFileSync(
        join(migrationsDir, `${tag}.sql`),
        join(stepDir, `${tag}.sql`),
      );
    }
    const applied = applyMigrations(sqlite, stepDir).map((m) => m.tag);
    if (applied.length !== 1 || applied[0] !== next.tag) {
      // Drizzle skips a migration dated before the last applied one.
      throw new Error(
        `Expected to apply ${next.tag}, applied ${applied.join(", ") || "nothing"}. ` +
          "Its journal entry may be dated before a migration already applied.",
      );
    }
    return next.tag;
  } finally {
    rmSync(stepDir, { recursive: true, force: true });
  }
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // Drizzle wraps SQLite's error; the cause says what the SQL did.
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
  return `${err.message}${cause}`;
}
