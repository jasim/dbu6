import {
  createSnapshotUrl,
  type ReportCellLink,
  type ReportCellLinkContext,
} from "@sapporta/frontend/report";

export type LedgerLinkInput = {
  from_date?: string;
  to_date?: string;
};

export function accountLedgerHref(
  accountId: unknown,
  input?: LedgerLinkInput,
): string | null {
  const id = asId(accountId);
  if (!id) return null;
  return createSnapshotUrl("/reports/account-ledger", {
    account_id: id,
    from_date: input?.from_date,
    to_date: input?.to_date,
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
