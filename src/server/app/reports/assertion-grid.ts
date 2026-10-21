import {
  accountLedgerLink,
  dateColumn,
  type GridDatasetColumn,
  hiddenIdColumn,
  moneyColumn,
  type NavLink,
  parentPathColumn,
  textColumn,
} from "../../report-kit.js";

/**
 * The columns of a balance assertion grid. A grid narrowed to one account
 * leaves the Account column out, and its date carries the ledger link. The
 * Account column takes its parent path from `account_name_parent_path`.
 */
export function assertionColumns(
  idName: string,
  idLabel: string,
  assertionLink: NavLink,
  options: { accountColumn: boolean } = { accountColumn: true },
): GridDatasetColumn[] {
  const ledgerLink = accountLedgerLink({
    account_id: "account_id",
    to_date: "date",
  });
  return [
    ...(options.accountColumn
      ? [
          textColumn("account_name", "Account", {
            width: 52,
            links: [ledgerLink],
          }),
          parentPathColumn("account_name"),
        ]
      : []),
    dateColumn("date", "Date", {
      width: 12,
      ...(options.accountColumn ? {} : { links: [ledgerLink] }),
    }),
    hiddenIdColumn(idName, idLabel),
    moneyColumn("running_balance", "Running Balance", { width: 18 }),
    moneyColumn("assertion", "Assertion", {
      width: 18,
      links: [assertionLink],
    }),
    moneyColumn("diff", "Diff", {
      width: 16,
      colorRule: "signed",
      strong: true,
    }),
  ];
}
