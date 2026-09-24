import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { Temporal } from "@sapporta/shared/temporal";
import {
  importAccountSchema,
  parserNameSchema,
  type ImportInstitution,
} from "../../../shared/index.js";
import {
  importPresets,
  importPresetsTable,
} from "../../schema/import-presets.js";
import type { LedgerAuth } from "../ledger-sql/index.js";
import type { PresetInstitution } from "../statement-sources/index.js";

// The import_presets rows in scope: one institution each, its JSON columns
// parsed with the contract's schemas.

const parsersColumnSchema = z.array(parserNameSchema);
const accountsColumnSchema = z.array(importAccountSchema);

type PresetRow = typeof importPresetsTable.$inferSelect;

function institutionOf(row: PresetRow): ImportInstitution {
  try {
    return {
      id: row.id,
      name: row.name,
      parsers: parsersColumnSchema.parse(JSON.parse(row.parsers)),
      accounts: accountsColumnSchema.parse(JSON.parse(row.accounts)),
    };
  } catch (error) {
    throw new Error(
      `The import preset "${row.name}" (import_presets.id ${row.id}) is malformed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Every institution in scope, in the order they were added. A row whose JSON
 * doesn't parse is a configuration error and throws.
 */
export function loadImportPresets(
  db: any,
  auth: LedgerAuth,
): ImportInstitution[] {
  const access = auth.rowSecurity.forTable(importPresets);
  return db
    .select()
    .from(importPresetsTable)
    .where(access.ownedRows())
    .orderBy(asc(importPresetsTable.id))
    .all()
    .map(institutionOf);
}

/**
 * Every institution in the database, whoever's it is, for `dbu6 check`,
 * which reads a project's books outside any request, and a project has one
 * owner. Null when the database predates the table.
 */
export function readEveryImportPreset(
  sqlite: import("better-sqlite3").Database,
): ImportInstitution[] | null {
  const table = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'import_presets'",
    )
    .get();
  if (table === undefined) return null;
  return (
    sqlite
      .prepare("SELECT * FROM import_presets ORDER BY id")
      .all() as PresetRow[]
  ).map(institutionOf);
}

function columnsOf(institution: PresetInstitution) {
  return {
    name: institution.name,
    parsers: JSON.stringify(institution.parsers),
    accounts: JSON.stringify(institution.accounts),
  };
}

/**
 * Turns the rows `before` into `after`: deletes the institutions `after`
 * lacks, updates the ones that changed, and inserts the new ones (id null).
 * Runs inside the caller's transaction; the rules are the caller's to check.
 */
export function saveImportPresets(
  tx: any,
  auth: LedgerAuth,
  before: readonly ImportInstitution[],
  after: readonly PresetInstitution[],
): void {
  const access = auth.rowSecurity.forTable(importPresets);
  const kept = new Map(
    after.flatMap((one) => (one.id === null ? [] : [[one.id, one] as const])),
  );
  const now = Temporal.Now.instant();

  // Deletes first and inserts last, so a name given up in the batch is free
  // for the row that takes it.
  for (const institution of before) {
    if (kept.has(institution.id)) continue;
    tx.delete(importPresetsTable)
      .where(access.ownedRows(eq(importPresetsTable.id, institution.id)))
      .run();
  }
  for (const institution of before) {
    const next = kept.get(institution.id);
    if (!next) continue;
    const columns = columnsOf(next);
    if (JSON.stringify(columns) === JSON.stringify(columnsOf(institution))) {
      continue;
    }
    tx.update(importPresetsTable)
      .set({ ...columns, updated_at: now })
      .where(access.ownedRows(eq(importPresetsTable.id, institution.id)))
      .run();
  }
  for (const institution of after) {
    if (institution.id !== null) continue;
    tx.insert(importPresetsTable)
      .values(access.insertValuesSync(tx, columnsOf(institution)))
      .run();
  }
}
