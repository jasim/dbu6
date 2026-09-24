import {
  ReportPeriodField,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportPeriod,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

// The dataset declares its links: a journal opens itself, a line its
// account's ledger up to that day. It opens on this month: every line of
// every journal makes all time long.
export function DayBookReport() {
  const { period, dates, setPeriod } = useReportPeriod({
    defaultPreset: "this-month",
  });
  const report = useReportResult(["day-book", dates], () =>
    reportsApi.dayBook({ query: dates }),
  );

  return (
    <ReportScreenFrame title="Day Book">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      >
        <ReportPeriodField period={period} onChange={setPeriod} />
      </ReportToolbar>
      <ReportResultBody error={report.error} result={report.result} />
    </ReportScreenFrame>
  );
}
