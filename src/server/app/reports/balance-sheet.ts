import {
  type GridDataset,
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";
import {
  sectionAccountResult,
  sectionFooterRow,
  sectionTotal,
  type SectionAccount,
} from "./section-account-grid.js";

const api = new TsRestApi<SapportaEnv>();

api.register("balanceSheet", reportsContract.balanceSheet, ({ c, request }) => {
  const ledger = reportLedger(c, "balance-sheet");
  return {
    status: 200,
    body: balanceSheetReport(ledger, {
      asOfDate: request.query.as_of_date,
    }),
  };
});

/**
 * Every asset, liability and equity account down the account tree, with its
 * balance up to the date: its own entries and everything below it. An
 * account without entries is kept at 0, so the tree keeps its parents.
 *
 * It reads as what you own, less what you owe, is your net worth. Equity
 * lists what the net worth is made of, and its total is the last row, "Net
 * worth": the Net Worth report's number, shown once, so the Equity row above
 * has none. The screen names the day in that row's label. Revenue and expenses are never closed into an equity
 * account, so Equity also gets a computed row for them, income less spending
 * up to the date (retained earnings). With it, net worth is assets less
 * liabilities whenever the books balance; when they don't, a row after it
 * says by how much.
 */
export function balanceSheetReport(
  ledger: ReportLedger,
  query: { asOfDate: string },
): GridDataset {
  const accounts = ledger.all<SectionAccount>(
    `
    SELECT
      a.id AS account_id,
      a.name,
      a.parent_id,
      a.account_type,
      CASE WHEN a.account_type IN ('Liability', 'Equity')
           THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
           ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
      END AS amount
    FROM scoped_accounts a
    LEFT JOIN (
      SELECT je.account_id, je.debit, je.credit
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      WHERE j.date <= @asOfDate
    ) je ON je.account_id = a.id
    WHERE a.account_type IN ('Asset', 'Liability', 'Equity')
    GROUP BY a.id, a.name, a.parent_id, a.account_type`,
    query,
  );
  const earnings = ledger.all<RetainedEarnings>(
    `
    SELECT
      COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0) AS amount,
      MIN(j.date) AS first_date
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    WHERE a.account_type IN ('Revenue', 'Expense')
      AND j.date <= @asOfDate`,
    query,
  )[0] ?? { amount: 0, first_date: null };
  return toBalanceSheetResult(accounts, earnings);
}

/**
 * Revenue less expenses up to the date, and the first day with either, from
 * which the income statement adds up to the same amount.
 */
type RetainedEarnings = { amount: number; first_date: string | null };

/** The row key of the computed retained earnings row under Equity. */
const RETAINED_EARNINGS_ROW = "retained-earnings";

/** The row key of the last row, the net worth, which the screen sets larger. */
const NET_WORTH_ROW = "net-worth";

function toBalanceSheetResult(
  accounts: SectionAccount[],
  earnings: RetainedEarnings,
): GridDataset {
  const result = sectionAccountResult({
    name: "balance-sheet",
    label: "Balance Sheet",
    sections: ["Asset", "Liability", "Equity"],
    labels: {
      Asset: "What you own · Assets",
      Liability: "What you owe · Liabilities",
      Equity: "What your net worth is made of · Equity",
    },
    accounts,
  });
  const netWorth = equityWithEarnings(result, earnings);
  const outOfBalance =
    sectionTotal(result.nodes, "Asset") -
    sectionTotal(result.nodes, "Liability") -
    netWorth;
  result.footerRows = [
    sectionFooterRow({
      rowKey: NET_WORTH_ROW,
      label: "Net worth",
      columns: { section_total: netWorth },
      result,
    }),
  ];
  if (Math.abs(outOfBalance) >= 0.005) {
    result.footerRows.push(
      sectionFooterRow({
        rowKey: "out-of-balance",
        label: "Out of balance: own − owe ≠ net worth. See the Trial Balance.",
        columns: { section_total: outOfBalance },
        result,
      }),
    );
  }
  return result;
}

/**
 * Adds the retained earnings row, last under Equity, unless it is 0, and
 * returns Equity's total with it: the net worth. The Equity row's own total
 * is removed, since the net worth row shows it. The screen links the
 * earnings row to the income statement from `earnings_from`.
 */
function equityWithEarnings(
  result: GridDataset,
  earnings: RetainedEarnings,
): number {
  const amount = Number(earnings.amount);
  const equity = result.nodes.find(
    (node) => node.columns.account_type === "Equity",
  );
  if (!equity) return amount;
  const netWorth = Number(equity.rollup?.section_total ?? 0) + amount;
  delete equity.rollup;
  if (amount !== 0) {
    equity.children = {
      ...equity.children,
      accounts: [
        ...(equity.children?.accounts ?? []),
        {
          rowKey: RETAINED_EARNINGS_ROW,
          levelName: "accounts",
          columns: {
            parent_key: null,
            name: "Income less spending, to date",
            balance: amount,
            earnings_from: earnings.first_date,
          },
        },
      ],
    };
  }
  return netWorth;
}

export default api;
