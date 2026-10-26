import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { gridDatasetSchema } from "@sapporta/shared/grid-dataset";
import { dateSpanSchema } from "./date-span.js";
import {
  asOfDateQuery,
  reportDateRange,
  requiredReportDateRange,
} from "./dates.js";

const c = initContract();

// The balance sheet leaves Equity out unless asked, as `hledger bs` does
// next to `hledger bse`: net worth is then assets less liabilities.
const balanceSheetQuery = asOfDateQuery.extend({
  show_equity: z.enum(["true", "false"]).optional(),
});

const noParamsQuery = z.object({});

// Exported because the frontend's declarations name it (dist/frontend/*.d.ts).
export type IncomeExpensesAccountShape = {
  account_id: number;
  name: string;
  own: number;
  total: number;
  months: number[];
  children: IncomeExpensesAccountShape[];
};

/**
 * An income or spending account as Income and Expenses lists it, with its
 * children through `parent_id`. `own` is the amount of its own entries in the
 * period; `total` adds everything below it, so it matches the account's
 * history. Both are positive for income and for spending.
 */
export const incomeExpensesAccountSchema: z.ZodType<IncomeExpensesAccountShape> =
  z.object({
    account_id: z.number(),
    name: z.string(),
    own: z.number(),
    total: z.number(),
    // `total` month by month, aligned with the report's `months`.
    months: z.array(z.number()),
    // Ranked by total, largest first, then by name. Subtrees without
    // amounts in the period are left out.
    get children() {
      return z.array(incomeExpensesAccountSchema);
    },
  });
export type IncomeExpensesAccount = z.infer<typeof incomeExpensesAccountSchema>;

const incomeExpensesSectionSchema = z.object({
  total: z.number(),
  // The section's top accounts: no parent among that type's accounts.
  accounts: z.array(incomeExpensesAccountSchema),
});

// The first and last days of the posted journals; null while there are none.
// Drafts are not in the books yet, so they never count.
export const booksSpanSchema = z.object({ span: dateSpanSchema.nullable() });
export type BooksSpan = z.infer<typeof booksSpanSchema>;

export const incomeExpensesSchema = z.object({
  income: incomeExpensesSectionSchema,
  spending: incomeExpensesSectionSchema,
  // Every month from from_date's to to_date's, zero-filled.
  months: z.array(
    z.object({
      month: z.string(), // YYYY-MM
      income: z.number(),
      spending: z.number(),
    }),
  ),
});
export type IncomeExpenses = z.infer<typeof incomeExpensesSchema>;

const incomeExpensesEntriesQuery = requiredReportDateRange.extend({
  section: z.enum(["income", "spending"]),
});

/**
 * What one income or spending account moved in one journal, as Income and
 * Expenses lists it beside its accounts. `amount` is positive for income
 * and for spending; a refund is negative. `against` names the account on
 * the other side, such as the bank.
 */
export const incomeExpensesEntrySchema = z.object({
  key: z.string(),
  journal_id: z.number(),
  date: z.string(),
  narration: z.string(),
  against: z.string().nullable(),
  account_id: z.number(),
  amount: z.number(),
});
export type IncomeExpensesEntry = z.infer<typeof incomeExpensesEntrySchema>;

export const incomeExpensesEntriesSchema = z.object({
  // Oldest first, as the journals were written.
  entries: z.array(incomeExpensesEntrySchema),
});
export type IncomeExpensesEntries = z.infer<typeof incomeExpensesEntriesSchema>;

// The draft reports narrow to one base account for Review's tabs; without
// it they list every account.
const draftAccountQuery = z.object({
  base_account_id: z.coerce.number().int().positive().optional(),
});

export const reportsContract = c.router({
  trialBalance: c.query({
    method: "GET",
    path: "/reports/trial-balance",
    summary: "Trial Balance",
    metadata: { tags: ["reports"] },
    query: asOfDateQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  balanceSheet: c.query({
    method: "GET",
    path: "/reports/balance-sheet",
    summary: "Balance Sheet",
    metadata: { tags: ["reports"] },
    query: balanceSheetQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  incomeStatement: c.query({
    method: "GET",
    path: "/reports/income-statement",
    summary: "Income Statement",
    metadata: { tags: ["reports"] },
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  assetInflows: c.query({
    method: "GET",
    path: "/reports/asset-inflows",
    summary: "Asset Inflows",
    metadata: { tags: ["reports"] },
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  booksSpan: c.query({
    method: "GET",
    path: "/reports/books-span",
    summary: "The days the books cover",
    metadata: { tags: ["reports"] },
    query: noParamsQuery,
    responses: {
      200: booksSpanSchema,
      403: errorBodySchema,
    },
  }),
  incomeExpenses: c.query({
    method: "GET",
    path: "/reports/income-expenses",
    summary: "Income and Expenses",
    metadata: { tags: ["reports"] },
    // Both dates are required: the page always resolves its period.
    query: requiredReportDateRange,
    responses: {
      200: incomeExpensesSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  incomeExpensesEntries: c.query({
    method: "GET",
    path: "/reports/income-expenses/entries",
    summary: "Income and Expenses entries",
    metadata: { tags: ["reports"] },
    query: incomeExpensesEntriesQuery,
    responses: {
      200: incomeExpensesEntriesSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  expenseBreakdown: c.query({
    method: "GET",
    path: "/reports/expense-breakdown",
    summary: "Expense Breakdown",
    metadata: { tags: ["reports"] },
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  accountLedger: c.query({
    method: "GET",
    path: "/reports/account-ledger",
    summary: "Account Ledger",
    metadata: { tags: ["reports"] },
    query: reportDateRange.extend({
      account_id: z.coerce.number().int().positive(),
    }),
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  accountLedgerHledger: c.query({
    method: "GET",
    path: "/reports/account-ledger/hledger",
    summary: "Account Ledger's journals as hledger journal text",
    metadata: { tags: ["reports"] },
    query: reportDateRange.extend({
      account_id: z.coerce.number().int().positive(),
    }),
    responses: {
      200: z.object({
        hledger_journal: z.string(),
        journal_count: z.number(),
      }),
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  dayBook: c.query({
    method: "GET",
    path: "/reports/day-book",
    summary: "Day Book",
    metadata: { tags: ["reports"] },
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  monthlySummary: c.query({
    method: "GET",
    path: "/reports/monthly-summary",
    summary: "Monthly Summary",
    metadata: { tags: ["reports"] },
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  netWorth: c.query({
    method: "GET",
    path: "/reports/net-worth",
    summary: "Net Worth Over Time",
    metadata: { tags: ["reports"] },
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  lastReconciled: c.query({
    method: "GET",
    path: "/reports/last-reconciled",
    summary: "Last Reconciled Balances",
    metadata: { tags: ["reports"] },
    query: noParamsQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  balanceAssertions: c.query({
    method: "GET",
    path: "/reports/balance-assertions",
    summary: "Reconciliation Differences",
    metadata: { tags: ["reports"] },
    query: noParamsQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  draftBalanceAssertions: c.query({
    method: "GET",
    path: "/reports/draft-balance-assertions",
    summary: "Draft Reconciliation Differences",
    metadata: { tags: ["reports"] },
    query: draftAccountQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  duplicateDrafts: c.query({
    method: "GET",
    path: "/reports/duplicate-drafts",
    summary: "Duplicate Drafts",
    metadata: { tags: ["reports"] },
    query: draftAccountQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
});
