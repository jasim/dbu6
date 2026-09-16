import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
} from "@sapporta/frontend/report";
import { reportsApi } from "../api";
import { ReportPeriodField, useReportPeriod } from "./ReportPeriodField";
import { ReportResultBody, useReportResult } from "./shared";

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
