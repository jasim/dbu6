// The route's query and response, read by both sides: api.ts registers it
// and Screen.tsx calls it. In the browser `dbu6/server` holds only what a
// contract needs (initContract, z, the grid schema), so importing it here is
// safe; nothing else from `dbu6/server` may be imported by a file the screen
// reaches.
import {
  errorBodySchema,
  gridDatasetSchema,
  initContract,
  z,
} from "dbu6/server";

const c = initContract();

export const spendingByWeekdayContract = c.router({
  spendingByWeekday: c.query({
    method: "GET",
    // Served as /api/reports/spending-by-weekday. Do not repeat /api here.
    path: "/reports/spending-by-weekday",
    summary: "Spending by Weekday",
    metadata: { tags: ["reports"] },
    query: z.object({
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    }),
    responses: {
      200: gridDatasetSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
});
