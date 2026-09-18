import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  reportsContract,
  type IncomeExpenses,
  type IncomeExpensesAccount,
} from "dbu6-shared";
import { accountTree, type AccountNode } from "../account-tree.js";
import {
  loadAccountAmounts,
  loadMonthlyAmounts,
  type AccountAmount,
  type IncomeSpendingType,
} from "./account-amounts.js";
import { authorizeReport } from "./shared.js";
import type { LedgerAuth } from "../../modules/ledger-sql/index.js";

/*
 * Income and Expenses (PLAN.md §11 P4): income and spending for a period
 * as two account trees, month by month, and the first month there is
 * anything to show. Every figure comes from the amounts module the income
 * statement reads, so the two agree.
 */

const api = new TsRestApi<SapportaEnv>();

api.register(
  "incomeExpenses",
  reportsContract.incomeExpenses,
  ({ c, request }) => {
    const auth = authorizeReport(c, "income-expenses");
    return {
      status: 200,
      body: incomeExpensesReport(c.get("sqlite"), auth, {
        fromDate: request.query.from_date,
        toDate: request.query.to_date,
      }),
    };
  },
);

export default api;

export function incomeExpensesReport(
  sqlite: Database.Database,
  auth: LedgerAuth,
  query: { fromDate: string; toDate: string },
): IncomeExpenses {
  const { fromDate, toDate } = query;
  const accounts = loadAccountAmounts(sqlite, auth, {
    types: ["Revenue", "Expense"],
    fromDate,
    toDate,
  });
  const inPeriod = new Map(
    loadMonthlyAmounts(sqlite, auth, { fromDate, toDate }).map((row) => [
      row.month,
      row,
    ]),
  );
  const firstMonth =
    loadMonthlyAmounts(sqlite, auth, { fromDate: null, toDate: null })[0]
      ?.month ?? null;

  return {
    income: section(accounts, "Revenue"),
    spending: section(accounts, "Expense"),
    months: monthsBetween(fromDate, toDate).map(
      (month) => inPeriod.get(month) ?? { month, income: 0, spending: 0 },
    ),
    first_month: firstMonth,
  };
}

function section(
  accounts: readonly AccountAmount[],
  type: IncomeSpendingType,
): IncomeExpenses["income"] {
  const nodes = accountTree(
    accounts.filter((account) => account.account_type === type),
  );
  return {
    total: nodes.reduce((total, node) => total + node.total, 0),
    accounts: nodes.map(wireNode),
  };
}

function wireNode(node: AccountNode<AccountAmount>): IncomeExpensesAccount {
  return {
    account_id: node.account.account_id,
    name: node.account.name,
    own: node.own,
    total: node.total,
    children: node.children.map(wireNode),
  };
}

/** Every month, as `YYYY-MM`, from the first date's month to the second's. */
export function monthsBetween(fromDate: string, toDate: string): string[] {
  const months: string[] = [];
  let year = Number(fromDate.slice(0, 4));
  let month = Number(fromDate.slice(5, 7));
  const last = toDate.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
