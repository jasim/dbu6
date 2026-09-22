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

export function MonthlySummaryReport() {
  const { period, dates, setPeriod } = useReportPeriod();
  const report = useReportResult(["monthly-summary", dates], () =>
    reportsApi.monthlySummary({ query: dates }),
  );

  return (
    <ReportScreenFrame title="Monthly Summary">
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
