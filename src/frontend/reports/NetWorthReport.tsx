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

export function NetWorthReport() {
  const { period, dates, setPeriod } = useReportPeriod();
  const report = useReportResult(["net-worth", dates], () =>
    reportsApi.netWorth({ query: dates }),
  );

  return (
    <ReportScreenFrame title="Net Worth Over Time">
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
