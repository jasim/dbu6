import {
  accountLedgerRow,
  apiErrorMessage,
  Button,
  HledgerDialog,
  type RenderedHledger,
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
  plural,
  useReportResult,
  useSearchParams,
  useState,
  useAccountParentPaths,
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
  const { period, dates, setPeriod } = useReportPeriod({
    defaultPreset: "last-3-months",
  });
  const accountLookup = useTableLookup("accounts");
  const parentPaths = useAccountParentPaths();
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
  const [hledger, setHledger] = useState<RenderedHledger | null>(null);
  const [hledgerError, setHledgerError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // The journals behind the ledger's rows, for the account and period shown.
  const renderHledger = async () => {
    setRendering(true);
    setHledgerError(null);
    try {
      setHledger(
        await reportsApi.accountLedgerHledger({
          query: { account_id: Number(accountId), ...dates },
        }),
      );
    } catch (error) {
      setHledger(null);
      setHledgerError(apiErrorMessage(error));
    } finally {
      setRendering(false);
    }
  };

  const setAccount = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("account_id", value);
    else next.delete("account_id");
    setSearchParams(next, { replace: true });
  };

  return (
    // The report's label names the account, and the subtitle where it sits.
    <ReportScreenFrame
      title={report.result?.label ?? "Account Ledger"}
      subtitle={
        (hasAccount && parentPaths.byId(Number(accountId))) || undefined
      }
    >
      <ReportToolbar
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasAccount || rendering}
              onClick={renderHledger}
            >
              {rendering ? "Rendering..." : "Render as hledger"}
            </Button>
            <ReportRunButton
              loading={report.loading}
              disabled={!hasAccount}
              onClick={report.run}
            />
          </>
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
      <HledgerDialog
        result={hledger}
        error={hledgerError}
        description={plural(hledger?.journal_count ?? 0, "journal")}
        empty="No journals in this period."
        onClose={() => {
          setHledger(null);
          setHledgerError(null);
        }}
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
