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
  accounts: { cell: { name: accountLedgerRow() } },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function ExpenseBreakdownReport() {
  const { period, dates, setPeriod } = useReportPeriod();
  const report = useReportResult(["expense-breakdown", dates], () =>
    reportsApi.expenseBreakdown({ query: dates }),
  );

  return (
    <ReportScreenFrame title="Expense Breakdown">
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
