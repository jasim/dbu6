import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { accountTree, type AccountNode } from "../account-tree.js";
import { loadAccountAmounts, type AccountAmount } from "./account-amounts.js";
import { accountTreeLevel, accountTreeNodes } from "./account-tree-level.js";
import { authorizeReport, footerRow, moneyColumn } from "./shared.js";
import type { LedgerAuth } from "../../modules/ledger-sql/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "expenseBreakdown",
  reportsContract.expenseBreakdown,
  ({ c, request }) => {
    const auth = authorizeReport(c, "expense-breakdown");
    return {
      status: 200,
      body: expenseBreakdownReport(c.get("sqlite"), auth, {
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      }),
    };
  },
);

/**
 * Spending in the period down the account tree (`accountTree`, by
 * `parent_id`), as one tree level (`accountTreeLevel`). An account's row
 * carries everything on and below it, siblings largest first, and a parent's
 * own entries get a row of their own under it, so every entry counts once.
 * The footer totals the period's spending.
 */
export function expenseBreakdownReport(
  sqlite: Database.Database,
  auth: LedgerAuth,
  query: { fromDate: string | null; toDate: string | null },
): GridDataset {
  const { fromDate, toDate } = query;
  const accounts = loadAccountAmounts(sqlite, auth, {
    types: ["Expense"],
    fromDate,
    toDate,
  });
  return toExpenseBreakdownResult(accountTree(accounts));
}

function toExpenseBreakdownResult(
  tree: AccountNode<AccountAmount>[],
): GridDataset {
  const level = accountTreeLevel({
    nameWidth: 52,
    columns: [moneyColumn("amount", "Amount", { width: 18 })],
  });
  return {
    name: "expense-breakdown",
    label: "Expense Breakdown",
    rootLevel: "accounts",
    levels: { accounts: level },
    nodes: accountTreeNodes(tree, "accounts", (_account, amount) => ({
      amount,
    })),
    footerRows: [
      footerRow(
        {
          rowKey: "total-expenses",
          label: "Total Expenses",
          columns: {
            amount: tree.reduce((total, node) => total + node.total, 0),
          },
        },
        level.columns,
      ),
    ],
  };
}

export default api;
