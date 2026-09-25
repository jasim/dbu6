import type { SetupStatus } from "../../shared/index";
import { addHref } from "../add-account/state";

/*
 * `/setup` is card 1 of the first run (PLAN.md "The cards"): the chart of
 * accounts, picked once, before anything is imported. Books that have a
 * chart have no business there, so `/setup` sends them on to where the
 * first run stands, read from the books: card 2 until a bank or card has
 * transactions, else Home. A bank or card set up with none yet (by an agent,
 * the old Banks & cards step, or an add refused partway) still needs its
 * statements, which /add takes.
 */

/** Where `/setup` sends the books, or null when it shows card 1. */
export function setupRedirect(
  status: Pick<SetupStatus, "accounts" | "imported_accounts">,
): string | null {
  if (status.accounts === 0) return null;
  if (status.imported_accounts === 0) return addHref({ setup: true });
  return "/";
}
