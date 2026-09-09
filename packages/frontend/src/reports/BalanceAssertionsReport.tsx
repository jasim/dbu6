import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
} from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsApi } from "../api";
import { ReportResultBody, useReportResult } from "./shared";

export function BalanceAssertionsReport() {
  const report = useReportResult(callReport, []);

  return (
    <ReportScreenFrame title="Balance Assertions">
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
