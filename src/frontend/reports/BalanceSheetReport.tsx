import {
  accountLedgerRow,
  DateInput,
  formatDate,
  type GridDataset,
  incomeStatementHref,
  type LedgerLinkInput,
  type ReportCellLinkContext,
  type ReportCellLinkResolvers,
  type ReportCellRenderContext,
  type ReportCellRenderers,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  today,
  useMemo,
  useReportResult,
  useSearchParams,
} from "../report-kit";
import { reportsApi } from "./client";

const accountLedger = accountLedgerRow();

/**
 * An account opens its ledger; the computed row for income less spending
 * opens the income statement over the same entries, from the first to the
 * as-of date.
 */
function balanceSheetRow(context: ReportCellLinkContext<LedgerLinkInput>) {
  const { node, input } = context;
  if (node.rowKey !== "retained-earnings") return accountLedger(context);
  const from = node.columns.earnings_from;
  const to = input?.to_date;
  if (typeof from !== "string" || !to) return [];
  return [
    {
      label: "Open income statement",
      href: incomeStatementHref(from, to),
      icon: "report" as const,
    },
  ];
}

const links = {
  accounts: { cell: { name: balanceSheetRow } },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

/**
 * The last row, the net worth, is the answer the page gives: its label and
 * amount are set larger than the rest, and the label names the day, or says
 * "Current" for today.
 */
function netWorthCells(asOfDate: string): ReportCellRenderers {
  const label =
    asOfDate === today()
      ? "Current net worth"
      : `Net worth as on ${formatDate(asOfDate)}`;
  const isNetWorth = (row: ReportCellRenderContext["row"]) =>
    row.kind === "footer" && row.source.rowKey === "net-worth";
  return {
    section: {
      section: ({ row, defaultContent }) =>
        isNetWorth(row) ? (
          <span className="block truncate text-subheading">{label}</span>
        ) : (
          defaultContent
        ),
      section_total: ({ row, defaultContent }) =>
        isNetWorth(row) ? (
          <span className="block w-full *:text-subheading *:font-semibold">
            {defaultContent}
          </span>
        ) : (
          defaultContent
        ),
    },
  };
}

export function BalanceSheetReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const asOfDate = searchParams.get("as_of_date") ?? today();
  const report = useReportResult(["balance-sheet", asOfDate], () =>
    callReport({ as_of_date: asOfDate }),
  );
  const cells = useMemo(() => netWorthCells(asOfDate), [asOfDate]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <ReportScreenFrame
      title="Balance Sheet"
      subtitle="Net worth is what you own minus what you owe."
    >
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
        renderCell={cells}
      />
    </ReportScreenFrame>
  );
}

function callReport(params: { as_of_date: string }): Promise<GridDataset> {
  return reportsApi.balanceSheet({
    query: { as_of_date: params.as_of_date },
  });
}
