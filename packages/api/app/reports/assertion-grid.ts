import type { NavLink } from "@sapporta/shared/contracts";
import type { GridDatasetColumn } from "@sapporta/shared/grid-dataset";
import {
  accountLedgerLink,
  dateColumn,
  hiddenIdColumn,
  moneyColumn,
  textColumn,
} from "./shared.js";

export function assertionColumns(
  idName: string,
  idLabel: string,
  assertionLink: NavLink,
): GridDatasetColumn[] {
  return [
    textColumn("account_name", "Account", {
      width: 52,
      links: [accountLedgerLink({ account_id: "account_id", to_date: "date" })],
    }),
    dateColumn("date", "Date", { width: 12 }),
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
