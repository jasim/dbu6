import type {
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
  parserDirectory,
  presetAdditions,
  validateImportPresets,
  type ImportPresetProblem,
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
 * A refused batch writes nothing.
 */

export type ImportPresetsChangeOutcome =
  | { ok: true; presets: ImportPresetsView }
  | { ok: false; problem: ImportPresetProblem };

/** The presets, each account with its ledger account's name if it has one. */
export function loadImportPresetsView(ledger: Ledger): ImportPresetsView {
  return viewOf(
    loadImportPresets(ledger.db, ledger.auth),
    ledgerAccountNames(ledger),
  );
}

export async function changeImportPresets(
  ledger: Ledger,
  changes: readonly ImportPresetChange[],
): Promise<ImportPresetsChangeOutcome> {
  // Looking a parser up reads the disk, which a SQLite transaction can't
  // wait for, so every parser the batch names is looked up first.
  const savedParsers = await existingParsers(changes);

  const outcome = ledger.db.transaction(
    (tx: any): ImportPresetsChangeOutcome | { ok: true; presets: null } => {
      const before = loadImportPresets(tx, ledger.auth);
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

      saveImportPresets(tx, ledger.auth, before, applied.institutions);
      return { ok: true, presets: null };
    },
  );
  if (!outcome.ok) return outcome;
  return { ok: true, presets: loadImportPresetsView(ledger) };
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

function ledgerAccountNames(ledger: Ledger): Map<number, string> {
  return new Map(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((account) => [
      account.id,
      account.name,
    ]),
  );
}

function viewOf(
  institutions: readonly ImportInstitution[],
  accountNames: ReadonlyMap<number, string>,
): ImportPresetsView {
  return {
    institutions: institutions.map((institution) => ({
      ...institution,
      accounts: institution.accounts.map((account) => ({
        ...account,
        ledger_account_name: accountNames.get(account.account_id) ?? null,
      })),
    })),
  };
}
