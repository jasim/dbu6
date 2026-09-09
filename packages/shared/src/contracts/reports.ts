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
    summary: "All In-flows to asset accounts",
    metadata: { tags: ["reports"] },
    query: optionalDateRangeQuery,
    responses: {
      200: gridDatasetSchema,
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
    summary: "Last Reconciled Entries",
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
    summary: "Balance Assertions",
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
    summary: "Draft Balance Assertions",
    metadata: { tags: ["reports"] },
    query: noParamsQuery,
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
    query: noParamsQuery,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
});
