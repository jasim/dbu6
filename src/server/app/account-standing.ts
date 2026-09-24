import type Database from "better-sqlite3";
import type { DatedBalance, ImportInstitution } from "../../shared/index.js";
import { accountLabel, type AccountLabel } from "./account-names.js";
import {
  loadDraftStatus,
  type DraftAccountStatus,
} from "../modules/drafts/index.js";
import { loadLastReconciled } from "../modules/journals/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import { countPostedAssertionFailures } from "../modules/reconciliation/index.js";
import { loadLedgerAccounts } from "../modules/accounts/index.js";

/*
 * Where each ledger account stands (PLAN.md §11 P1, P3): what the everyday
 * screens call it, its last posted balance check, the posted checks its books
 * miss, and what waits in its drafts. Home and Review both project their rows
 * from this, so an account's name, kind and checkpoint read the same on both.
 */

export interface AccountStanding extends AccountLabel {
  account_id: number;
  path: string;
  /** The last posted balance assertion; null before the first. */
  checkpoint: DatedBalance | null;
  /** Posted balance assertions its running balance misses. */
  statement_differences: number;
  /** What waits in its drafts; undefined when it has none. */
  drafts: DraftAccountStatus | undefined;
}

/** Every account in scope, by id. */
export function loadAccountStandings(
  sqlite: Database.Database,
  auth: LedgerAuth,
  institutions: readonly ImportInstitution[],
): Map<number, AccountStanding> {
  const checkpoints = new Map(
    loadLastReconciled(sqlite, auth).map((row) => [
      row.account_id,
      { date: row.last_reconciled_date, balance: row.last_balance },
    ]),
  );
  const differences = countPostedAssertionFailures(sqlite, auth);
  const drafts = loadDraftStatus(sqlite, auth);
  return new Map(
    loadLedgerAccounts(sqlite, auth).map((account) => [
      account.id,
      {
        account_id: account.id,
        path: account.name,
        ...accountLabel(account, institutions),
        checkpoint: checkpoints.get(account.id) ?? null,
        statement_differences: differences.get(account.id) ?? 0,
        drafts: drafts.get(account.id),
      },
    ]),
  );
}
