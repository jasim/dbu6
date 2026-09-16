import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountPathName,
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
import { authorizeReport, type ScopeParams } from "./shared.js";

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
    const scope = authorizeReport(c, "income-expenses");
    return {
      status: 200,
      body: incomeExpensesReport(c.get("sqlite"), {
        ...scope,
        fromDate: request.query.from_date,
        toDate: request.query.to_date,
      }),
    };
  },
);

export default api;

export function incomeExpensesReport(
  sqlite: Database.Database,
  query: ScopeParams & { fromDate: string; toDate: string },
): IncomeExpenses {
  const { fromDate, toDate, ...scope } = query;
  const accounts = loadAccountAmounts(sqlite, scope, {
    types: ["Revenue", "Expense"],
    fromDate,
    toDate,
  });
  const inPeriod = new Map(
    loadMonthlyAmounts(sqlite, scope, { fromDate, toDate }).map((row) => [
      row.month,
      row,
    ]),
  );
  const firstMonth =
    loadMonthlyAmounts(sqlite, scope, { fromDate: null, toDate: null })[0]
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
    path: node.account.name,
    name: accountPathName(node.account.name),
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
