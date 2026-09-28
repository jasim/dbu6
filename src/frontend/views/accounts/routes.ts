/*
 * Accounts' URLs. The chart is `/accounts`, and the two states the page can
 * be in besides browsing it — a new account, and one account's form — are
 * paths under it, so each can be linked to, bookmarked and opened in a new
 * tab. The form is a route rather than a local `useState`, which is what
 * makes the dialog a place and not just an event.
 */

export const ACCOUNTS_ROUTE = "/accounts";

/** The new-account form. */
export const NEW_ACCOUNT_ROUTE = `${ACCOUNTS_ROUTE}/new`;

/**
 * One account's edit form. It is a child of the chart's route, so the chart
 * stays on screen behind the dialog.
 */
export function editAccountHref(accountId: number): string {
  return `${ACCOUNTS_ROUTE}/${accountId}/edit`;
}

/** The `:accountId` segment of an edit form's URL, as a row id. */
export const EDIT_ACCOUNT_PATH = ":accountId/edit";

/** The new-account form's path, under the chart's route. */
export const NEW_ACCOUNT_PATH = "new";
