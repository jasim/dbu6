import {
  type GridDataset,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

export function DraftBalanceAssertionsReport() {
  const report = useReportResult(["draft-balance-assertions"], callReport);

  return (
    <ReportScreenFrame title="Draft Reconciliation Differences">
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
  return reportsApi.draftBalanceAssertions({ query: {} });
}
