import type {
  ImportInstitution,
  ImportPresetChange,
  ImportPresetRefusalCode,
} from "../../../shared/index.js";

/*
 * The import presets' rules and their changes, over the whole table and
 * without the database: `applyImportPresetChanges` applies a batch in order,
 * `validateImportPresets` checks the table it leaves, and `presetAdditions`
 * says what the batch added, which the writer checks against the ledger and
 * the saved parsers (workflows/import-presets.ts).
 */

/** An institution as a batch leaves it: a new one has no id until written. */
export type PresetInstitution = Omit<ImportInstitution, "id"> & {
  id: number | null;
};

/** Why the presets refuse a batch, and the change it is about, if one. */
export interface ImportPresetProblem {
  code: ImportPresetRefusalCode;
  message: string;
  /** The change's place in the batch; null for the table the batch leaves. */
  changeIndex: number | null;
}

export type AppliedPresetChanges =
  | { ok: true; institutions: PresetInstitution[] }
  | { ok: false; problem: ImportPresetProblem };

/**
 * The table after `changes`, applied in order. Refuses a change that names an
 * institution or account the table doesn't hold at that point, and removing
 * an institution that still has accounts. The rules over the whole table are
 * `validateImportPresets`'s.
 */
export function applyImportPresetChanges(
  institutions: readonly PresetInstitution[],
  changes: readonly ImportPresetChange[],
): AppliedPresetChanges {
  const table: PresetInstitution[] = structuredClone([...institutions]);

  for (const [index, change] of changes.entries()) {
    const refuse = (
      code: ImportPresetRefusalCode,
      message: string,
    ): AppliedPresetChanges => ({
      ok: false,
      problem: { code, message, changeIndex: index },
    });
    const institutionNamed = (name: string) =>
      table.find((institution) => institution.name === name);
    const accountWithId = (accountId: number) => {
      for (const institution of table) {
        const account = institution.accounts.find(
          (one) => one.account_id === accountId,
        );
        if (account) return { institution, account };
      }
      return null;
    };

    switch (change.kind) {
      case "add_institution":
        table.push({
          id: null,
          name: change.name,
          parsers: [...change.parsers],
          accounts: [],
        });
        break;

      case "rename_institution": {
        const institution = institutionNamed(change.institution);
        if (!institution)
          return refuse(...unknownInstitution(change.institution));
        institution.name = change.new_name;
        break;
      }

      case "remove_institution": {
        const institution = institutionNamed(change.institution);
        if (!institution)
          return refuse(...unknownInstitution(change.institution));
        if (institution.accounts.length > 0) {
          return refuse(
            "institution_has_accounts",
            `"${institution.name}" still has ${describeCount(institution.accounts.length, "account")} (${institution.accounts.map((one) => one.name).join(", ")}). Remove them first.`,
          );
        }
        table.splice(table.indexOf(institution), 1);
        break;
      }

      case "add_parser": {
        const institution = institutionNamed(change.institution);
        if (!institution)
          return refuse(...unknownInstitution(change.institution));
        institution.parsers.push(change.parser);
        break;
      }

      case "remove_parser": {
        const institution = institutionNamed(change.institution);
        if (!institution)
          return refuse(...unknownInstitution(change.institution));
        const at = institution.parsers.indexOf(change.parser);
        if (at === -1) {
          return refuse(
            "parser_not_listed",
            `"${institution.name}" does not list the parser ${change.parser}.`,
          );
        }
        institution.parsers.splice(at, 1);
        break;
      }

      case "add_account": {
        const institution = institutionNamed(change.institution);
        if (!institution)
          return refuse(...unknownInstitution(change.institution));
        institution.accounts.push({
          account_id: change.account_id,
          name: change.name,
          is_credit_card: change.is_credit_card,
          account_identifiers: [...change.account_identifiers],
          custom_mappings_filenames: [...change.custom_mappings_filenames],
        });
        break;
      }

      case "update_account": {
        const found = accountWithId(change.account_id);
        if (!found) return refuse(...unknownAccount(change.account_id));
        const { account } = found;
        if (change.name !== undefined) account.name = change.name;
        if (change.is_credit_card !== undefined) {
          account.is_credit_card = change.is_credit_card;
        }
        if (change.account_identifiers !== undefined) {
          account.account_identifiers = [...change.account_identifiers];
        }
        if (change.custom_mappings_filenames !== undefined) {
          account.custom_mappings_filenames = [
            ...change.custom_mappings_filenames,
          ];
        }
        break;
      }

      case "remove_account": {
        const found = accountWithId(change.account_id);
        if (!found) return refuse(...unknownAccount(change.account_id));
        found.institution.accounts.splice(
          found.institution.accounts.indexOf(found.account),
          1,
        );
        break;
      }
    }
  }

  return { ok: true, institutions: table };
}

function unknownInstitution(name: string): [ImportPresetRefusalCode, string] {
  return ["unknown_institution", `No institution is named "${name}".`];
}

function unknownAccount(accountId: number): [ImportPresetRefusalCode, string] {
  return [
    "unknown_account",
    `No institution lists an account with account_id ${accountId}.`,
  ];
}

function describeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Every way the table breaks the presets' rules, in table order. The rules
 * hold for every table the writer stores, so a problem here is always one the
 * batch being written brought in.
 *
 * 1. Institution names are non-empty and unique.
 * 2. An institution lists a parser once, and a parser is in one institution.
 * 3. An account_id appears once in the whole table.
 * 4. Account names are non-empty and unique in the whole table.
 * 5. Within an institution, no identifier is on two accounts; with more than
 *    one account, each account has an identifier.
 * 6. An account lists a mapping file once.
 */
export function validateImportPresets(
  institutions: readonly PresetInstitution[],
): ImportPresetProblem[] {
  const problems: ImportPresetProblem[] = [];
  const problem = (code: ImportPresetRefusalCode, message: string) =>
    problems.push({ code, message, changeIndex: null });

  const institutionNames = new Set<string>();
  const parserInstitution = new Map<string, string>();
  const accountIds = new Map<number, string>();
  const accountNames = new Set<string>();

  for (const institution of institutions) {
    // Rule 1.
    if (institution.name.trim() === "") {
      problem("institution_name_empty", "An institution has an empty name.");
    } else if (institutionNames.has(institution.name)) {
      problem(
        "institution_name_taken",
        `Two institutions are named "${institution.name}".`,
      );
    }
    institutionNames.add(institution.name);

    // Rule 2.
    const listed = new Set<string>();
    for (const parser of institution.parsers) {
      if (listed.has(parser)) {
        problem(
          "parser_listed_twice",
          `"${institution.name}" lists the parser ${parser} twice.`,
        );
        continue;
      }
      listed.add(parser);
      const other = parserInstitution.get(parser);
      if (other !== undefined) {
        problem(
          "parser_in_two_institutions",
          `The parser ${parser} is listed by both "${other}" and "${institution.name}"; a parser belongs to one institution.`,
        );
      } else {
        parserInstitution.set(parser, institution.name);
      }
    }

    const identifierAccount = new Map<string, string>();
    for (const account of institution.accounts) {
      // Rule 3.
      const holder = accountIds.get(account.account_id);
      if (holder !== undefined) {
        problem(
          "account_listed_twice",
          `account_id ${account.account_id} is listed twice, as "${holder}" and as "${account.name}".`,
        );
      }
      accountIds.set(account.account_id, account.name);

      // Rule 4.
      if (account.name.trim() === "") {
        problem(
          "account_name_empty",
          `The account with account_id ${account.account_id} in "${institution.name}" has an empty name.`,
        );
      } else if (accountNames.has(account.name)) {
        problem(
          "account_name_taken",
          `Two accounts are named "${account.name}".`,
        );
      }
      accountNames.add(account.name);

      // Rule 5.
      for (const identifier of new Set(account.account_identifiers)) {
        const other = identifierAccount.get(identifier);
        if (other !== undefined) {
          problem(
            "identifier_on_two_accounts",
            `The identifier ${identifier} is on both "${other}" and "${account.name}" in "${institution.name}".`,
          );
        } else {
          identifierAccount.set(identifier, account.name);
        }
      }
      if (
        institution.accounts.length > 1 &&
        account.account_identifiers.length === 0
      ) {
        problem(
          "account_identifier_required",
          `"${institution.name}" has ${describeCount(institution.accounts.length, "account")}, so each needs the identifier its statements print, and "${account.name}" has none.`,
        );
      }

      // Rule 6.
      const files = new Set<string>();
      for (const filename of account.custom_mappings_filenames) {
        if (files.has(filename)) {
          problem(
            "mapping_file_listed_twice",
            `"${account.name}" lists ${filename} twice.`,
          );
        }
        files.add(filename);
      }
    }
  }

  return problems;
}

/** What a batch added: ledger ids and parsers the table before it lacked. */
export interface PresetAdditions {
  accountIds: { accountId: number; changeIndex: number | null }[];
  parsers: { parser: string; changeIndex: number | null }[];
}

/**
 * The account ids and parsers `after` holds and `before` did not, each with
 * the first change that brought it in. Only these are checked against the
 * ledger and the saved parsers, so an account or parser deleted since it was
 * listed never blocks an unrelated write.
 */
export function presetAdditions(
  before: readonly PresetInstitution[],
  after: readonly PresetInstitution[],
  changes: readonly ImportPresetChange[],
): PresetAdditions {
  const had = {
    accountIds: new Set(
      before.flatMap((one) => one.accounts.map((a) => a.account_id)),
    ),
    parsers: new Set(before.flatMap((one) => one.parsers)),
  };
  const firstChange = (matches: (change: ImportPresetChange) => boolean) => {
    const index = changes.findIndex(matches);
    return index === -1 ? null : index;
  };

  const accountIds = new Set(
    after.flatMap((one) => one.accounts.map((a) => a.account_id)),
  );
  const parsers = new Set(after.flatMap((one) => one.parsers));
  return {
    accountIds: [...accountIds]
      .filter((accountId) => !had.accountIds.has(accountId))
      .map((accountId) => ({
        accountId,
        changeIndex: firstChange(
          (change) =>
            change.kind === "add_account" && change.account_id === accountId,
        ),
      })),
    parsers: [...parsers]
      .filter((parser) => !had.parsers.has(parser))
      .map((parser) => ({
        parser,
        changeIndex: firstChange(
          (change) =>
            (change.kind === "add_parser" && change.parser === parser) ||
            (change.kind === "add_institution" &&
              change.parsers.includes(parser)),
        ),
      })),
  };
}
