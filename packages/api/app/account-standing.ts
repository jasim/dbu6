import type Database from "better-sqlite3";
import type { DatedBalance, ImportPreset } from "dbu6-shared";
import { accountLabel, type AccountLabel } from "./account-names.js";
import {
  loadDraftStatus,
  type DraftAccountStatus,
} from "../modules/drafts/index.js";
import { loadLastReconciled } from "../modules/journals/index.js";
import type { ScopeParams } from "../modules/ledger-sql/index.js";
import { loadLedgerAccounts } from "../modules/accounts/index.js";

/*
 * Where each ledger account stands (PLAN.md §11 P1, P3): what the everyday
 * screens call it, its last posted balance check, and what waits in its
 * drafts. Home and Review both project their rows from this, so an account's
 * name, kind and checkpoint read the same on both.
 */

export interface AccountStanding extends AccountLabel {
  account_id: number;
  path: string;
  /** The last posted balance assertion; null before the first. */
  checkpoint: DatedBalance | null;
  /** What waits in its drafts; undefined when it has none. */
  drafts: DraftAccountStatus | undefined;
}

/** Every account in scope, by id. */
export function loadAccountStandings(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
): Map<number, AccountStanding> {
  const checkpoints = new Map(
    loadLastReconciled(sqlite, scope).map((row) => [
      row.account_id,
      { date: row.last_reconciled_date, balance: row.last_balance },
    ]),
  );
  const drafts = loadDraftStatus(sqlite, scope);
  return new Map(
    loadLedgerAccounts(sqlite, scope).map((account) => [
      account.id,
      {
        account_id: account.id,
        path: account.name,
        ...accountLabel(account.name, account.account_type, presets),
        checkpoint: checkpoints.get(account.id) ?? null,
        drafts: drafts.get(account.id),
      },
    ]),
  );
}
