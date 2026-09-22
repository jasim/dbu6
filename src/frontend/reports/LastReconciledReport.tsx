import {
  type GridDataset,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

export function LastReconciledReport() {
  const report = useReportResult(["last-reconciled"], callReport);

  return (
    <ReportScreenFrame title="Last Reconciled Balances">
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
  return reportsApi.lastReconciled({ query: {} });
}
