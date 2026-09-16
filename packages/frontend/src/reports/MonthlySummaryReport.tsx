import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
} from "@sapporta/frontend/report";
import { reportsApi } from "../api";
import { ReportPeriodField, useReportPeriod } from "./ReportPeriodField";
import { ReportResultBody, useReportResult } from "./shared";

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
