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
import { postedAssertionFailuresCtes } from "../../modules/reconciliation/index.js";
import { assertionColumns } from "./assertion-grid.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "balanceAssertions",
  reportsContract.balanceAssertions,
  ({ c }) => {
    const ledger = reportLedger(c, "balance-assertions");
    const rows = ledger.all<BalanceAssertionRow>(`
      ${postedAssertionFailuresCtes}
      SELECT
        f.account_id,
        f.entry_id,
        a.name AS account_name,
        f.date,
        f.journal_id,
        f.running_balance,
        f.assertion,
        f.diff
      FROM posted_assertion_failures f
      JOIN scoped_accounts a ON a.id = f.account_id
      ORDER BY a.name, f.date, f.journal_id, f.entry_id`);

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
