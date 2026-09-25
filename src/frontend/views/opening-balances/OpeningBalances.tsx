import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import { Checkbox } from "@sapporta/ui";
import { apiErrorMessage, openingBalancesApi } from "../../api";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { openingBalancesQuery, refreshDraftStatus } from "../../queries";
import {
  OpeningBalanceDialog,
  type OpeningBalanceEntry,
} from "./OpeningBalanceDialog";
import { OpeningBalancesTable } from "./OpeningBalancesTable";
import { openingRows, withSampleDate, type OpeningRow } from "./opening-rows";

export const OPENING_BALANCES_ROUTE = "/opening-balances";

/**
 * The screen, scrolled to one account's row (names are unique). With
 * `sampleFirstDate`, the first date of a sample statement the setup wizard
 * read, the account's date defaults to the day before it.
 */
export function openingBalanceHref(
  accountName: string,
  sampleFirstDate?: string,
): string {
  const params = new URLSearchParams({ account: accountName });
  if (sampleFirstDate) params.set("date", sampleFirstDate);
  return `${OPENING_BALANCES_ROUTE}?${params}`;
}

/*
 * Opening balances: what each asset and liability account held or owed the
 * day before its first transaction. The screen lists the accounts still
 * waiting for one, and adding it posts that account's opening entry against
 * Opening Balances (Equity), where every balance check on the account then
 * starts. An entry once in the books is shown, not edited here.
 */
export function OpeningBalances() {
  usePageTitle("Opening balances");
  const client = useQueryClient();
  const balances = useQuery(openingBalancesQuery);
  const [params] = useSearchParams();
  const focused = params.get("account");
  const sampleDate = params.get("date");
  const [showRecorded, setShowRecorded] = useState(false);
  const [adding, setAdding] = useState<OpeningRow | null>(null);

  const all = useMemo(() => {
    const rows = balances.data ? openingRows(balances.data) : [];
    return focused && sampleDate
      ? withSampleDate(rows, focused, sampleDate)
      : rows;
  }, [balances.data, focused, sampleDate]);
  const recorded = all.filter((row) => row.recorded !== null).length;
  // An account the books already hold is out of the way unless asked for, so
  // what is left is what still needs an opening balance. A link from
  // elsewhere names its account, which may be one of the recorded ones.
  const focusedIsRecorded = all.some(
    (row) => row.name === focused && row.recorded !== null,
  );
  const shown =
    showRecorded || focusedIsRecorded
      ? all
      : all.filter((row) => row.recorded === null);

  const add = async (row: OpeningRow, entry: OpeningBalanceEntry) => {
    const body = await openingBalancesApi.record({
      body: { account_id: row.accountId, ...entry },
    });
    // The books changed: this screen's rows, and everything counting drafts.
    await client.invalidateQueries({ queryKey: openingBalancesQuery.queryKey });
    void refreshDraftStatus(client);
    return body;
  };

  return (
    <Screen
      width="wide"
      header={
        <ScreenTitle title="Opening balances">
          <p>
            What each account held or owed on the day before its first
            transaction. Without it, every balance check on the account is off
            by the same amount.
          </p>
          <p>
            For assets you own, the balance goes into debit; for loans and
            borrowing, it goes to credit. Adding one posts it against{" "}
            {balances.data?.equity_account?.name ?? "Opening Balances"}, an
            Equity account
            {balances.data?.equity_account ? "" : " made on the first one"}.
          </p>
        </ScreenTitle>
      }
    >
      <div className="mt-8">
        {balances.isPending && (
          <p className="text-body text-ink-meta">Loading accounts…</p>
        )}
        {balances.isError && (
          <LoadError
            title="Couldn't load the accounts"
            message={apiErrorMessage(balances.error)}
            retry={() => void balances.refetch()}
          />
        )}
        {balances.data && (
          <>
            <div className="mb-3 flex min-h-sap-ctl flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <p className="text-body text-ink-soft">
                {waitingText(all.length - recorded)}
              </p>
              {recorded > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-meta text-ink-soft">
                  <Checkbox
                    checked={showRecorded || focusedIsRecorded}
                    disabled={focusedIsRecorded}
                    onCheckedChange={(checked) => setShowRecorded(checked)}
                  />
                  Show the {recorded} account{recorded === 1 ? "" : "s"} already
                  in the books
                </label>
              )}
            </div>
            {shown.length === 0 ? (
              <EmptyState
                title={
                  all.length === 0
                    ? "No bank, card or loan accounts yet"
                    : "Every account has its opening balance"
                }
                body={
                  all.length === 0
                    ? "Add your asset and liability accounts first, then come back to set where each one started."
                    : "Tick the box above to see the entries already in your books."
                }
              />
            ) : (
              <OpeningBalancesTable
                rows={shown}
                onAdd={setAdding}
                focusAccount={focused}
              />
            )}
          </>
        )}
      </div>
      <OpeningBalanceDialog
        row={adding}
        add={add}
        onClose={() => setAdding(null)}
      />
    </Screen>
  );
}

function waitingText(waiting: number): string {
  if (waiting === 0) return "Nothing is waiting for an opening balance.";
  return `${waiting} account${waiting === 1 ? "" : "s"} still ${waiting === 1 ? "needs" : "need"} an opening balance.`;
}
