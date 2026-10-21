import { accountParentPaths, type PathAccount } from "../shared/index";

/**
 * A `GET /tables/accounts` page holding `rows`, for tests that stand in for
 * the server, with each account's computed `parentPath` beside them.
 */
export function accountsTablePage(rows: readonly PathAccount[]) {
  return {
    data: rows,
    meta: { total: rows.length, page: 1, limit: 1000, pages: 1 },
    computed: { parentPath: Object.fromEntries(accountParentPaths(rows)) },
  };
}
