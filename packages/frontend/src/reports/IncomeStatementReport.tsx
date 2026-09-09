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
import { DateInput, ReportResultBody, useReportResult } from "./shared";

const links = {
  accounts: { cell: { name: accountLedgerRow() } },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function IncomeStatementReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromDate = searchParams.get("from_date") ?? "";
  const toDate = searchParams.get("to_date") ?? "";
  const report = useReportResult(
    () => callReport({ from_date: fromDate, to_date: toDate }),
    [fromDate, toDate],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <ReportScreenFrame title="Income Statement">
      <ReportToolbar
        actions={
          <ReportRunButton loading={report.loading} onClick={report.run} />
        }
      >
        <DateInput
          label="from"
          value={fromDate}
          onChange={(value) => setParam("from_date", value)}
        />
        <DateInput
          label="to"
          value={toDate}
          onChange={(value) => setParam("to_date", value)}
        />
      </ReportToolbar>
      <ReportResultBody<LedgerLinkInput>
        error={report.error}
        result={report.result}
        links={links}
        linkContext={{
          input: {
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
          },
        }}
      />
    </ReportScreenFrame>
  );
}

function callReport(params: {
  from_date: string;
  to_date: string;
}): Promise<GridDataset> {
  return reportsApi.incomeStatement({
    query: {
      from_date: params.from_date || undefined,
      to_date: params.to_date || undefined,
    },
  });
}
