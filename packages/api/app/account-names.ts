import {
  accountKindOf,
  accountKindOfType,
  type AccountKind,
  type ImportPreset,
} from "dbu6-shared";

/*
 * What the everyday screens call a ledger account (PLAN.md §11 P1, P3). A
 * bank or card is named by the import preset that imports into it; any other
 * account by its own name. The account's name stays in `title` attributes.
 */

export interface AccountLabel {
  name: string;
  kind: AccountKind;
}

/**
 * The unique base accounts across the presets, in first-seen order: the
 * accounts Home lists, whether or not the ledger has them yet.
 */
export function importablePaths(presets: readonly ImportPreset[]): string[] {
  return Array.from(new Set(presets.map((preset) => preset.base_account)));
}

/**
 * The name and kind of any account, by its name in the ledger. An account
 * named by one preset takes that preset's name; one shared by several (two
 * parsers for one bank) keeps its own name. It is a card when any preset
 * importing into it says so; otherwise the kind is read from the ledger
 * account's type, and an account the ledger doesn't have (a null type) is a
 * bank account.
 */
export function accountLabel(
  path: string,
  accountType: string | null,
  presets: readonly ImportPreset[],
): AccountLabel {
  const own = presets.filter((preset) => preset.base_account === path);
  const names = new Set(own.map((preset) => preset.name));
  return {
    name: names.size === 1 ? Array.from(names)[0] : path,
    kind: own.some((preset) => accountKindOf(preset.is_credit_card) === "card")
      ? "card"
      : accountKindOfType(accountType),
  };
}
