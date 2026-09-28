/*
 * The Settings pages that look after what onboarding set up (PLAN.md "What
 * leaves /setup"): the banks and cards statements come from, and the
 * opening balances. Adding either is /add's and C1's; these pages change
 * and remove what is there.
 *
 * Each page's edit form is a child route of it, so the page behind stays
 * and the form can be linked to on its own.
 */

/**
 * Where a bank or card is listed, and a deleted one's preset goes.
 */
export const BANKS_SETTINGS_ROUTE = "/settings/banks";

/** One bank or card's edit form, under the list. */
export const EDIT_STATEMENT_ACCOUNT_PATH = ":accountId/edit";

/** Where one bank or card is edited, by the id of its account. */
export function statementAccountHref(accountId: number): string {
  return `${BANKS_SETTINGS_ROUTE}/${accountId}/edit`;
}

/** Where an opening balance is listed, recorded, changed or removed. */
export const BALANCES_SETTINGS_ROUTE = "/settings/balances";

/** One account's balance form, under the list. */
export const EDIT_BALANCE_PATH = ":accountId/edit";

/** Where one account's opening balance is recorded or changed. */
export function balanceFormHref(accountId: number): string {
  return `${BALANCES_SETTINGS_ROUTE}/${accountId}/edit`;
}

/**
 * The Opening balances page on one account's row (by its name or path).
 * The row is highlighted and scrolled to, and an account with no balance yet
 * goes on to its form, to record the one a problem elsewhere says it lacks.
 */
export function balancesHref(account: string): string {
  return `${BALANCES_SETTINGS_ROUTE}?${new URLSearchParams({ account })}`;
}
