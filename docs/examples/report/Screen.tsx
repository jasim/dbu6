import {
  ReportPeriodField,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  reportClient,
  useReportPeriod,
  useReportResult,
} from "dbu6/frontend";
import { spendingByWeekdayContract } from "./contract.ts";

// A typed client for this report's own route: `query` and the answer are
// typed from the contract.
const client = reportClient(spendingByWeekdayContract);

/**
 * The same blocks dbu6's own grid reports use: the period is kept in the
 * URL, the report runs when the screen opens and again with Run, and the
 * answer is drawn as a grid. None of them is required; a screen is any React
 * component.
 */
export function SpendingByWeekdayScreen() {
  const { period, dates, setPeriod } = useReportPeriod();
  const report = useReportResult(["spending-by-weekday", dates], () =>
    client.spendingByWeekday({ query: dates }),
  );

  return (
    <ReportScreenFrame title="Spending by Weekday">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      >
        <ReportPeriodField period={period} onChange={setPeriod} />
      </ReportToolbar>
      <p className="border-b border-sap-border px-4 py-2 text-meta text-ink-meta">
        Which days of the week the money goes out on.
      </p>
      <ReportResultBody error={report.error} result={report.result} />
    </ReportScreenFrame>
  );
}
