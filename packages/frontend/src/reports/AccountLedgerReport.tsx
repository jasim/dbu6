import { useSearchParams } from "react-router-dom";
import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  type ReportCellLinkResolvers,
} from "@sapporta/frontend/report";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import type { LookupValue } from "@sapporta/grid/lookup";
import { reportsApi } from "../api";
import { accountLedgerRow, type LedgerLinkInput } from "./links";
import { ReportPeriodField, useReportPeriod } from "./ReportPeriodField";
import { ReportResultBody, useReportResult } from "./shared";

const links = {
  journal_entries: {
    cell: { account_name: accountLedgerRow() },
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
