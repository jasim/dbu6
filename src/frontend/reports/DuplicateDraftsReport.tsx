import {
  type GridDataset,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

export function DuplicateDraftsReport() {
  const report = useReportResult(["duplicate-drafts"], callReport);

  return (
    <ReportScreenFrame title="Duplicate Drafts">
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
  return reportsApi.duplicateDrafts({ query: {} });
}
