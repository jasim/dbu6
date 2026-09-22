import {
  flatResult,
  type GridDataset,
  hiddenIdColumn,
  openRecordLink,
  reportLedger,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";
import { assertionFailsSql } from "../../modules/reconciliation/index.js";
import { assertionColumns } from "./assertion-grid.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "balanceAssertions",
  reportsContract.balanceAssertions,
  ({ c }) => {
    const ledger = reportLedger(c, "balance-assertions");
    const rows = ledger.all<BalanceAssertionRow>(`
      , running AS (
        SELECT
          je.id AS entry_id,
          je.account_id,
          je.journal_id,
          j.date,
          a.name AS account_name,
          je.account_balance_assertion,
          SUM(je.debit - je.credit) OVER (
            PARTITION BY je.account_id
            ORDER BY j.date, j.id, je.id
            ROWS UNBOUNDED PRECEDING
          ) AS running_balance
        FROM scoped_journal_entries je
        JOIN scoped_journals j ON j.id = je.journal_id
        JOIN scoped_accounts a ON a.id = je.account_id
      )
      SELECT
        account_id,
        entry_id,
        account_name,
        date,
        journal_id,
        running_balance,
        account_balance_assertion AS assertion,
        running_balance - account_balance_assertion AS diff
      FROM running
      WHERE account_balance_assertion IS NOT NULL
        AND ${assertionFailsSql("running_balance", "account_balance_assertion")}
      ORDER BY account_name, date, journal_id, entry_id`);

    return { status: 200, body: toBalanceAssertionsResult(rows) };
  },
);

type BalanceAssertionRow = {
  account_id: number;
  entry_id: number;
  account_name: string;
  date: string;
  journal_id: number;
  running_balance: number;
  assertion: number;
  diff: number;
};

function toBalanceAssertionsResult(rows: BalanceAssertionRow[]): GridDataset {
  const levelColumns = {
    assertion: [
      hiddenIdColumn("account_id", "Account ID"),
      hiddenIdColumn("entry_id", "Entry ID"),
      ...assertionColumns(
        "journal_id",
        "Journal",
        openRecordLink("journal_entries", "entry_id", "Open journal entry"),
      ),
    ],
  };
  return flatResult(
    "balance-assertions",
    "Reconciliation Differences",
    levelColumns,
    rows,
    {
      rowKey: (row, index) => `journal:${row.journal_id}:${index}`,
      rowLinks: [
        openRecordLink("journals", "journal_id", "Open journal"),
        openRecordLink("accounts", "account_id", "Open account"),
      ],
    },
  );
}

export default api;
