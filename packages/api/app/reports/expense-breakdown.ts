import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { accountTree, type AccountNode } from "../account-tree.js";
import { loadAccountAmounts, type AccountAmount } from "./account-amounts.js";
import {
  authorizeReport,
  footerRow,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  textColumn,
} from "./shared.js";
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
 * `parent_id`). The rows are the top-level expense accounts, such as
 * "Expenses", open; under each, its sub-accounts as categories, with
 * everything on and below them, closed; under a category, each account with
 * entries of its own. Entries on a top-level account itself make a category
 * of their own, so every entry counts exactly once.
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
  return toExpenseBreakdownResult(accountTree(accounts).map(topAccount));
}

type ExpenseNode = AccountNode<AccountAmount>;

type AccountRow = { account_id: number; name: string; amount: number };

type Category = {
  category_id: number;
  category_name: string;
  total: number;
  accounts: AccountRow[];
};

type TopAccount = {
  top_id: number;
  top_name: string;
  total: number;
  categories: Category[];
};

function topAccount(node: ExpenseNode): TopAccount {
  const { account } = node;
  const categories = node.children.map((child): Category => ({
    category_id: child.account.account_id,
    category_name: child.account.name,
    total: child.total,
    accounts: ownAmounts(child),
  }));
  if (node.own !== 0) {
    categories.push({
      category_id: account.account_id,
      category_name:
        node.children.length > 0
          ? `${account.name}, not in a sub-account`
          : account.name,
      total: node.own,
      accounts: [
        {
          account_id: account.account_id,
          name: account.name,
          amount: node.own,
        },
      ],
    });
  }
  return {
    top_id: account.account_id,
    top_name: account.name,
    total: node.total,
    categories,
  };
}

/** The node and every account below it with entries of its own, largest first. */
function ownAmounts(node: ExpenseNode): AccountRow[] {
  const walk = (current: ExpenseNode): AccountRow[] => [
    ...(current.own !== 0
      ? [
          {
            account_id: current.account.account_id,
            name: current.account.name,
            amount: current.own,
          },
        ]
      : []),
    ...current.children.flatMap(walk),
  ];
  return walk(node).sort((a, b) => b.amount - a.amount);
}

function toExpenseBreakdownResult(tops: TopAccount[]): GridDataset {
  const levelColumns = {
    top: [
      hiddenIdColumn("top_id", "Account ID"),
      textColumn("top_name", "Account", { width: 52 }),
      moneyColumn("top_total", "Total", { width: 18, strong: true }),
    ],
    category: [
      hiddenIdColumn("category_id", "Category ID"),
      textColumn("category_name", "Category", { width: 52 }),
      moneyColumn("category_total", "Total", { width: 18, strong: true }),
    ],
    accounts: [
      hiddenIdColumn("account_id", "Account ID"),
      textColumn("name", "Account", { width: 52 }),
      moneyColumn("amount", "Amount", { width: 18 }),
    ],
  };
  const data = tops.map((top) => ({
    rowKey: `top:${top.top_id}`,
    levelName: "top",
    columns: { top_id: top.top_id, top_name: top.top_name },
    rollup: { top_total: top.total },
    children: {
      category: top.categories.map((category) => ({
        rowKey: `category:${category.category_id}`,
        levelName: "category",
        columns: {
          category_id: category.category_id,
          category_name: category.category_name,
        },
        rollup: { category_total: category.total },
        children: {
          accounts: category.accounts.map((row) => ({
            rowKey: `account:${row.account_id}`,
            levelName: "accounts",
            columns: row,
          })),
        },
      })),
    },
  }));

  return {
    name: "expense-breakdown",
    label: "Expense Breakdown",
    rootLevel: "top",
    levels: {
      top: {
        columns: levelColumns.top,
        childLevels: ["category"],
        rowLinks: [openRecordLink("accounts", "top_id", "Open account")],
      },
      category: {
        columns: levelColumns.category,
        childLevels: ["accounts"],
        // One level of spending shows: the categories, not their accounts.
        defaultCollapsed: true,
        rowLinks: [
          openRecordLink("accounts", "category_id", "Open category account"),
        ],
      },
      accounts: {
        columns: levelColumns.accounts,
        childLevels: [],
        rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
      },
    },
    nodes: data,
    footerRows: [
      footerRow(
        {
          rowKey: "total-expenses",
          label: "Total Expenses",
          columns: {
            top_total: tops.reduce((total, top) => total + top.total, 0),
          },
        },
        levelColumns.top,
      ),
    ],
  };
}

export default api;
