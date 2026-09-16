import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  type ReportCellLinkResolvers,
} from "@sapporta/frontend/report";
import { reportsApi } from "../api";
import { accountLedgerRow, type LedgerLinkInput } from "./links";
import { ReportPeriodField, useReportPeriod } from "./ReportPeriodField";
import { ReportResultBody, useReportResult } from "./shared";

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
