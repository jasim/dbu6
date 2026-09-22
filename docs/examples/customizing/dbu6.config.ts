// A project's optional dbu6.config.ts: the one file through which the server
// is changed. dbu6 finds it by name in the project root and calls what it
// exports; everything in it is an addition.
import {
  defineConfig,
  errorBodySchema,
  initContract,
  mountApi,
  reportLedger,
  TsRestApi,
  z,
  type SapportaEnv,
} from "dbu6/server";

// A route that is not a report: how many accounts the signed-in user has of
// each type. Served as GET /api/account-counts (the path does not repeat
// /api), listed in the app's OpenAPI document, and callable with an agent
// access token like every other route.
const c = initContract();
const accountCountsContract = c.router({
  accountCounts: c.query({
    method: "GET",
    path: "/account-counts",
    summary: "Accounts by type",
    responses: {
      200: z.array(
        z.object({ account_type: z.string(), accounts: z.number() }),
      ),
      403: errorBodySchema,
    },
  }),
});

const api = new TsRestApi<SapportaEnv>();
api.register("accountCounts", accountCountsContract.accountCounts, ({ c }) => ({
  status: 200,
  // The signed-in user's books, read-only: the same ledger a report reads.
  body: reportLedger(c, "account-counts").all<{
    account_type: string;
    accounts: number;
  }>(
    `SELECT account_type, COUNT(*) AS accounts
     FROM scoped_accounts
     GROUP BY account_type
     ORDER BY account_type`,
  ),
}));

export default defineConfig({
  // `extend` runs once, after dbu6's routes and the project's reports are
  // mounted and before OpenAPI is generated. `app.api` is the private /api
  // sub-app; `app.hono` is the whole server, where a route is public.
  extend(app) {
    mountApi(app.api, api);
  },
});
