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
} from "./shared.js";
import { assertionColumns } from "./assertion-grid.js";
import {
  baseAccountRunningBalanceCtes,
  failingDraftAssertionsSelect,
} from "../../modules/reconciliation/running-balance.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "draftBalanceAssertions",
  reportsContract.draftBalanceAssertions,
  ({ c }) => {
    const scope = authorizeReport(c, "draft-balance-assertions");
    const rows = allRows<DraftBalanceAssertionRow>(
      c.get("sqlite"),
      `${ledgerCtes}${baseAccountRunningBalanceCtes}
      SELECT
        r.account_id,
        a.name AS account_name,
        r.date,
        r.draft_id,
        r.running_balance,
        r.assertion,
        r.diff
      FROM (${failingDraftAssertionsSelect}) r
      JOIN scoped_accounts a ON a.id = r.account_id
      ORDER BY account_name, date, r.draft_id`,
      scope,
    );

    return { status: 200, body: toDraftBalanceAssertionsResult(rows) };
  },
);

type DraftBalanceAssertionRow = {
  account_id: number;
  account_name: string;
  date: string;
  draft_id: number;
  running_balance: number;
  assertion: number;
  diff: number;
};

function toDraftBalanceAssertionsResult(
  rows: DraftBalanceAssertionRow[],
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
