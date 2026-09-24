import type {
  ImportAccountView,
  ImportInstitution,
  ImportPresetChange,
  ImportPresetsView,
} from "../../shared/index.js";
import { loadLedgerAccounts } from "../modules/accounts/index.js";
import {
  loadImportPresets,
  saveImportPresets,
} from "../modules/import-presets/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  applyImportPresetChanges,
  changesAdding,
  convertImportPresetsFile,
  deleteImportPresetsFile,
  parserDirectory,
  presetAdditions,
  readImportPresetsFile,
  validateImportPresets,
  type ImportPresetProblem,
  type ImportPresetsFileConversion,
  type PresetInstitution,
} from "../modules/statement-sources/index.js";

/*
 * The import presets' one writer. A batch of changes is applied to the whole
 * table in one transaction:
 *
 *   loadImportPresets
 *     -> applyImportPresetChanges    each change in order
 *     -> validateImportPresets       rules 1-6, on the table it leaves
 *     -> presetAdditions             rules 7-8: what it adds exists now
 *     -> saveImportPresets           the rows that changed
 *
 * A refused batch writes nothing. Converting user-config/import-presets.json
 * is one such batch, into an empty table.
 */

export type ImportPresetsChangeOutcome =
  | { ok: true; presets: ImportPresetsView }
  | { ok: false; problem: ImportPresetProblem };

/** The presets, each account with its ledger account's name if it has one. */
export function loadImportPresetsView(ledger: Ledger): ImportPresetsView {
  return {
    institutions: withLedgerNames(
      loadImportPresets(ledger.db, ledger.auth),
      ledgerAccountNames(ledger),
    ),
  };
}

export async function changeImportPresets(
  ledger: Ledger,
  changes: readonly ImportPresetChange[],
): Promise<ImportPresetsChangeOutcome> {
  const savedParsers = await existingParsers(changes);
  const refused = ledger.db.transaction((tx: any) => {
    const before = loadImportPresets(tx, ledger.auth);
    const checked = checkedChanges(ledger, before, changes, savedParsers);
    if (!checked.ok) return checked.problem;
    saveImportPresets(tx, ledger.auth, before, checked.institutions);
    return null;
  });
  if (refused) return { ok: false, problem: refused };
  return { ok: true, presets: loadImportPresetsView(ledger) };
}

type CheckedChanges =
  | { ok: true; institutions: PresetInstitution[] }
  | { ok: false; problem: ImportPresetProblem };

// The table `changes` leave `before` as, or the first rule it breaks.
// `savedParsers` holds the parsers among those the batch names that exist:
// looking one up reads the disk, which a SQLite transaction can't wait for.
function checkedChanges(
  ledger: Ledger,
  before: readonly PresetInstitution[],
  changes: readonly ImportPresetChange[],
  savedParsers: ReadonlySet<string>,
): CheckedChanges {
  const applied = applyImportPresetChanges(before, changes);
  if (!applied.ok) return applied;
  const [broken] = validateImportPresets(applied.institutions);
  if (broken) return { ok: false, problem: broken };

  const added = presetAdditions(before, applied.institutions, changes);
  const accountNames = ledgerAccountNames(ledger);
  const missingAccount = added.accountIds.find(
    (one) => !accountNames.has(one.accountId),
  );
  if (missingAccount) {
    return {
      ok: false,
      problem: {
        code: "unknown_ledger_account",
        message: `The ledger has no account with id ${missingAccount.accountId}.`,
        changeIndex: missingAccount.changeIndex,
      },
    };
  }
  const missingParser = added.parsers.find(
    (one) => !savedParsers.has(one.parser),
  );
  if (missingParser) {
    return {
      ok: false,
      problem: {
        code: "unknown_parser",
        message: `No saved parser is named ${missingParser.parser}, in the project's custom-built-parsers/ or among dbu6's.`,
        changeIndex: missingParser.changeIndex,
      },
    };
  }
  return { ok: true, institutions: applied.institutions };
}

async function existingParsers(
  changes: readonly ImportPresetChange[],
): Promise<Set<string>> {
  const named = new Set(
    changes.flatMap((change) =>
      change.kind === "add_parser"
        ? [change.parser]
        : change.kind === "add_institution"
          ? change.parsers
          : [],
    ),
  );
  const found = new Set<string>();
  for (const parser of named) {
    if ((await parserDirectory(parser)) !== null) found.add(parser);
  }
  return found;
}

// --- Converting user-config/import-presets.json -------------------------

export type ImportPresetsFileOutcome =
  | {
      ok: true;
      applied: boolean;
      institutions: WithLedgerNames<PresetInstitution>[];
      warnings: string[];
    }
  | { ok: false; refusal: ImportPresetsFileRefusal };

export type ImportPresetsFileRefusal =
  | { code: "no_presets_file"; message: string }
  | Extract<ImportPresetsFileConversion, { ok: false }>
  | {
      code: "presets_already_in_table" | "read_back_mismatch";
      message: string;
    }
  | ImportPresetProblem;

class ReadBackMismatch extends Error {}

/**
 * Proposes the institutions user-config/import-presets.json becomes, or with
 * `apply`, writes them into the empty table as one batch of changes, reads
 * the rows back, and deletes the file only when they match the conversion.
 * A refusal keeps the file.
 */
export async function convertImportPresetsFileInto(
  ledger: Ledger,
  { apply }: { apply: boolean },
): Promise<ImportPresetsFileOutcome> {
  const presets = await readImportPresetsFile();
  if (presets === null) {
    return {
      ok: false,
      refusal: {
        code: "no_presets_file",
        message: "user-config/import-presets.json does not exist.",
      },
    };
  }

  const accountIds = new Map(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((account) => [
      account.name,
      account.id,
    ]),
  );
  const conversion = convertImportPresetsFile(presets, accountIds);
  if (!conversion.ok) return { ok: false, refusal: conversion };
  const changes = changesAdding(conversion.institutions);
  const savedParsers = await existingParsers(changes);
  const names = ledgerAccountNames(ledger);

  if (!apply) {
    const checked = checkedChanges(ledger, [], changes, savedParsers);
    if (!checked.ok) return { ok: false, refusal: checked.problem };
    return {
      ok: true,
      applied: false,
      institutions: withLedgerNames(checked.institutions, names),
      warnings: conversion.warnings,
    };
  }

  let written: ImportInstitution[];
  try {
    const refused = ledger.db.transaction(
      (tx: any): ImportPresetsFileRefusal | null => {
        if (loadImportPresets(tx, ledger.auth).length > 0) {
          return {
            code: "presets_already_in_table",
            message:
              "The import presets table already holds presets, so the file was not converted over them. Change them with POST /api/import-presets/changes, then delete user-config/import-presets.json.",
          };
        }
        const checked = checkedChanges(ledger, [], changes, savedParsers);
        if (!checked.ok) return checked.problem;
        saveImportPresets(tx, ledger.auth, [], checked.institutions);
        written = loadImportPresets(tx, ledger.auth);
        if (!sameInstitutions(written, conversion.institutions)) {
          // Rolls the transaction back.
          throw new ReadBackMismatch();
        }
        return null;
      },
    );
    if (refused) return { ok: false, refusal: refused };
  } catch (error) {
    if (!(error instanceof ReadBackMismatch)) throw error;
    return {
      ok: false,
      refusal: {
        code: "read_back_mismatch",
        message:
          "The presets read back from the table differ from the conversion, so nothing was written and user-config/import-presets.json is kept.",
      },
    };
  }

  await deleteImportPresetsFile();
  return {
    ok: true,
    applied: true,
    institutions: withLedgerNames(written!, names),
    warnings: conversion.warnings,
  };
}

function sameInstitutions(
  written: readonly ImportInstitution[],
  converted: readonly PresetInstitution[],
): boolean {
  const withoutIds = (institutions: readonly PresetInstitution[]) =>
    JSON.stringify(institutions.map(({ id: _id, ...rest }) => rest));
  return withoutIds(written) === withoutIds(converted);
}

// --- Ledger names ------------------------------------------------------

function ledgerAccountNames(ledger: Ledger): Map<number, string> {
  return new Map(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((account) => [
      account.id,
      account.name,
    ]),
  );
}

/** An institution whose accounts carry their ledger account's name. */
type WithLedgerNames<T extends PresetInstitution> = Omit<T, "accounts"> & {
  accounts: ImportAccountView[];
};

function withLedgerNames<T extends PresetInstitution>(
  institutions: readonly T[],
  accountNames: ReadonlyMap<number, string>,
): WithLedgerNames<T>[] {
  return institutions.map((institution) => ({
    ...institution,
    accounts: institution.accounts.map((account) => ({
      ...account,
      ledger_account_name: accountNames.get(account.account_id) ?? null,
    })),
  }));
}
