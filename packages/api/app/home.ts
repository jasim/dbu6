import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  homeContract,
  NO_DRAFTS,
  type DraftCounts,
  type HomeAccount,
  type HomeSummary,
  type ImportPreset,
} from "dbu6-shared";
import { readImportPresets } from "../modules/statement-sources/index.js";
import { accountLabel, importablePaths } from "./account-names.js";
import { loadAccountStandings } from "./account-standing.js";
import { draftCounts } from "../modules/drafts/index.js";
import { allRows, type LedgerAuth } from "../modules/ledger-sql/index.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

/*
 * The Home screen's one request (PLAN.md §11 P1): the importable accounts
 * with where their books stand, and what waits in the drafts. Each account is
 * projected from its standing, which Review reads too, so the two screens
 * name, count and check it the same way.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("summary", homeContract.summary, async ({ c }) => {
  const auth = requireWorkflowAuth(c);
  const presets = await readImportPresets();
  return {
    status: 200,
    body: loadHomeSummary(c.get("sqlite"), auth, presets),
  };
});

export default api;

export function loadHomeSummary(
  sqlite: Database.Database,
  auth: LedgerAuth,
  presets: readonly ImportPreset[],
): HomeSummary {
  const standings = Array.from(
    loadAccountStandings(sqlite, auth, presets).values(),
  );
  const byPath = new Map(
    standings.map((standing) => [standing.path, standing]),
  );
  const journalAccounts = new Set(
    allRows<{ account_id: number }>(
      sqlite,
      auth,
      `SELECT DISTINCT account_id FROM scoped_journal_entries`,
    ).map((row) => row.account_id),
  );

  const accounts = importablePaths(presets)
    .map((path): HomeAccount => {
      const standing = byPath.get(path);
      if (standing === undefined) {
        return { in_ledger: false, path, ...accountLabel(path, null, presets) };
      }
      return {
        in_ledger: true,
        account_id: standing.account_id,
        path,
        name: standing.name,
        kind: standing.kind,
        checkpoint: standing.checkpoint,
        ...draftCounts(standing.drafts),
      };
    })
    .sort(byLastAssertion);

  return {
    accounts,
    totals: standings
      .map((standing) => draftCounts(standing.drafts))
      .reduce(addCounts, NO_DRAFTS),
    has_journals: accounts.some(
      (account) => account.in_ledger && journalAccounts.has(account.account_id),
    ),
  };
}

/**
 * The account whose statements were last imported longest ago comes first:
 * accounts with no posted balance assertion (missing from the ledger, then
 * never imported), then by the assertion's date, then by name.
 */
function byLastAssertion(a: HomeAccount, b: HomeAccount): number {
  return (
    assertionRank(a) - assertionRank(b) ||
    assertionDate(a).localeCompare(assertionDate(b)) ||
    a.name.localeCompare(b.name)
  );
}

function assertionRank(account: HomeAccount): number {
  if (!account.in_ledger) return 0;
  return account.checkpoint === null ? 1 : 2;
}

function assertionDate(account: HomeAccount): string {
  return (account.in_ledger && account.checkpoint?.date) || "";
}

function addCounts(a: DraftCounts, b: DraftCounts): DraftCounts {
  return {
    drafts: a.drafts + b.drafts,
    uncategorised: a.uncategorised + b.uncategorised,
    duplicates: a.duplicates + b.duplicates,
    balance_checks: a.balance_checks + b.balance_checks,
    failing_checks: a.failing_checks + b.failing_checks,
  };
}
