import type { ReportLedger } from "../../report-kit.js";

/** An account in scope, with its parent path ("Expenses > Kitchen"). */
export type PathedAccount = {
  id: number;
  name: string;
  /** Null for a top account. */
  parent_path: string | null;
};

/**
 * Every account in scope with its parent path, from one read: for a Checks
 * report whose rows come from a domain module that names its accounts
 * without their paths. A report with its own SQL joins
 * `scoped_account_paths` instead.
 */
export function loadPathedAccounts(ledger: ReportLedger): PathedAccount[] {
  return ledger.all<PathedAccount>(
    `SELECT a.id, a.name, ap.parent_path
     FROM scoped_accounts a
     LEFT JOIN scoped_account_paths ap ON ap.id = a.id`,
  );
}
