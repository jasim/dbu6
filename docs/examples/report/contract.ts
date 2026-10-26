// The route's query and response, read by both sides: api.ts registers it
// and Screen.tsx calls it. In the browser `@dbu6/app/server` holds only what a
// contract needs (initContract, z, the grid and date schemas), so importing
// it here is safe; nothing else from `@dbu6/app/server` may be imported by a
// file the screen reaches.
import {
  errorBodySchema,
  gridDatasetSchema,
  initContract,
  reportDateRange,
} from "@dbu6/app/server";

const c = initContract();

export const spendingByWeekdayContract = c.router({
  spendingByWeekday: c.query({
    method: "GET",
    // Served as /api/reports/spending-by-weekday. Do not repeat /api here.
    path: "/reports/spending-by-weekday",
    summary: "Spending by Weekday",
    metadata: { tags: ["reports"] },
    // Real YYYY-MM-DD dates, in order; either end may be left open.
    query: reportDateRange,
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
});
