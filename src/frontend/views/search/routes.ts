/** The Search page. */
export const SEARCH_ROUTE = "/search";

/** The Search page with `q` searched. */
export function searchHref(q: string): string {
  const trimmed = q.trim();
  return trimmed === ""
    ? SEARCH_ROUTE
    : `${SEARCH_ROUTE}?${new URLSearchParams({ q: trimmed })}`;
}
