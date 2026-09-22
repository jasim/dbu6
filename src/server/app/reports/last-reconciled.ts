import {
  authorizeReport,
  accountLedgerLink,
  dateColumn,
  flatResult,
  type GridDataset,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  type SapportaEnv,
  textColumn,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";
import {
  loadLastReconciled,
  type LastReconciledRow,
} from "../../modules/journals/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register("lastReconciled", reportsContract.lastReconciled, ({ c }) => {
  const auth = authorizeReport(c, "last-reconciled");
  const rows = loadLastReconciled(c.get("sqlite"), auth);

  return { status: 200, body: toLastReconciledResult(rows) };
});

function toLastReconciledResult(rows: LastReconciledRow[]): GridDataset {
  const levelColumns = {
    account: [
      hiddenIdColumn("account_id", "Account ID"),
      hiddenIdColumn("journal_id", "Journal ID"),
      textColumn("account_name", "Account", {
        width: 52,
        links: [
          accountLedgerLink({
            account_id: "account_id",
            to_date: "last_reconciled_date",
          }),
        ],
      }),
      dateColumn("last_reconciled_date", "Last Reconciled", {
        width: 16,
        links: [openRecordLink("journals", "journal_id", "Open journal")],
      }),
      moneyColumn("last_balance", "Balance", { width: 18 }),
    ],
  };
  return flatResult(
    "last-reconciled",
    "Last Reconciled Balances",
    levelColumns,
    rows,
    {
      rowKey: (row) => `account:${row.account_id}`,
      rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
    },
  );
}

export default api;
