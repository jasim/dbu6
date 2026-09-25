import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  homeContract,
  NO_DRAFTS,
  type DraftCounts,
  type HomeAccount,
  type HomeSummary,
  type ImportInstitution,
} from "../../shared/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { importableAccounts } from "./account-names.js";
import { loadAccountStandings } from "./account-standing.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import {
  draftCounts,
  hasTransactions,
  loadStatementActivity,
} from "../modules/drafts/index.js";
import { hasChart } from "../workflows/chart-of-accounts.js";
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
  return {
    status: 200,
    body: loadHomeSummary(
      c.get("sqlite"),
      auth,
      loadImportPresets(c.get("db"), auth),
    ),
  };
});

export default api;

export function loadHomeSummary(
  sqlite: Database.Database,
  auth: LedgerAuth,
  institutions: readonly ImportInstitution[],
): HomeSummary {
  const standings = loadAccountStandings(sqlite, auth, institutions);
  // /add's rule: an opening entry alone is not an import.
  const activity = loadStatementActivity({ sqlite, auth });

  const withParser = new Set(
    institutions
      .filter((institution) => institution.parsers.length > 0)
      .flatMap((institution) =>
        institution.accounts.map((account) => account.account_id),
      ),
  );
  const accounts = importableAccounts(institutions)
    .map((preset): HomeAccount => {
      const has_parser = withParser.has(preset.account_id);
      const standing = standings.get(preset.account_id);
      // The preset still names an account the ledger deleted.
      if (standing === undefined) {
        return {
          in_ledger: false,
          account_id: preset.account_id,
          name: preset.name,
          kind: accountKindOf(preset.is_credit_card),
          has_parser,
        };
      }
      return {
        in_ledger: true,
        account_id: standing.account_id,
        path: standing.path,
        name: standing.name,
        kind: standing.kind,
        has_parser,
        checkpoint: standing.checkpoint,
        statement_differences: standing.statement_differences,
        ...draftCounts(standing.drafts),
      };
    })
    .sort(byLastAssertion);

  return {
    has_chart: hasChart({ sqlite, auth }),
    accounts,
    totals: Array.from(standings.values())
      .map((standing) => draftCounts(standing.drafts))
      .reduce(addCounts, NO_DRAFTS),
    any_imported: accounts.some(
      (account) =>
        account.in_ledger && hasTransactions(activity(account.account_id)),
    ),
  };
}

/**
 * The account whose statements were last imported longest ago comes first:
 * accounts with no posted balance assertion (deleted from the ledger, then
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
