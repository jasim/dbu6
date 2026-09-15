import {
  accountKindOf,
  accountKindOfType,
  accountPathName,
  type AccountKind,
  type ImportPreset,
} from "dbu6-shared";

/*
 * What the everyday screens call a ledger account (PLAN.md §11 P1, P3). A
 * bank or card is named by the import preset that imports into it; any other
 * account by the last segment of its path, made readable. The path itself
 * stays in `title` attributes.
 */

export interface AccountLabel {
  name: string;
  kind: AccountKind;
}

/** An account at least one preset imports into, with its display name. */
export interface ImportableAccount extends AccountLabel {
  path: string;
}

/**
 * The unique base accounts across the presets, in first-seen order. An
 * account named by one preset takes that preset's name; one shared by
 * several (two parsers for one bank) falls back to its own last segment.
 * It is a card when any preset importing into it says so.
 */
export function importableAccounts(
  presets: readonly ImportPreset[],
): ImportableAccount[] {
  const paths = Array.from(new Set(presets.map((p) => p.base_account)));
  return paths.map((path) => ({
    path,
    ...presetLabel(path, presets, "bank"),
  }));
}

/**
 * The name and kind of any ledger account. Without a preset saying
 * otherwise, the kind is read from the account's type.
 */
export function accountLabel(
  path: string,
  accountType: string | null,
  presets: readonly ImportPreset[],
): AccountLabel {
  return presetLabel(path, presets, accountKindOfType(accountType));
}

function presetLabel(
  path: string,
  presets: readonly ImportPreset[],
  fallbackKind: AccountKind,
): AccountLabel {
  const own = presets.filter((preset) => preset.base_account === path);
  const names = new Set(own.map((preset) => preset.name));
  return {
    name: names.size === 1 ? Array.from(names)[0] : accountPathName(path),
    kind: own.some((preset) => accountKindOf(preset.is_credit_card) === "card")
      ? "card"
      : fallbackKind,
  };
}
