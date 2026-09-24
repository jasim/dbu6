import type Database from "better-sqlite3";
import { importPresetsFromFile } from "./import-presets-from-file.js";

/*
 * Data migrations: code that moves what a project holds outside the database
 * into it, when SQL alone can't. Each runs on `migrateSafely`'s copy right
 * after the SQL migration of the same tag, whose own SQL is a marker, and
 * the ledger fingerprint is compared after it as after any migration.
 *
 * A step writes with SQL of its own, against the schema its migration leaves,
 * so a later schema change can't change what it writes. It never refuses the
 * migration for what it can't convert: it leaves the files alone and says
 * why, and `dbu6 check` says what to do. Anything it removes from the project
 * it removes in `afterCommit`, which runs only once the migrated copy has
 * taken the original's place.
 */

export interface DataStepOutcome {
  /** What the person should know, printed after the migration; or null. */
  note: string | null;
  afterCommit?: () => Promise<void>;
}

export type DataStep = (
  sqlite: Database.Database,
  root: string,
) => Promise<DataStepOutcome>;

/** Each data migration, by the tag of the SQL migration it follows. */
export const DATA_STEPS: Readonly<Record<string, DataStep>> = {
  "0008_import_presets_from_file": importPresetsFromFile,
};
