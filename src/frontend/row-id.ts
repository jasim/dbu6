/*
 * A table row's id, as a URL carries it. The routes, the query strings and
 * the links between screens all name a row the same way, so the one rule for
 * reading one back lives here rather than in each screen that reads one.
 *
 * Rows are numbered from 1, and a URL is text somebody can edit: a missing
 * segment, an empty one, a name, `0`, a negative number and `1e3` are all
 * ways of not naming a row.
 */

/** The row id in a URL segment or query value, or null when it isn't one. */
export function parseRowId(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
