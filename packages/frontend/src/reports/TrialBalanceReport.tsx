import { useSearchParams } from "react-router-dom";
import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  type ReportCellLinkResolvers,
} from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsApi } from "../api";
import { accountLedgerRow, type LedgerLinkInput } from "./links";
import { DateInput, ReportResultBody, today, useReportResult } from "./shared";

const links = {
  account: { cell: { name: accountLedgerRow() } },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function TrialBalanceReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const asOfDate = searchParams.get("as_of_date") ?? today;
  const report = useReportResult(["trial-balance", asOfDate], () =>
    callReport({ as_of_date: asOfDate }),
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <ReportScreenFrame title="Trial Balance">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      >
        <DateInput
          label="as of"
          value={asOfDate}
          onChange={(value) => setParam("as_of_date", value)}
        />
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
