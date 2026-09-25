import {
  chartInTreeOrder,
  LEDGER_ACCOUNT_TYPES,
  OPENING_BALANCES_NAME,
  type ChartAccount,
  type LedgerAccountType,
} from "../../../shared/index.js";

/*
 * A proposed chart of accounts is a flat list whose accounts name their
 * parents (`chartAccountSchema`). It can be created when
 * `validateChartProposal` accepts it: names unique, trimmed and non-empty;
 * every parent in the list, of the same type, with no loops; a top account
 * for each of the five types; and an Equity account named Opening Balances,
 * which opening entries post against by name.
 */

export type ChartValidation =
  // The accounts in tree order, so each parent comes before its children.
  { ok: true; accounts: ChartAccount[] } | { ok: false; problems: string[] };

/** Pure: whether the chart can be created, or every rule it breaks. */
export function validateChartProposal(
  accounts: readonly ChartAccount[],
): ChartValidation {
  const problems: string[] = [];
  const byName = new Map<string, ChartAccount>();

  for (const account of accounts) {
    if (account.name.trim() === "") {
      problems.push("An account has no name.");
    } else if (account.name !== account.name.trim()) {
      problems.push(`"${account.name}" has spaces around its name.`);
    }
    if (byName.has(account.name)) {
      problems.push(`${account.name} is in the list twice.`);
    } else {
      byName.set(account.name, account);
    }
  }

  for (const account of accounts) {
    if (account.parent === null) continue;
    const parent = byName.get(account.parent);
    if (parent === undefined) {
      problems.push(
        `${account.name} is under ${account.parent}, which is not in the list.`,
      );
    } else if (parent.account_type !== account.account_type) {
      problems.push(
        `${account.name} is ${article(account.account_type)} account under ${parent.name}, which is ${article(parent.account_type)} account.`,
      );
    }
  }

  const ordered = chartInTreeOrder(accounts).map((row) => row.account);
  if (problems.length === 0 && ordered.length < accounts.length) {
    const reached = new Set(ordered);
    const looped = accounts.filter((account) => !reached.has(account));
    problems.push(
      `${looped.map((account) => account.name).join(", ")} ${looped.length === 1 ? "is" : "are"} under each other in a loop.`,
    );
  }

  for (const type of LEDGER_ACCOUNT_TYPES) {
    if (!accounts.some((a) => a.parent === null && a.account_type === type)) {
      problems.push(`There is no top ${type} account.`);
    }
  }
  const opening = byName.get(OPENING_BALANCES_NAME);
  if (opening === undefined) {
    problems.push(
      `There is no ${OPENING_BALANCES_NAME} account; opening entries post against it.`,
    );
  } else if (opening.account_type !== "Equity") {
    problems.push(
      `${OPENING_BALANCES_NAME} is ${article(opening.account_type)} account; it must be an Equity account.`,
    );
  }

  return problems.length === 0
    ? { ok: true, accounts: ordered }
    : { ok: false, problems };
}

// "an Asset", "a Revenue".
function article(type: LedgerAccountType): string {
  return `${/^[AEIOU]/.test(type) ? "an" : "a"} ${type}`;
}
