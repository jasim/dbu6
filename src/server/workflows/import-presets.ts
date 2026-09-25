import {
  accountKindOf,
  canonicalStatementIdentifier,
  LEDGER_ACCOUNT_TYPE,
  type AccountKind,
  type ImportAccount,
  type ImportAccountView,
  type ImportInstitution,
  type ImportPresetChange,
  type ImportPresetsView,
  type StatementAccountChange,
  type StatementAccountRefusal,
  type StatementAccountRow,
  type StatementAccounts,
  type TransactionMappingsView,
} from "../../shared/index.js";
import {
  deleteAccount,
  insertAccount,
  loadAccountChart,
  loadHledgerAccountNames,
  loadLedgerAccounts,
  updateAccount,
  type ChartedAccount,
} from "../modules/accounts/index.js";
import {
  CategorizationConfigError,
  readCustomMappingsFile,
  readTransactionMappings,
  TRANSACTION_MAPPINGS_FILENAME,
} from "../modules/categorization/index.js";
import { countDraftsByAccount } from "../modules/drafts/index.js";
import { countEntriesByAccount } from "../modules/journals/index.js";
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

/**
 * The user's transaction_mappings.mjs, read now, each rule's account checked
 * against the ledger's names; or why no run can use it.
 */
export async function loadTransactionMappingsView(
  ledger: Ledger,
): Promise<TransactionMappingsView> {
  const filename = TRANSACTION_MAPPINGS_FILENAME;
  let rules;
  try {
    rules = await readTransactionMappings();
  } catch (error) {
    if (error instanceof CategorizationConfigError) {
      return { state: "unreadable", filename, error: error.message };
    }
    throw error;
  }
  const names = new Set(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((one) => one.name),
  );
  return {
    state: "read",
    filename,
    exact: Object.entries(rules.exact).map(([narration, account]) => ({
      narration,
      account,
      in_ledger: names.has(account),
    })),
    includes: rules.includes.map((rule) => ({
      account: rule.account,
      in_ledger: names.has(rule.account),
      direction: rule.direction ?? null,
      values: rule.values,
    })),
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

// --- The setup wizard's banks and cards ---------------------------------

/*
 * Each bank account or card the user gets statements for is a ledger account
 * and an entry in its institution's preset, made together: no wizard account
 * exists without a preset. One change writes the `accounts` row and runs the
 * preset changes it implies through the writer above, in one transaction, so
 * a refused preset change takes the account back out too. A row is changed
 * only while nothing is posted or drafted on its account.
 */

// The instructions a new bank or card gets, when user-config/ has them.
const DEFAULT_MAPPING_FILE = "custom_mappings_default.prompt";

export type StatementAccountProblem = {
  code: StatementAccountRefusal["code"];
  message: string;
};

export type StatementAccountOutcome =
  | { ok: true; accounts: StatementAccounts }
  | { ok: false; problem: StatementAccountProblem };

// Thrown inside the transaction, so that the account written before the
// refusal is rolled back with it.
class StatementAccountRefused extends Error {
  constructor(readonly problem: StatementAccountProblem) {
    super(problem.message);
  }
}

function refuse(code: StatementAccountProblem["code"], message: string): never {
  throw new StatementAccountRefused({ code, message });
}

/** Every preset account as the wizard lists it, and what a new one needs. */
export function loadStatementAccounts(ledger: Ledger): StatementAccounts {
  const { db, sqlite, auth } = ledger;
  const institutions = loadImportPresets(db, auth);
  const chart = loadAccountChart(db, auth);
  const byId = new Map(chart.map((account) => [account.id, account]));
  const paths = loadHledgerAccountNames(db, auth);
  const entries = countEntriesByAccount(sqlite, auth);
  const drafts = countDraftsByAccount(sqlite, auth);

  const accounts = institutions.flatMap((institution) =>
    institution.accounts.map((account): StatementAccountRow => {
      const inLedger = byId.get(account.account_id);
      const parent =
        inLedger?.parent_id == null ? undefined : byId.get(inLedger.parent_id);
      return {
        account_id: account.account_id,
        name: account.name,
        kind: accountKindOf(account.is_credit_card),
        institution: institution.name,
        account_identifiers: account.account_identifiers,
        parent: parent ? { id: parent.id, name: parent.name } : null,
        in_ledger: inLedger !== undefined,
        entries: entries.get(account.account_id) ?? 0,
        drafts: drafts.get(account.account_id) ?? 0,
      };
    }),
  );
  const choice = (account: ChartedAccount) => ({
    id: account.id,
    name: account.name,
    path: paths.get(account.name) ?? account.name,
  });
  const ofKind = (kind: AccountKind) =>
    chart.filter(
      (account) => account.account_type === LEDGER_ACCOUNT_TYPE[kind],
    );
  const defaultParent = (kind: AccountKind) =>
    accounts.find((row) => row.kind === kind && row.parent !== null)?.parent
      ?.id ?? null;
  const listed = new Set(accounts.map((row) => row.account_id));

  return {
    institutions: institutions.map(({ name, parsers }) => ({ name, parsers })),
    accounts,
    parents: {
      bank: ofKind("bank").map(choice),
      card: ofKind("card").map(choice),
    },
    default_parents: {
      bank: defaultParent("bank"),
      card: defaultParent("card"),
    },
    unlisted: (["bank", "card"] as const).flatMap((kind) =>
      ofKind(kind)
        .filter((account) => !listed.has(account.id))
        .map((account) => ({ ...choice(account), kind })),
    ),
  };
}

/** Creates, changes or removes one bank or card, or says why it can't. */
export async function changeStatementAccount(
  ledger: Ledger,
  change: StatementAccountChange,
): Promise<StatementAccountOutcome> {
  const mappingFiles =
    readCustomMappingsFile(DEFAULT_MAPPING_FILE) === null
      ? []
      : [DEFAULT_MAPPING_FILE];
  try {
    ledger.db.transaction((tx: any) => {
      const before = loadImportPresets(tx, ledger.auth);
      const changes = writeStatementAccount(
        { ...ledger, db: tx },
        before,
        change,
        mappingFiles,
      );
      // No change here adds a parser, so none is looked up.
      const checked = checkedChanges(ledger, before, changes, new Set());
      if (!checked.ok) refuse(checked.problem.code, checked.problem.message);
      saveImportPresets(tx, ledger.auth, before, checked.institutions);
    });
  } catch (error) {
    if (error instanceof StatementAccountRefused) {
      return { ok: false, problem: error.problem };
    }
    throw error;
  }
  return { ok: true, accounts: loadStatementAccounts(ledger) };
}

// Writes the ledger side of `change` inside the transaction `ledger.db` is,
// and returns the preset changes it takes.
function writeStatementAccount(
  ledger: Ledger,
  before: readonly ImportInstitution[],
  change: StatementAccountChange,
  mappingFiles: string[],
): ImportPresetChange[] {
  const { db: tx, auth } = ledger;
  const chart = loadAccountChart(tx, auth);
  const byId = new Map(chart.map((account) => [account.id, account]));
  const listed = new Map(
    before.flatMap((institution) =>
      institution.accounts.map(
        (account) => [account.account_id, { institution, account }] as const,
      ),
    ),
  );
  const institutionChanges = (name: string): ImportPresetChange[] =>
    before.some((institution) => institution.name === name)
      ? []
      : [{ kind: "add_institution", name, parsers: [] }];

  if (change.action === "create") {
    const identifier = typedIdentifier(change.kind, change.identifier);
    let account: ChartedAccount;
    if (change.ledger.source === "new") {
      const { name, parent_id } = change.ledger;
      checkNameFree(chart, name, null);
      checkParent(byId.get(parent_id), change.kind);
      account = insertAccount(tx, auth, {
        name,
        account_type: LEDGER_ACCOUNT_TYPE[change.kind],
        parent_id,
      });
    } else {
      const existing = byId.get(change.ledger.account_id);
      if (
        existing === undefined ||
        existing.account_type !== LEDGER_ACCOUNT_TYPE[change.kind]
      ) {
        refuse(
          "account_not_suitable",
          `A ${change.kind === "card" ? "card" : "bank account"} has to be ${LEDGER_ACCOUNT_TYPE[change.kind] === "Asset" ? "an Asset" : "a Liability"} account in your books.`,
        );
      }
      if (listed.has(existing.id)) {
        refuse(
          "account_not_suitable",
          `${existing.name} is already one of your banks and cards.`,
        );
      }
      account = existing;
    }
    return [
      ...institutionChanges(change.institution),
      {
        kind: "add_account",
        institution: change.institution,
        account_id: account.id,
        name: account.name,
        is_credit_card: change.kind === "card",
        account_identifiers: identifier === null ? [] : [identifier],
        custom_mappings_filenames: mappingFiles,
      },
    ];
  }

  const entry = listed.get(change.account_id);
  if (entry === undefined) {
    refuse(
      "unknown_account",
      `No bank or card has the account id ${change.account_id}.`,
    );
  }
  checkNoTransactions(ledger, entry.account);
  const account = byId.get(change.account_id);

  if (change.action === "remove") {
    if (change.delete_account && account !== undefined) {
      if (chart.some((one) => one.parent_id === account.id)) {
        refuse(
          "account_has_children",
          `${account.name} has accounts under it, so it stays in your books; only its statements are no longer set up.`,
        );
      }
      deleteAccount(tx, auth, account.id);
    }
    return [{ kind: "remove_account", account_id: change.account_id }];
  }

  if (account === undefined) {
    refuse(
      "account_not_suitable",
      `Your books no longer have ${entry.account.name}; remove it and add it again.`,
    );
  }
  const identifier = typedIdentifier(change.kind, change.identifier);
  checkNameFree(chart, change.name, account.id);
  checkParent(byId.get(change.parent_id), change.kind, account, chart);
  const accountType = LEDGER_ACCOUNT_TYPE[change.kind];
  if (
    accountType !== account.account_type &&
    chart.some((one) => one.parent_id === account.id)
  ) {
    refuse(
      "account_has_children",
      `${account.name} has accounts under it, so it can't change from a bank account to a card or back.`,
    );
  }
  updateAccount(tx, auth, account.id, {
    name: change.name,
    account_type: accountType,
    parent_id: change.parent_id,
  });

  const [, ...others] = entry.account.account_identifiers;
  const identifiers =
    identifier === null
      ? others
      : [identifier, ...others.filter((one) => one !== identifier)];
  const fields = {
    name: change.name,
    is_credit_card: change.kind === "card",
    account_identifiers: identifiers,
  };
  if (entry.institution.name === change.institution) {
    return [{ kind: "update_account", account_id: account.id, ...fields }];
  }
  return [
    { kind: "remove_account", account_id: account.id },
    ...institutionChanges(change.institution),
    {
      kind: "add_account",
      institution: change.institution,
      account_id: account.id,
      ...fields,
      custom_mappings_filenames: entry.account.custom_mappings_filenames,
    },
  ];
}

// The number in canonical form, null when none was typed.
function typedIdentifier(
  kind: AccountKind,
  typed: string | null,
): string | null {
  if (typed === null || typed.trim() === "") return null;
  const identifier = canonicalStatementIdentifier(kind, typed);
  if (identifier === null) {
    refuse(
      "identifier_invalid",
      kind === "card"
        ? `"${typed}" isn't a card number as a statement prints it: digits with the hidden ones as X, such as 050505XXXXXX0505.`
        : `"${typed}" isn't an account number: digits only.`,
    );
  }
  return identifier;
}

function checkNameFree(
  chart: readonly ChartedAccount[],
  name: string,
  self: number | null,
): void {
  if (chart.some((account) => account.name === name && account.id !== self)) {
    refuse(
      "ledger_name_taken",
      `Your books already have an account named ${name}.`,
    );
  }
}

// A parent of the kind's type, and not the account or one under it.
function checkParent(
  parent: ChartedAccount | undefined,
  kind: AccountKind,
  account?: ChartedAccount,
  chart: readonly ChartedAccount[] = [],
): void {
  const type = LEDGER_ACCOUNT_TYPE[kind];
  if (parent === undefined || parent.account_type !== type) {
    refuse(
      "parent_not_suitable",
      `A ${kind === "card" ? "card" : "bank account"} sits under ${type === "Asset" ? "an Asset" : "a Liability"} account.`,
    );
  }
  if (account === undefined) return;
  const parentOf = new Map(chart.map((one) => [one.id, one.parent_id]));
  for (
    let at: number | null = parent.id;
    at !== null;
    at = parentOf.get(at) ?? null
  ) {
    if (at === account.id) {
      refuse(
        "parent_not_suitable",
        `${account.name} can't sit under itself or an account under it.`,
      );
    }
  }
}

function checkNoTransactions(ledger: Ledger, account: ImportAccount): void {
  const entries =
    countEntriesByAccount(ledger.sqlite, ledger.auth).get(account.account_id) ??
    0;
  const drafts =
    countDraftsByAccount(ledger.sqlite, ledger.auth).get(account.account_id) ??
    0;
  if (entries + drafts > 0) {
    refuse(
      "account_has_transactions",
      `${account.name} has ${[
        entries > 0 ? `${entries} ${entries === 1 ? "entry" : "entries"}` : "",
        drafts > 0 ? `${drafts} ${drafts === 1 ? "draft" : "drafts"}` : "",
      ]
        .filter(Boolean)
        .join(
          " and ",
        )}, so it is changed on the Accounts page and its preset through the presets API, not here.`,
    );
  }
}
