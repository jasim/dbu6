import type Database from "better-sqlite3";
import {
  convertImportPresetsFile,
  deleteImportPresetsFile,
  parserDirectory,
  readImportPresetsFile,
  validateImportPresets,
  type PresetInstitution,
} from "../modules/statement-sources/index.js";
import type { DataStepOutcome } from "./index.js";

/*
 * 0008: user-config/import-presets.json becomes import_presets rows, the
 * table 0007 made, and the file is deleted once the migrated database is in
 * place. No copy of it is kept.
 *
 * The file belongs to the project, and the rows to one user's books, so the
 * user is the one whose accounts have every base_account the file names; the
 * user's presets must be empty. When no user, or more than one, fits, or the
 * presets would break a rule, the file stays and `dbu6 check` says how to
 * convert it (POST /api/import-presets/import-json, after fixing it).
 */

interface Scope {
  workspace_id: string;
  scoped_to_user_id: string;
}

export async function importPresetsFromFile(
  sqlite: Database.Database,
  root: string,
): Promise<DataStepOutcome> {
  let presets;
  try {
    presets = await readImportPresetsFile(root);
  } catch (error) {
    return kept(`it does not parse (${messageOf(error)})`);
  }
  if (presets === null) return { note: null };
  if (presets.length === 0) {
    return {
      note: "Deleted user-config/import-presets.json, which held no presets.",
      afterCommit: () => deleteImportPresetsFile(root),
    };
  }

  const scopes = sqlite
    .prepare(
      `SELECT DISTINCT workspace_id, scoped_to_user_id FROM accounts
       WHERE NOT EXISTS (
         SELECT 1 FROM import_presets p
         WHERE p.workspace_id = accounts.workspace_id
           AND p.scoped_to_user_id = accounts.scoped_to_user_id)`,
    )
    .all() as Scope[];
  const fits: {
    scope: Scope;
    institutions: PresetInstitution[];
    warnings: string[];
  }[] = [];
  const refusals: string[] = [];
  for (const scope of scopes) {
    const accountIds = new Map(
      (
        sqlite
          .prepare(
            `SELECT name, id FROM accounts
             WHERE workspace_id = ? AND scoped_to_user_id = ?`,
          )
          .all(scope.workspace_id, scope.scoped_to_user_id) as {
          name: string;
          id: number;
        }[]
      ).map((account) => [account.name, account.id]),
    );
    const conversion = convertImportPresetsFile(presets, accountIds);
    if (!conversion.ok) {
      refusals.push(conversion.message);
      continue;
    }
    const [broken] = validateImportPresets(conversion.institutions);
    if (broken) {
      refusals.push(broken.message);
      continue;
    }
    fits.push({
      scope,
      institutions: conversion.institutions,
      warnings: conversion.warnings,
    });
  }

  if (fits.length === 0) {
    return kept(
      scopes.length === 1
        ? refusals[0]!
        : scopes.length === 0
          ? "the books have no accounts without import presets to convert it for"
          : "no user's accounts have every base_account it names",
    );
  }
  if (fits.length > 1) {
    return kept(
      `${fits.length} users' accounts have every base_account it names, so it is not clear whose presets these are`,
    );
  }
  const [{ scope, institutions, warnings }] = fits;

  for (const parser of new Set(institutions.flatMap((one) => one.parsers))) {
    if ((await parserDirectory(parser, root)) === null) {
      return kept(`it names the parser ${parser}, which is not saved`);
    }
  }

  // import_presets as 0007 made it.
  const insert = sqlite.prepare(
    `INSERT INTO import_presets
       (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    for (const institution of institutions) {
      insert.run(
        scope.workspace_id,
        scope.scoped_to_user_id,
        institution.name,
        JSON.stringify(institution.parsers),
        JSON.stringify(institution.accounts),
        now,
      );
    }
  })();

  const written = sqlite
    .prepare(
      `SELECT name, parsers, accounts FROM import_presets
       WHERE workspace_id = ? AND scoped_to_user_id = ? ORDER BY id`,
    )
    .all(scope.workspace_id, scope.scoped_to_user_id) as {
    name: string;
    parsers: string;
    accounts: string;
  }[];
  const readBack = written.map((row) => ({
    name: row.name,
    parsers: JSON.parse(row.parsers),
    accounts: JSON.parse(row.accounts),
  }));
  const expected = institutions.map(({ id: _id, ...rest }) => rest);
  if (JSON.stringify(readBack) !== JSON.stringify(expected)) {
    // A fault, not a refusal: migrateSafely rejects the migration.
    throw new Error(
      "The import presets read back from the table differ from user-config/import-presets.json.",
    );
  }

  const accounts = institutions.flatMap((one) => one.accounts).length;
  return {
    note: [
      `Moved user-config/import-presets.json into the import presets: ${institutions.length} institution(s), ${accounts} account(s). The file is deleted.`,
      ...warnings,
    ].join("\n"),
    afterCommit: () => deleteImportPresetsFile(root),
  };
}

function kept(reason: string): DataStepOutcome {
  return {
    note: `Kept user-config/import-presets.json, whose presets were not moved into the database: ${reason}. \`npx dbu6 check\` says how to convert it.`,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
