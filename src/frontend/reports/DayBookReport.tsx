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
// account's ledger up to that day.
export function DayBookReport() {
  const { period, dates, setPeriod } = useReportPeriod();
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
