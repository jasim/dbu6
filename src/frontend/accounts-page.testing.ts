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

/**
 * `GET /tables/accounts/_lookup` over `rows` as the server answers it: by
 * `ids` unnarrowed, else the search narrowed by `filter[account_type][eq]`
 * and `notUnder` (the account and every account under it).
 */
export function accountsLookup(
  rows: readonly (PathAccount & { account_type?: string })[],
  url: URL,
) {
  const ids = url.searchParams.get("ids")?.split(",");
  const type = url.searchParams.get("filter[account_type][eq]");
  const notUnder = url.searchParams.get("notUnder");
  const under = (row: PathAccount): boolean => {
    const walked = new Set<number>();
    for (
      let at: PathAccount | undefined = row;
      at !== undefined && !walked.has(at.id);
      at = rows.find((one) => one.id === at?.parent_id)
    ) {
      if (String(at.id) === notUnder) return true;
      walked.add(at.id);
    }
    return false;
  };
  const found =
    ids !== undefined
      ? rows.filter((row) => ids.includes(String(row.id)))
      : rows.filter(
          (row) =>
            (type === null || row.account_type === type) &&
            (notUnder === null || !under(row)),
        );
  return {
    entries: found.map((row) => ({
      value: row.id,
      label: row.name,
      meta: row,
    })),
  };
}
