import type { Ledger } from "../ledger-sql/index.js";
import {
  countOwnEntriesByAccount,
  loadOpeningEntries,
} from "../journals/index.js";
import { loadDraftStatus } from "./draft-status.js";

/**
 * What a bank or card holds so far: posted entries (its opening entry left
 * out) and drafts from its own statements.
 */
export interface StatementActivity {
  entries: number;
  drafts: number;
}

/**
 * Whether a bank or card's first statement is in: it has entries or drafts.
 * It is then `in_books` at /add, Home counts it imported, and Settings ›
 * Banks & cards no longer changes or removes it.
 */
export function hasTransactions(activity: StatementActivity): boolean {
  return activity.entries > 0 || activity.drafts > 0;
}

/**
 * Each account's own entries (`countOwnEntriesByAccount`), its opening entry
 * on Opening Balances left out, and the drafts from its own statements. The one rule for whether
 * a bank or card is imported: /add's reading, Home's "nothing imported yet"
 * and Settings › Banks & cards' lock all read it.
 */
export function loadStatementActivity(
  ledger: Pick<Ledger, "sqlite" | "auth">,
): (accountId: number) => StatementActivity {
  const { sqlite, auth } = ledger;
  // Its own: a card payment another account's import posted to it is not
  // this account's statement.
  const entries = countOwnEntriesByAccount(sqlite, auth);
  const openings = loadOpeningEntries(sqlite, auth);
  const drafts = loadDraftStatus(sqlite, auth);
  return (accountId) => ({
    entries:
      (entries.get(accountId) ?? 0) -
      (openings.get(accountId)?.onOpeningBalances ? 1 : 0),
    drafts: drafts.get(accountId)?.drafts ?? 0,
  });
}
