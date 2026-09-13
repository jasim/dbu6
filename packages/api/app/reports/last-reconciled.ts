import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  accountLedgerLink,
  allRows,
  authorizeReport,
  dateColumn,
  flatResult,
  hiddenIdColumn,
  ledgerCtes,
  moneyColumn,
  openRecordLink,
  textColumn,
  type ScopeParams,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register("lastReconciled", reportsContract.lastReconciled, ({ c }) => {
  const scope = authorizeReport(c, "last-reconciled");
  const rows = loadLastReconciled(c.get("sqlite"), scope);

  return { status: 200, body: toLastReconciledResult(rows) };
});

export type LastReconciledRow = {
  account_id: number;
  journal_id: number;
  account_name: string;
  last_reconciled_date: string;
  last_balance: number;
};

export function loadLastReconciled(
  sqlite: Parameters<typeof allRows>[0],
  scope: ScopeParams,
): LastReconciledRow[] {
  return allRows<LastReconciledRow>(
    sqlite,
    `${ledgerCtes}
    SELECT
      a.id AS account_id,
      j.id AS journal_id,
      a.name AS account_name,
      j.date AS last_reconciled_date,
      je.account_balance_assertion AS last_balance
    FROM scoped_accounts a
    JOIN scoped_journal_entries je ON je.account_id = a.id
    JOIN scoped_journals j ON j.id = je.journal_id
    WHERE je.account_balance_assertion IS NOT NULL
      AND j.id = (
        SELECT je2.journal_id
        FROM scoped_journal_entries je2
        JOIN scoped_journals j2 ON j2.id = je2.journal_id
        WHERE je2.account_id = a.id
          AND je2.account_balance_assertion IS NOT NULL
        ORDER BY j2.date DESC, j2.id DESC
        LIMIT 1
      )
    ORDER BY a.name`,
    scope,
  );
}

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
    "Last Reconciled Entries",
    levelColumns,
    rows,
    {
      rowKey: (row) => `account:${row.account_id}`,
      rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
    },
  );
}

export default api;
