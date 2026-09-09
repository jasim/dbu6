import { useSearchParams } from "react-router-dom";
import {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  type ReportCellLinkResolvers,
} from "@sapporta/frontend/report";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import type { LookupValue } from "@sapporta/grid/lookup";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsApi } from "../api";
import { accountLedgerRow, type LedgerLinkInput } from "./links";
import { DateInput, ReportResultBody, useReportResult } from "./shared";

const links = {
  journal_entries: {
    cell: { account_name: accountLedgerRow() },
  },
} satisfies ReportCellLinkResolvers<LedgerLinkInput>;

export function AccountLedgerReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get("account_id") ?? "";
  const fromDate = searchParams.get("from_date") ?? "";
  const toDate = searchParams.get("to_date") ?? "";
  const accountLookup = useTableLookup("accounts");
  const selectedAccount = lookupValueFromParam(accountId);
  const hasAccount = accountId !== "";
  const report = useReportResult(
    () =>
      callReport({
        account_id: accountId,
        from_date: fromDate,
        to_date: toDate,
      }),
    [accountId, fromDate, toDate],
    hasAccount,
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <ReportScreenFrame title="Account Ledger">
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
            onChange={(value) =>
              setParam("account_id", value == null ? "" : String(value))
            }
            placeholder="Select account"
            className="h-sap-ctl min-w-[140px] rounded-[5px] text-sap-emph"
          />
        </label>
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
  account_id: string;
  from_date: string;
  to_date: string;
}): Promise<GridDataset> {
  return reportsApi.accountLedger({
    query: {
      account_id: Number(params.account_id),
      from_date: params.from_date || undefined,
      to_date: params.to_date || undefined,
    },
  });
}

function lookupValueFromParam(value: string): LookupValue | null {
  if (value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && String(numericValue) === value
    ? numericValue
    : value;
}
