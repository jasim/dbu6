import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  authorizeReport,
  flatResult,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  sum,
  textColumn,
} from "./shared.js";
import { allRows } from "../../modules/ledger-sql/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register("trialBalance", reportsContract.trialBalance, ({ c, request }) => {
  const auth = authorizeReport(c, "trial-balance");
  const rows = allRows<TrialBalanceRow>(
    c.get("sqlite"),
    auth,
    `
    SELECT
      a.id AS account_id,
      a.name,
      a.account_type,
      MAX(COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0), 0) AS debit,
      MAX(COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0), 0) AS credit
    FROM scoped_accounts a
    LEFT JOIN (
      SELECT je.account_id, je.debit, je.credit
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      WHERE j.date <= @asOfDate
    ) je ON je.account_id = a.id
    GROUP BY a.id, a.name, a.account_type
    HAVING COALESCE(SUM(je.debit), 0) != COALESCE(SUM(je.credit), 0)
    ORDER BY a.account_type, a.name`,
    { asOfDate: request.query.as_of_date },
  );

  return { status: 200, body: toTrialBalanceResult(rows) };
});

type TrialBalanceRow = {
  account_id: number;
  name: string;
  account_type: string;
  debit: number;
  credit: number;
};

function toTrialBalanceResult(rows: TrialBalanceRow[]): GridDataset {
  const levelColumns = {
    account: [
      hiddenIdColumn("account_id", "Account ID"),
      textColumn("name", "Account", { width: 42 }),
      textColumn("account_type", "Type", { width: 14 }),
      moneyColumn("debit", "Debit", { width: 16, zeroDisplay: "blank" }),
      moneyColumn("credit", "Credit", { width: 16, zeroDisplay: "blank" }),
    ],
  };
  return flatResult("trial-balance", "Trial Balance", levelColumns, rows, {
    rowKey: (row) => `account:${row.account_id}`,
    rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
    footerRows: [
      {
        rowKey: "grand-total",
        label: "Grand Total",
        columns: {
          debit: sum(rows, "debit"),
          credit: sum(rows, "credit"),
        },
      },
    ],
  });
}

export default api;
