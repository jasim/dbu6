import {
  chartInTreeOrder,
  LEDGER_ACCOUNT_TYPES,
  OPENING_BALANCES_NAME,
  type ChartAccount,
  type LedgerAccountType,
} from "../../../shared/index.js";
import { STARTER_CHART } from "./starter-chart.js";

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
      problems.push(`There is no top ${TYPE_WORDS[type]} account.`);
    }
  }
  const opening = byName.get(OPENING_BALANCES_NAME);
  if (opening === undefined) {
    problems.push(
      `There is no ${OPENING_BALANCES_NAME} account; opening entries post against it.`,
    );
  } else if (opening.account_type !== "Equity") {
    problems.push(
      `${OPENING_BALANCES_NAME} is ${article(opening.account_type)} account; it must be an equity account.`,
    );
  }

  return problems.length === 0
    ? { ok: true, accounts: ordered }
    : { ok: false, problems };
}

/*
 * An LLM's proposal is fixed where that needs no guess, and each fix is
 * noted for the user: a missing top account or Opening Balances is added, a
 * repeated name is dropped, and an account whose parent is missing, of
 * another type or in a loop moves under its type's top account.
 */

export interface NormalizedChart {
  accounts: ChartAccount[];
  // One line per fix, shown above the checklist.
  notes: string[];
}

// A top account the proposal lacks is named as in the starter chart.
const TOP_NAMES = new Map(
  STARTER_CHART.filter((a) => a.parent === null).map((a) => [
    a.account_type,
    a.name,
  ]),
);

/** Pure: `proposed` fixed until validateChartProposal accepts it. */
export function normalizeChartProposal(
  proposed: readonly ChartAccount[],
): NormalizedChart {
  const notes: string[] = [];
  const accounts: ChartAccount[] = [];
  const names = new Set<string>();
  for (const one of proposed) {
    const name = one.name.trim();
    if (name === "") {
      notes.push("An account with no name was left out.");
      continue;
    }
    if (names.has(name)) {
      notes.push(`${name} was proposed twice; the second was left out.`);
      continue;
    }
    names.add(name);
    accounts.push({
      name,
      account_type: one.account_type,
      parent: one.parent?.trim() || null,
      note: one.note?.trim() || null,
    });
  }
  const unused = (name: string) => {
    let free = name;
    for (let n = 2; names.has(free); n++) free = `${name} ${n}`;
    names.add(free);
    return free;
  };

  // Opening Balances is placed once the Equity top account is known.
  let opening = accounts.find((a) => a.name === OPENING_BALANCES_NAME);
  let placeOpening = false;
  if (opening === undefined) {
    opening = {
      name: unused(OPENING_BALANCES_NAME),
      account_type: "Equity",
      parent: null,
      note: null,
    };
    accounts.push(opening);
    placeOpening = true;
    notes.push(
      `${OPENING_BALANCES_NAME} was added: every account's starting balance is posted against it.`,
    );
  } else if (opening.account_type !== "Equity") {
    notes.push(
      `${OPENING_BALANCES_NAME} was proposed as ${article(opening.account_type)} account; it is an equity account now, since starting balances are posted against it.`,
    );
    opening.account_type = "Equity";
    opening.parent = null;
    placeOpening = true;
  }

  const topOf = (type: LedgerAccountType) =>
    accounts.find(
      (a) =>
        a.parent === null &&
        a.account_type === type &&
        !(placeOpening && a === opening),
    );
  for (const type of LEDGER_ACCOUNT_TYPES) {
    if (topOf(type)) continue;
    const name = unused(TOP_NAMES.get(type) ?? type);
    accounts.push({ name, account_type: type, parent: null, note: null });
    notes.push(
      `There was no top ${TYPE_WORDS[type]} account, so ${name} was added.`,
    );
  }
  const topName = (type: LedgerAccountType) => topOf(type)!.name;
  if (placeOpening) opening.parent = topName("Equity");

  const byName = new Map(accounts.map((a) => [a.name, a]));
  for (const account of accounts) {
    if (account.parent === null) continue;
    const parent = byName.get(account.parent);
    const why =
      parent === undefined
        ? "which isn't in the chart"
        : parent === account
          ? "itself"
          : parent.account_type !== account.account_type
            ? `which is ${article(parent.account_type)} account`
            : null;
    if (why === null) continue;
    const top = topName(account.account_type);
    notes.push(
      `${account.name} was under ${parent === account ? "" : `${account.parent}, `}${why}; it is under ${top} now.`,
    );
    account.parent = top;
  }

  // What is left unreached is in a loop, or under one: break each loop at
  // the first of its accounts found walking up.
  for (;;) {
    const reached = new Set(
      chartInTreeOrder(accounts).map((row) => row.account),
    );
    let looped = accounts.find((a) => !reached.has(a));
    if (looped === undefined) break;
    const walked = new Set<ChartAccount>();
    while (!walked.has(looped)) {
      walked.add(looped);
      looped = byName.get(looped.parent!)!;
    }
    const top = topName(looped.account_type);
    notes.push(
      `${looped.name} was under one of its own sub-accounts; it is under ${top} now.`,
    );
    looped.parent = top;
  }

  return { accounts, notes };
}

// Each type in plain words: Revenue is "income" on screen.
const TYPE_WORDS: Record<LedgerAccountType, string> = {
  Asset: "asset",
  Liability: "liability",
  Equity: "equity",
  Revenue: "income",
  Expense: "expense",
};

// "an asset", "a liability".
function article(type: LedgerAccountType): string {
  const word = TYPE_WORDS[type];
  return `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;
}
