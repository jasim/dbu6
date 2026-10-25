import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { Temporal } from "@sapporta/shared/temporal";
import {
  overviewContract,
  type IncomeExpensesAccount,
  type OverviewAccount,
  type OverviewCategory,
  type PostedOverview,
} from "../../shared/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { hasJournalsBesideOpenings } from "../modules/journals/index.js";
import {
  readOnlyLedger,
  type ReportLedger,
} from "../modules/ledger-sql/index.js";
import { loadHomeSummary } from "./home.js";
import { incomeExpensesReport } from "./reports/income-expenses.js";
import { authorizeReport, monthEnd } from "./reports/shared.js";

/*
 * The Overview screen's one request: where the money stands for one month.
 * The figures, categories and trend come from Income and Expenses over the
 * thirteen months ending with it, so the two screens agree; net worth and the
 * accounts' balances are the ledger's at the month's end. Only posted entries
 * count, never drafts, and until anything beyond the opening balances is
 * posted there is nothing to show.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("overview", overviewContract.overview, ({ c, request }) => {
  const auth = authorizeReport(c, "overview");
  const sqlite = c.get("sqlite");
  if (!hasJournalsBesideOpenings(sqlite, auth)) {
    return { status: 200, body: { posted: false as const } };
  }
  // Home's accounts, so the two screens list and order them alike.
  const summary = loadHomeSummary(
    sqlite,
    auth,
    loadImportPresets(c.get("db"), auth),
  );
  const accounts = summary.accounts.flatMap((account) =>
    account.in_ledger
      ? [
          {
            account_id: account.account_id,
            name: account.name,
            kind: account.kind,
            books_until: account.checkpoint?.date ?? null,
          },
        ]
      : [],
  );
  return {
    status: 200,
    body: overviewReport(readOnlyLedger(sqlite, auth), {
      month: request.query.month ?? null,
      accounts,
    }),
  };
});

export default api;

/** An account Overview lists, before its balance is read. */
export type OverviewAccountInput = Omit<OverviewAccount, "balance">;

/** The most categories Overview lists. */
const CATEGORY_LIMIT = 8;

export function overviewReport(
  ledger: ReportLedger,
  query: { month: string | null; accounts: readonly OverviewAccountInput[] },
): PostedOverview {
  const completeUntil = earliest(
    query.accounts.flatMap((account) =>
      account.books_until === null ? [] : [account.books_until],
    ),
  );
  const month =
    query.month ??
    (completeUntil === null
      ? lastJournalMonth(ledger)
      : lastWholeMonth(completeUntil));

  const yearMonth = Temporal.PlainYearMonth.from(month);
  const report = incomeExpensesReport(ledger, {
    fromDate: `${yearMonth.subtract({ months: 12 })}-01`,
    toDate: monthEnd(month),
  });
  const current = report.months.length - 1;
  // The months before `month` that the books cover, for the averages.
  const covered = report.months
    .slice(0, current)
    .flatMap((row, index) =>
      report.first_month !== null && row.month >= report.first_month
        ? [index]
        : [],
    );
  // Null when the books cover none of them: there is nothing to average.
  const average =
    covered.length === 0
      ? null
      : (amounts: readonly number[]) =>
          covered.reduce((sum, index) => sum + amounts[index], 0) /
          covered.length;

  const balances = loadBalances(ledger, monthEnd(month));
  const previous = loadBalances(
    ledger,
    monthEnd(yearMonth.subtract({ months: 1 }).toString()),
  );

  return {
    posted: true,
    month,
    complete_until: completeUntil,
    first_month: report.first_month,
    figures: {
      income: report.months[current].income,
      spending: report.months[current].spending,
      average: average && {
        months: covered.length,
        income: average(report.months.map((row) => row.income)),
        spending: average(report.months.map((row) => row.spending)),
      },
    },
    categories: branchingLevel(report.spending.accounts)
      .map(
        (node): OverviewCategory => ({
          account_id: node.account_id,
          name: node.name,
          amount: node.months[current],
          average: average?.(node.months) ?? null,
        }),
      )
      .filter(
        (category) => category.amount !== 0 || (category.average ?? 0) !== 0,
      )
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
      .slice(0, CATEGORY_LIMIT),
    months: report.months.slice(1),
    net_worth: {
      assets: balances.assets,
      liabilities: balances.liabilities,
      net: balances.assets - balances.liabilities,
      previous_net: previous.assets - previous.liabilities,
    },
    accounts: query.accounts.map((account) => ({
      ...account,
      balance: balances.byAccount.get(account.account_id) ?? 0,
    })),
  };
}

/**
 * The first level of the spending tree with more than one account: a chart
 * that keeps everything under one `Expenses` account lists what is under it.
 * An account with entries of its own stops the descent, so its amount is not
 * lost.
 */
function branchingLevel(
  nodes: readonly IncomeExpensesAccount[],
): readonly IncomeExpensesAccount[] {
  let level = nodes;
  while (
    level.length === 1 &&
    level[0].children.length > 0 &&
    level[0].own === 0
  ) {
    level = level[0].children;
  }
  return level;
}

/**
 * Each asset and liability account's balance at the end of `asOf`, what is
 * owed positive for a liability, and the two totals.
 */
function loadBalances(ledger: ReportLedger, asOf: string) {
  const rows = ledger.all<{
    account_id: number;
    account_type: "Asset" | "Liability";
    balance: number;
  }>(
    `
    SELECT
      a.id AS account_id,
      a.account_type,
      CASE WHEN a.account_type = 'Liability'
           THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
           ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
      END AS balance
    FROM scoped_accounts a
    JOIN scoped_journal_entries je ON je.account_id = a.id
    JOIN scoped_journals j ON j.id = je.journal_id
    WHERE a.account_type IN ('Asset', 'Liability')
      AND j.date <= @asOf
    GROUP BY a.id, a.account_type`,
    { asOf },
  );
  const total = (type: "Asset" | "Liability") =>
    rows
      .filter((row) => row.account_type === type)
      .reduce((sum, row) => sum + row.balance, 0);
  return {
    assets: total("Asset"),
    liabilities: total("Liability"),
    byAccount: new Map(rows.map((row) => [row.account_id, row.balance])),
  };
}

/**
 * The month of the latest posted journal. Overview reads it only once
 * something is posted, so there is one.
 */
function lastJournalMonth(ledger: ReportLedger): string {
  const row = ledger.one<{ month: string | null }>(
    `SELECT strftime('%Y-%m', MAX(date)) AS month FROM scoped_journals`,
  );
  if (!row?.month) throw new Error("The books have no posted journal.");
  return row.month;
}

/**
 * The last month that ends on or before `date`: the date's own month when it
 * is that month's last day, else the month before.
 */
export function lastWholeMonth(date: string): string {
  const day = Temporal.PlainDate.from(date);
  const month = day.toPlainYearMonth();
  return (
    day.day === day.daysInMonth ? month : month.subtract({ months: 1 })
  ).toString();
}

function earliest(dates: readonly string[]): string | null {
  return dates.reduce<string | null>(
    (first, date) => (first === null || date < first ? date : first),
    null,
  );
}
