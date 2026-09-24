import {
  accountKindOf,
  accountKindOfType,
  type AccountKind,
  type ImportAccount,
  type ImportInstitution,
} from "../../shared/index.js";

/*
 * What the everyday screens call a ledger account (PLAN.md §11 P1, P3). A
 * bank or card an import preset lists is named by the preset's account, found
 * by its ledger id; any other account by its own name. The account's name
 * stays in `title` attributes.
 */

export interface AccountLabel {
  name: string;
  kind: AccountKind;
}

/**
 * Every account of the presets, in table order: the accounts Home lists,
 * whether or not the ledger still has them.
 */
export function importableAccounts(
  institutions: readonly ImportInstitution[],
): ImportAccount[] {
  return institutions.flatMap((institution) => institution.accounts);
}

/**
 * The name and kind of a ledger account, by its id. A preset account gives
 * its name and whether it is a card; any other account keeps its own name,
 * and its kind is read from its type.
 */
export function accountLabel(
  account: { id: number; name: string; account_type: string | null },
  institutions: readonly ImportInstitution[],
): AccountLabel {
  const preset = importableAccounts(institutions).find(
    (one) => one.account_id === account.id,
  );
  if (preset) {
    return { name: preset.name, kind: accountKindOf(preset.is_credit_card) };
  }
  return { name: account.name, kind: accountKindOfType(account.account_type) };
}
