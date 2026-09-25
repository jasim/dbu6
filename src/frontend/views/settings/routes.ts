/*
 * The Settings pages that look after what onboarding set up (PLAN.md "What
 * leaves /setup"): the banks and cards statements come from, and the
 * opening balances. Adding either is /add's and C1's; these pages change
 * and remove what is there.
 */

/**
 * Where a bank or card is edited or removed, and a deleted one's preset
 * goes.
 */
export const BANKS_SETTINGS_ROUTE = "/settings/banks";

/** Where a recorded opening balance is changed or removed. */
export const BALANCES_SETTINGS_ROUTE = "/settings/balances";

/**
 * The Opening balances page on one account's row (by its name or path).
 * An account with no balance yet opens with its dialog, to record the one
 * a problem elsewhere says it lacks.
 */
export function balancesHref(account: string): string {
  return `${BALANCES_SETTINGS_ROUTE}?${new URLSearchParams({ account })}`;
}
