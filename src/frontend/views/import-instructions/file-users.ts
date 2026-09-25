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

/** The names of the other accounts that list `filename`. */
export function otherUsers(
  users: ReadonlyMap<string, readonly PresetAccount[]>,
  filename: string,
  accountId: number,
): string[] {
  return (users.get(filename) ?? [])
    .filter((one) => one.account.account_id !== accountId)
    .map((one) => one.account.name);
}
