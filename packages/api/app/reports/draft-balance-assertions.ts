import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  allRows,
  authorizeReport,
  flatResult,
  hiddenIdColumn,
  ledgerCtes,
  openRecordLink,
  type ScopeParams,
} from "./shared.js";
import { assertionColumns } from "./assertion-grid.js";
import { findFailingChecks, type FailingCheck } from "../draft-status.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "draftBalanceAssertions",
  reportsContract.draftBalanceAssertions,
  ({ c, request }) => {
    const scope = authorizeReport(c, "draft-balance-assertions");
    return {
      status: 200,
      body: draftBalanceAssertionsReport(
        c.get("sqlite"),
        scope,
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
  scope: ScopeParams,
  accountId?: number,
): GridDataset {
  const names = new Map(
    allRows<{ id: number; name: string }>(
      sqlite,
      `${ledgerCtes} SELECT id, name FROM scoped_accounts`,
      scope,
    ).map((row) => [row.id, row.name]),
  );
  const rows = findFailingChecks(sqlite, scope, { accountId })
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
    "Draft Balance Assertions",
    levelColumns,
    rows,
    {
      rowKey: (row, index) => `draft:${row.draft_id}:${index}`,
      rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
    },
  );
}

export default api;
