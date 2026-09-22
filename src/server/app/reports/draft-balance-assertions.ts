import type Database from "better-sqlite3";
import {
  authorizeReport,
  flatResult,
  type GridDataset,
  hiddenIdColumn,
  openRecordLink,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import type { LedgerAuth } from "../../modules/ledger-sql/index.js";
import { reportsContract } from "../../../shared/index.js";
import { assertionColumns } from "./assertion-grid.js";
import { loadLedgerAccounts } from "../../modules/accounts/index.js";
import {
  findFailingChecks,
  type FailingCheck,
} from "../../modules/drafts/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "draftBalanceAssertions",
  reportsContract.draftBalanceAssertions,
  ({ c, request }) => {
    const auth = authorizeReport(c, "draft-balance-assertions");
    return {
      status: 200,
      body: draftBalanceAssertionsReport(
        c.get("sqlite"),
        auth,
        request.query.base_account_id,
      ),
    };
  },
);

/**
 * The failing draft balance checks, for every account or, for Review's
 * tab, one account without the Account column.
 */
export function draftBalanceAssertionsReport(
  sqlite: Database.Database,
  auth: LedgerAuth,
  accountId?: number,
): GridDataset {
  const names = new Map(
    loadLedgerAccounts(sqlite, auth).map((account) => [
      account.id,
      account.name,
    ]),
  );
  const rows = findFailingChecks(sqlite, auth, { accountId })
    .map((row) => ({ ...row, account_name: names.get(row.account_id) ?? "" }))
    // By account name, as SQLite's binary collation orders it; the checks
    // already come by date and draft within an account.
    .sort((a, b) =>
      a.account_name < b.account_name
        ? -1
        : a.account_name > b.account_name
          ? 1
          : 0,
    );
  return toDraftBalanceAssertionsResult(rows, accountId === undefined);
}

type DraftBalanceAssertionRow = FailingCheck & { account_name: string };

function toDraftBalanceAssertionsResult(
  rows: DraftBalanceAssertionRow[],
  accountColumn: boolean,
): GridDataset {
  const levelColumns = {
    draft: [
      hiddenIdColumn("account_id", "Account ID"),
      ...assertionColumns(
        "draft_id",
        "Draft",
        openRecordLink(
          "draft_transactions",
          "draft_id",
          "Open draft transaction",
        ),
        { accountColumn },
      ),
    ],
  };
  return flatResult(
    "draft-balance-assertions",
    "Draft Reconciliation Differences",
    levelColumns,
    rows,
    {
      rowKey: (row, index) => `draft:${row.draft_id}:${index}`,
      rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
    },
  );
}

export default api;
