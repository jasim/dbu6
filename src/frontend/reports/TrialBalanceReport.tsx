import {
  accountLedgerRow,
  AsOfDateInput,
  type GridDataset,
  type LedgerLinkInput,
  type ReportCellLinkResolvers,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useAsOfDate,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

const links = {
  account: { cell: { name: accountLedgerRow() } },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function TrialBalanceReport() {
  const { asOfDate, setAsOfDate } = useAsOfDate();
  const report = useReportResult(["trial-balance", asOfDate], () =>
    callReport({ as_of_date: asOfDate }),
  );

  return (
    <ReportScreenFrame title="Trial Balance">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      >
        <AsOfDateInput value={asOfDate} onChange={setAsOfDate} />
      </ReportToolbar>
      <ReportResultBody<LedgerLinkInput>
        error={report.error}
        result={report.result}
        links={links}
        linkContext={{ input: { to_date: asOfDate } }}
      />
    </ReportScreenFrame>
  );
}

function callReport(params: { as_of_date: string }): Promise<GridDataset> {
  return reportsApi.trialBalance({
    query: { as_of_date: params.as_of_date },
  });
}
