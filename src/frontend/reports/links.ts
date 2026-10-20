import {
  createSnapshotUrl,
  type ReportCellLink,
  type ReportCellLinkContext,
} from "@sapporta/frontend/report";

export type LedgerLinkInput = {
  from_date?: string;
  to_date?: string;
};

/**
 * An account's ledger. Without `input` it opens on the ledger's default
 * period; a report's period carries over, so a report over all time asks
 * for all time and its totals match the ledger's.
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
  return createSnapshotUrl("/reports/account-ledger", {
    account_id: id,
    period: allTime ? "all-time" : undefined,
    from_date: input?.from_date,
    to_date: input?.to_date,
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
