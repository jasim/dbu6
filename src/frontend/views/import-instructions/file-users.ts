import type { PresetAccount } from "../categorization/CategorizationInstructions";

/** Each instruction file, with the preset accounts that list it, in order. */
export function fileUsers(
  accounts: readonly PresetAccount[],
): Map<string, PresetAccount[]> {
  const users = new Map<string, PresetAccount[]>();
  for (const one of accounts) {
    for (const filename of one.account.custom_mappings_filenames) {
      users.set(filename, [...(users.get(filename) ?? []), one]);
    }
  }
  return users;
}

/** The other accounts that list `filename`. */
export function otherUsers(
  users: ReadonlyMap<string, readonly PresetAccount[]>,
  filename: string,
  accountId: number,
): PresetAccount[] {
  return (users.get(filename) ?? []).filter(
    (one) => one.account.account_id !== accountId,
  );
}

/**
 * The other accounts whose notes are the same as `chosen`'s: the same
 * files, in the same order. None when `chosen` has no files.
 */
export function sameNotes(
  accounts: readonly PresetAccount[],
  chosen: PresetAccount,
): PresetAccount[] {
  const files = chosen.account.custom_mappings_filenames;
  if (files.length === 0) return [];
  return accounts.filter(
    (one) =>
      one.account.account_id !== chosen.account.account_id &&
      one.account.custom_mappings_filenames.length === files.length &&
      one.account.custom_mappings_filenames.every(
        (filename, index) => filename === files[index],
      ),
  );
}
