import { ACCOUNT_PATH_SEPARATOR } from "../shared/index";

/** An account as the tests hand it to the stand-in server. */
type PathAccount = { id: number; name: string; parent_id: number | null };

/** Each account's parent path by id, as the server's `treePath()` gives it. */
function parentPaths(
  rows: readonly PathAccount[],
): Record<number, string | null> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Object.fromEntries(
    rows.map((row) => {
      const names: string[] = [];
      const walked = new Set([row.id]);
      for (
        let at = row.parent_id === null ? undefined : byId.get(row.parent_id);
        at !== undefined && !walked.has(at.id);
        at = at.parent_id === null ? undefined : byId.get(at.parent_id)
      ) {
        walked.add(at.id);
        names.unshift(at.name);
      }
      return [
        row.id,
        names.length === 0 ? null : names.join(ACCOUNT_PATH_SEPARATOR),
      ];
    }),
  );
}

/**
 * A `GET /tables/accounts` page holding `rows`, for tests that stand in for
 * the server, with each account's computed `parentPath` beside them.
 */
export function accountsTablePage(rows: readonly PathAccount[]) {
  return {
    data: rows,
    meta: { total: rows.length, page: 1, limit: 1000, pages: 1 },
    computed: { parentPath: parentPaths(rows) },
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
