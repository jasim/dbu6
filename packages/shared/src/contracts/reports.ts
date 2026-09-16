import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { gridDatasetSchema } from "@sapporta/shared/grid-dataset";

const c = initContract();

const dateQuery = z.object({
  as_of_date: z.string(),
});

const optionalDateRangeQuery = z.object({
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

const noParamsQuery = z.object({});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD")
  .refine((value) => {
    // Date rolls 30 February over into March; a real date survives the trip.
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, "Not a date on the calendar");

// Both dates are required and in order: the page always resolves its period.
const incomeExpensesQuery = z
  .object({ from_date: isoDate, to_date: isoDate })
  .refine((query) => query.from_date <= query.to_date, {
    message: "from_date must not be after to_date",
    path: ["from_date"],
  });

type IncomeExpensesAccountShape = {
  account_id: number;
  path: string;
  name: string;
  own: number;
  total: number;
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
    // The ledger path; the screens show `name` and keep this for tooltips.
    path: z.string(),
    name: z.string(),
    own: z.number(),
    total: z.number(),
    // Ranked by total, largest first, then by path. Subtrees without
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
  // The first month with any income or spending entry, at any date.
  first_month: z.string().nullable(),
});
export type IncomeExpenses = z.infer<typeof incomeExpensesSchema>;

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
    query: dateQuery,
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
    query: dateQuery,
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
    query: optionalDateRangeQuery,
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
    query: optionalDateRangeQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  incomeExpenses: c.query({
    method: "GET",
    path: "/reports/income-expenses",
    summary: "Income and Expenses",
    metadata: { tags: ["reports"] },
    query: incomeExpensesQuery,
    responses: {
      200: incomeExpensesSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
  expenseBreakdown: c.query({
    method: "GET",
    path: "/reports/expense-breakdown",
    summary: "Expense Breakdown",
    metadata: { tags: ["reports"] },
    query: optionalDateRangeQuery,
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
    query: z.object({
      account_id: z.coerce.number().int().positive(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    }),
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
    query: optionalDateRangeQuery,
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
    query: optionalDateRangeQuery,
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
