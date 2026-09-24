import {
  accountLedgerRow,
  type LedgerLinkInput,
  LookupPicker,
  type LookupValue,
  type ReportCellLinkResolvers,
  ReportPeriodField,
  ReportResultBody,
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  useReportPeriod,
  useReportResult,
  useSearchParams,
  useTableLookup,
} from "../report-kit";
import { reportsApi } from "./client";

const links = {
  // A row against one account links to that account's ledger.
  entries: {
    cell: { against: accountLedgerRow("against_account_id") },
  },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function AccountLedgerReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get("account_id") ?? "";
  const { period, dates, setPeriod } = useReportPeriod();
  const accountLookup = useTableLookup("accounts");
  const selectedAccount = lookupValueFromParam(accountId);
  const hasAccount = accountId !== "";
  const report = useReportResult(
    ["account-ledger", accountId, dates],
    () =>
      reportsApi.accountLedger({
        query: { account_id: Number(accountId), ...dates },
      }),
    hasAccount,
  );

  const setAccount = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("account_id", value);
    else next.delete("account_id");
    setSearchParams(next, { replace: true });
  };

  return (
    // The report's label names the account.
    <ReportScreenFrame title={report.result?.label ?? "Account Ledger"}>
      <ReportToolbar
        actions={
          <ReportRunButton
            loading={report.loading}
            disabled={!hasAccount}
            onClick={report.run}
          />
        }
      >
        <label className="flex items-center gap-2 text-sap-data">
          <span className="text-sap-muted">account:</span>
          <LookupPicker
            lookup={accountLookup}
            value={selectedAccount}
            onChange={(value) => setAccount(value == null ? "" : String(value))}
            placeholder="Select account"
            className="h-sap-ctl min-w-[140px] rounded-[5px] text-sap-emph"
          />
        </label>
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

function lookupValueFromParam(value: string): LookupValue | null {
  if (value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && String(numericValue) === value
    ? numericValue
    : value;
}
