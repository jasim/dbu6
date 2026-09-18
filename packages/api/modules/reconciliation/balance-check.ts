import { asc, desc, type SQL } from "drizzle-orm";
import { draftTransactionsTable } from "../../schema/draft-journals.js";
import { HALF_PAISA, type Chrono } from "../values/index.js";

/*
 * The draft balance check. Each day a statement covers closes at the balance
 * it prints last on that day. The day's drafts carry that closing on their
 * last draft, and the check adds up the account's posted entries and then its
 * drafts, day by day, and compares the running balance at each assertion with
 * the balance asserted.
 *
 * Only the day's last draft carries it. Within a day, drafts go in id order,
 * the order they were saved, which can differ from the order the statement
 * prints (LLM output, multi-file merges). A balance on a draft in the middle
 * of the day would then fail even when the day's closing is right; once the
 * whole day is added up, the order no longer matters.
 *
 * An assertion, on a draft or a posted entry, holds when the running balance
 * is the same amount (`sameAmount` in values).
 */

/** Each date's closing: the last balance the statement prints on it. */
export function dayClosings(
  rows: Chrono<{ date: string; balance: number | null }>,
): Map<string, number> {
  const closings = new Map<string, number>();
  for (const row of rows) {
    if (row.balance !== null) closings.set(row.date, row.balance);
  }
  return closings;
}

/** Drafts in the order the check adds them up: by date, then by id. */
export function draftOrderSql(
  alias: string,
  direction: "ASC" | "DESC" = "ASC",
): string {
  return `${alias}.date ${direction}, ${alias}.id ${direction}`;
}

/** `draftOrderSql` as a Drizzle `orderBy`; "desc" puts a day's last first. */
export function draftOrderBy(direction: "asc" | "desc" = "asc"): SQL[] {
  const by = direction === "asc" ? asc : desc;
  return [by(draftTransactionsTable.date), by(draftTransactionsTable.id)];
}

/** SQL that is true when a running balance misses the balance asserted. */
export function assertionFailsSql(running: string, asserted: string): string {
  return `ABS(${running} - ${asserted}) >= ${HALF_PAISA}`;
}
