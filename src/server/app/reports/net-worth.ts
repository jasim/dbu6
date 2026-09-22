import {
  dateColumn,
  flatResult,
  type GridDataset,
  moneyColumn,
  monthEnd,
  reportLedger,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register("netWorth", reportsContract.netWorth, ({ c, request }) => {
  const ledger = reportLedger(c, "net-worth");
  const rows = ledger.all<NetWorthSourceRow>(`
    SELECT
      strftime('%Y-%m-01', j.date) AS month,
      COALESCE(SUM(CASE WHEN a.account_type = 'Asset'
                        THEN je.debit - je.credit
                        ELSE 0 END), 0) AS asset_delta,
      COALESCE(SUM(CASE WHEN a.account_type = 'Liability'
                        THEN je.credit - je.debit
                        ELSE 0 END), 0) AS liability_delta
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    WHERE a.account_type IN ('Asset', 'Liability')
    GROUP BY strftime('%Y-%m-01', j.date)
    ORDER BY strftime('%Y-%m-01', j.date)`);

  return {
    status: 200,
    body: toNetWorthResult(
      rows,
      request.query.from_date ?? null,
      request.query.to_date ?? null,
    ),
  };
});

type NetWorthSourceRow = {
  month: string;
  asset_delta: number;
  liability_delta: number;
};

type NetWorthRow = NetWorthSourceRow & {
  month_end: string;
  assets: number;
  liabilities: number;
  net_worth: number;
  net_delta: number;
};

function toNetWorthResult(
  sourceRows: NetWorthSourceRow[],
  fromDate: string | null,
  toDate: string | null,
): GridDataset {
  let assets = 0;
  let liabilities = 0;
  let previousNetWorth = 0;
  const rows = sourceRows.map((row) => {
    assets += Number(row.asset_delta ?? 0);
    liabilities += Number(row.liability_delta ?? 0);
    const netWorth = assets - liabilities;
    const netDelta = netWorth - previousNetWorth;
    previousNetWorth = netWorth;
    return {
      ...row,
      month_end: monthEnd(row.month),
      assets,
      liabilities,
      net_worth: netWorth,
      net_delta: netDelta,
    };
  });
  const visibleRows = rows.filter((row) => {
    if (fromDate !== null && row.month < fromDate) return false;
    if (toDate !== null && row.month > toDate) return false;
    return true;
  });
  const last = visibleRows[visibleRows.length - 1];
  const levelColumns = {
    month: [
      dateColumn("month", "Month", { width: 12 }),
      dateColumn("month_end", "Month End", { visuallyHidden: true }),
      moneyColumn("asset_delta", "Asset Delta", { visuallyHidden: true }),
      moneyColumn("liability_delta", "Liability Delta", {
        visuallyHidden: true,
      }),
      moneyColumn("assets", "Assets", { width: 18 }),
      moneyColumn("liabilities", "Liabilities", { width: 18 }),
      moneyColumn("net_worth", "Net Worth", {
        width: 18,
        colorRule: "signed",
        strong: true,
        links: [
          {
            kind: "report",
            report: "balance-sheet",
            bind: { as_of_date: "month_end" },
            label: "Open balance sheet",
            icon: "report",
          },
        ],
      }),
      moneyColumn("net_delta", "Net Delta", {
        width: 18,
        colorRule: "signed",
        links: [
          {
            kind: "report",
            report: "income-statement",
            bind: { from_date: "month", to_date: "month_end" },
            label: "Open income statement",
            icon: "report",
          },
        ],
      }),
    ],
  };
  return flatResult(
    "net-worth",
    "Net Worth Over Time",
    levelColumns,
    visibleRows,
    {
      rowKey: (row: NetWorthRow) => `month:${row.month}`,
      footerRows: [
        {
          rowKey: "current",
          label: "Current",
          columns: {
            assets: last?.assets ?? 0,
            liabilities: last?.liabilities ?? 0,
            net_worth: last?.net_worth ?? 0,
          },
        },
      ],
    },
  );
}

export default api;
