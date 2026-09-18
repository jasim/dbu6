import type { AccountType } from "../../schema/accounts.js";
import type { Abacus } from "../statement/index.js";
import { type Account, UNCATEGORIZED } from "../values/index.js";

export interface CategorizedTransaction {
  transaction: Abacus;
  account: Account;
}

// The ledger's accounts by their exact name: what an answer resolves to, and
// what the LLM is offered.
export type AccountsByName = ReadonlyMap<
  string,
  { id: number; account_type: AccountType }
>;

export interface ResolvedAccountId {
  accountId: number | null;
  sameAccountSkip: boolean;
}

// A statement never has both legs of a transfer on the same account, so a
// same-account classification is an LLM error — typically when one leg's
// narration names the *other* account (e.g. "to my <other-bank>") and the
// row itself lacks the counterparty details, so the categorizer latches
// onto the narration and echoes back the base account. Drop to
// uncategorized and let the user pick in the UI. `sameAccountSkip` tells
// the caller which nulls came from that silencing vs. plain UNCATEGORIZED.
export function resolveAccountIdForCategorized(
  account: Account,
  accountsByName: AccountsByName,
  baseAccountId: number | null,
): ResolvedAccountId {
  if (account === UNCATEGORIZED)
    return { accountId: null, sameAccountSkip: false };
  const resolvedId = accountsByName.get(account)?.id ?? null;
  if (resolvedId !== null && resolvedId === baseAccountId)
    return { accountId: null, sameAccountSkip: true };
  return { accountId: resolvedId, sameAccountSkip: false };
}
