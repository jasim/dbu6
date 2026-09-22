import {
  accountLedgerRow,
  type LedgerLinkInput,
  type ReportCellLinkResolvers,
  ReportPeriodField,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportPeriod,
  useReportResult,
} from "../report-kit";
import { reportsApi } from "./client";

const links = {
  inflow: {
    cell: { asset_account: accountLedgerRow() },
  },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function AssetInflowsReport() {
  const { period, dates, setPeriod } = useReportPeriod();
  const report = useReportResult(["asset-inflows", dates], () =>
    reportsApi.assetInflows({ query: dates }),
  );

  return (
    <ReportScreenFrame title="Asset Inflows">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      >
        <ReportPeriodField period={period} onChange={setPeriod} />
      </ReportToolbar>
      <ReportResultBody<LedgerLinkInput>
        error={report.error}
        result={report.result}
        links={links}
        linkContext={{ input: dates }}
      />
    </ReportScreenFrame>
  );
}
