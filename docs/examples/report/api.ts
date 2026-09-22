import {
  flatResult,
  moneyColumn,
  reportLedger,
  textColumn,
  TsRestApi,
  type GridDataset,
  type ReportLedger,
  type SapportaEnv,
} from "dbu6/server";
import { spendingByWeekdayContract } from "./contract.ts";

const api = new TsRestApi<SapportaEnv>();

// The route only turns the request into the function's input. `reportLedger`
// answers 403 unless the signed-in user may read reports, and hands back
// their books, read-only.
api.register(
  "spendingByWeekday",
  spendingByWeekdayContract.spendingByWeekday,
  ({ c, request }) => ({
    status: 200,
    body: spendingByWeekdayReport(reportLedger(c, "spending-by-weekday"), {
      fromDate: request.query.from_date ?? null,
      toDate: request.query.to_date ?? null,
    }),
  }),
);

type WeekdayRow = { weekday: number; spending: number; entries: number };

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Spending on expense accounts for each day of the week in the period, Sunday
 * first, with a total. A weekday without spending is listed with 0.
 *
 * The query reads `scoped_accounts`, `scoped_journals` and
 * `scoped_journal_entries`: the signed-in user's rows of those tables. It
 * begins where a `WITH` clause has ended, so it is a plain SELECT (or more
 * CTEs, starting with a comma). Values are bound by name.
 */
export function spendingByWeekdayReport(
  ledger: ReportLedger,
  query: { fromDate: string | null; toDate: string | null },
): GridDataset {
  const found = ledger.all<WeekdayRow>(
    `
    SELECT
      CAST(strftime('%w', j.date) AS INTEGER) AS weekday,
      SUM(je.debit - je.credit) AS spending,
      COUNT(*) AS entries
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    WHERE a.account_type = 'Expense'
      AND (@fromDate IS NULL OR j.date >= @fromDate)
      AND (@toDate IS NULL OR j.date <= @toDate)
    GROUP BY weekday`,
    query,
  );
  const byWeekday = new Map(found.map((row) => [row.weekday, row]));
  const rows = WEEKDAYS.map((name, weekday) => ({
    weekday: name,
    spending: byWeekday.get(weekday)?.spending ?? 0,
    entries: byWeekday.get(weekday)?.entries ?? 0,
  }));

  return flatResult(
    "spending-by-weekday",
    "Spending by Weekday",
    {
      weekdays: [
        textColumn("weekday", "Weekday", { width: 24 }),
        moneyColumn("spending", "Spending", { width: 18 }),
        { id: "entries", label: "Entries", kind: "number", width: 12 },
      ],
    },
    rows,
    {
      rowKey: (row) => row.weekday,
      footerRows: [
        {
          rowKey: "total",
          label: "Total",
          columns: {
            spending: rows.reduce((total, row) => total + row.spending, 0),
          },
        },
      ],
    },
  );
}

export default api;
