import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
} from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsApi } from "../api";
import { ReportResultBody, useReportResult } from "./shared";

export function LastReconciledReport() {
  const report = useReportResult(["last-reconciled"], callReport);

  return (
    <ReportScreenFrame title="Last Reconciled Entries">
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
