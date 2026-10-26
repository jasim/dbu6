import {
  createSnapshotUrl,
  type ReportCellLink,
  type ReportCellLinkContext,
} from "@sapporta/frontend/report";
import { financialYearOf, financialYearSpan } from "./periods";

export type LedgerLinkInput = {
  from_date?: string;
  to_date?: string;
};

/**
 * An account's ledger. Without `input` it opens on the ledger's default
 * period; a report's period carries over, so a report over all time asks
 * for all time and its totals match the ledger's. A balance as of a day
 * opens its financial year to that day, from the balance brought forward.
 */
export function accountLedgerHref(
  accountId: unknown,
  input?: LedgerLinkInput,
): string | null {
  const id = asId(accountId);
  if (!id) return null;
  const allTime =
    input !== undefined &&
    input.from_date === undefined &&
    input.to_date === undefined;
  const toDate = input?.to_date;
  const fromDate =
    input?.from_date ??
    (toDate === undefined
      ? undefined
      : financialYearSpan(financialYearOf(toDate.slice(0, 7))).first_date);
  return createSnapshotUrl("/reports/account-ledger", {
    account_id: id,
    period: allTime ? "all-time" : undefined,
    from_date: fromDate,
    to_date: toDate,
  });
}

/** A journal in the Journals table, with its lines. */
export function journalHref(journalId: number): string {
  return `/tables/journals?filter[id][eq]=${journalId}`;
}

/** Every posted balance check the books miss (Reconciliation Differences). */
export const RECONCILIATION_DIFFERENCES_HREF = "/reports/balance-assertions";

/** The income statement over the days from `fromDate` to `toDate`. */
export function incomeStatementHref(fromDate: string, toDate: string): string {
  return createSnapshotUrl("/reports/income-statement", {
    from_date: fromDate,
    to_date: toDate,
  });
}

/**
 * Income and Expenses over the days from `fromDate` to `toDate`, optionally
 * with an account in focus and a month (`YYYY-MM`) of its chart selected.
 */
export function incomeExpensesHref(
  fromDate: string,
  toDate: string,
  focus?: { accountId?: number; month?: string },
): string {
  return createSnapshotUrl("/reports/income-expenses", {
    from_date: fromDate,
    to_date: toDate,
    account: focus?.accountId?.toString(),
    month: focus?.month,
  });
}

/** The balance sheet as of a day. */
export function balanceSheetHref(asOfDate: string): string {
  return createSnapshotUrl("/reports/balance-sheet", {
    as_of_date: asOfDate,
  });
}

export function accountLedgerRow<
  TInput extends LedgerLinkInput = LedgerLinkInput,
>(idColumn = "account_id") {
  return ({ node, input }: ReportCellLinkContext<TInput>): ReportCellLink[] => {
    const href = accountLedgerHref(node.columns[idColumn], input);
    return href
      ? [
          {
            label: "Open account ledger",
            href,
            icon: "report",
          },
        ]
      : [];
  };
}

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value;
  return null;
}
