import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  homeContract,
  type HomeAccount,
  type HomeSummary,
  type ImportPreset,
} from "dbu6-shared";
import { readImportPresets } from "../bank-importer/import-presets.js";
import { importableAccounts } from "./account-names.js";
import { loadDraftStatus } from "./draft-status.js";
import { loadLastReconciled } from "./reports/last-reconciled.js";
import { allRows, ledgerCtes, type ScopeParams } from "./reports/shared.js";
import { requireWorkflowAuth, requireWorkflowScope } from "./workflow-auth.js";

/*
 * The Home screen's one request (PLAN.md §11 P1): the importable accounts
 * with where their books stand, and what waits in the drafts. The drafts'
 * counts come from the draft status module, which Review, the posting gate
 * and the draft reports read too, so none of them can disagree.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("summary", homeContract.summary, async ({ c }) => {
  requireWorkflowAuth(c);
  const scope = requireWorkflowScope(c);
  const presets = await readImportPresets();
  return {
    status: 200,
    body: loadHomeSummary(c.get("sqlite"), scope, presets),
  };
});

export default api;

export function loadHomeSummary(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
): HomeSummary {
  const ledgerIds = new Map(
    allRows<{ id: number; name: string }>(
      sqlite,
      `${ledgerCtes} SELECT id, name FROM scoped_accounts`,
      scope,
    ).map((row) => [row.name, row.id]),
  );
  const checkpoints = new Map(
    loadLastReconciled(sqlite, scope).map((row) => [row.account_id, row]),
  );
  const drafts = loadDraftStatus(sqlite, scope);
  const pending = Array.from(drafts.values());
  const journalAccounts = new Set(
    allRows<{ account_id: number }>(
      sqlite,
      `${ledgerCtes} SELECT DISTINCT account_id FROM scoped_journal_entries`,
      scope,
    ).map((row) => row.account_id),
  );

  const accounts: HomeAccount[] = importableAccounts(presets)
    .map((account) => {
      const id = ledgerIds.get(account.path) ?? null;
      const checkpoint = id === null ? undefined : checkpoints.get(id);
      const status = id === null ? undefined : drafts.get(id);
      return {
        account_id: id,
        path: account.path,
        name: account.name,
        kind: account.kind,
        checked_to: checkpoint?.last_reconciled_date ?? null,
        checked_balance: checkpoint?.last_balance ?? null,
        drafts: status?.drafts ?? 0,
        uncategorised: status?.uncategorised ?? 0,
        duplicates: status?.duplicates.length ?? 0,
        failing_checks: status?.failing.length ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    accounts,
    totals: {
      drafts: sum(pending.map((row) => row.drafts)),
      uncategorised: sum(pending.map((row) => row.uncategorised)),
      duplicates: sum(pending.map((row) => row.duplicates.length)),
      failing_checks: sum(pending.map((row) => row.failing.length)),
    },
    has_journals: accounts.some(
      (account) =>
        account.account_id !== null && journalAccounts.has(account.account_id),
    ),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
