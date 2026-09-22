import {
  type GridDataset,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

export function BalanceAssertionsReport() {
  const report = useReportResult(["balance-assertions"], callReport);

  return (
    <ReportScreenFrame title="Reconciliation Differences">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      />
      <ReportResultBody error={report.error} result={report.result} />
    </ReportScreenFrame>
  );
}

function callReport(): Promise<GridDataset> {
  return reportsApi.balanceAssertions({ query: {} });
}
