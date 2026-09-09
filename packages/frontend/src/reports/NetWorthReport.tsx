import { useSearchParams } from "react-router-dom";
import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
} from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsApi } from "../api";
import { DateInput, ReportResultBody, useReportResult } from "./shared";

export function NetWorthReport() {
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
    <ReportScreenFrame title="Net Worth Over Time">
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
      <ReportResultBody error={report.error} result={report.result} />
    </ReportScreenFrame>
  );
}

function callReport(params: {
  from_date: string;
  to_date: string;
}): Promise<GridDataset> {
  return reportsApi.netWorth({
    query: {
      from_date: params.from_date || undefined,
      to_date: params.to_date || undefined,
    },
  });
}
