import {
  chartInTreeOrder,
  LEDGER_ACCOUNT_TYPES,
  OPENING_BALANCES_NAME,
  type ChartAccount,
  type ChartRow,
  type LedgerAccountType,
} from "../../shared/index";

/*
 * The chart of accounts as a checklist. Unticking an account unticks
 * everything under it; ticking one ticks everything above it, so the ticked
 * accounts always form a tree. The top accounts and Opening Balances, with
 * whatever sits between them, stay ticked: a chart can't be created without
 * them (validateChartProposal).
 */

export type Ticks = ReadonlySet<string>;

/** The accounts that can't be unticked. */
export function lockedAccounts(accounts: readonly ChartAccount[]): Ticks {
  const locked = new Set(
    accounts.filter((a) => a.parent === null).map((a) => a.name),
  );
  if (accounts.some((a) => a.name === OPENING_BALANCES_NAME)) {
    for (const name of withAncestors(accounts, OPENING_BALANCES_NAME)) {
      locked.add(name);
    }
  }
  return locked;
}

/** Every account ticked but `unticked` and what is under them. */
export function initialTicks(
  accounts: readonly ChartAccount[],
  unticked: readonly string[] = [],
): Ticks {
  const locked = lockedAccounts(accounts);
  const off = new Set(
    unticked.flatMap((name) => withDescendants(accounts, name)),
  );
  return new Set(
    accounts
      .map((a) => a.name)
      .filter((name) => locked.has(name) || !off.has(name)),
  );
}

/** The ticks after the user clicks `name`'s box. */
export function toggleTick(
  accounts: readonly ChartAccount[],
  ticks: Ticks,
  name: string,
): Ticks {
  const locked = lockedAccounts(accounts);
  if (locked.has(name)) return ticks;
  const next = new Set(ticks);
  if (ticks.has(name)) {
    for (const below of withDescendants(accounts, name)) {
      if (!locked.has(below)) next.delete(below);
    }
  } else {
    for (const above of withAncestors(accounts, name)) next.add(above);
  }
  return next;
}

/** The ticked accounts, in the chart's order. */
export function tickedAccounts(
  accounts: readonly ChartAccount[],
  ticks: Ticks,
): ChartAccount[] {
  return accounts.filter((a) => ticks.has(a.name));
}

/*
 * The chart as step 1 shows it: one card per account type, the top two
 * levels on view and anything deeper folded under its second-level parent.
 */

/** Accounts deeper than this fold under their ancestor at this depth. */
const SHOWN_DEPTH = 1;

/** An account on view, and what folds under it, in tree order. */
export interface ChartCardRow {
  row: ChartRow;
  folded: ChartRow[];
}

export interface ChartCard {
  type: LedgerAccountType;
  rows: ChartCardRow[];
}

/** One card per account type that has accounts, in the types' order. */
export function chartCards(accounts: readonly ChartAccount[]): ChartCard[] {
  const cards: ChartCard[] = [];
  for (const row of chartInTreeOrder(accounts)) {
    let card = cards.at(-1);
    if (card?.type !== row.account.account_type) {
      card = { type: row.account.account_type, rows: [] };
      cards.push(card);
    }
    const parent = card.rows.at(-1);
    if (row.depth > SHOWN_DEPTH && parent) parent.folded.push(row);
    else card.rows.push({ row, folded: [] });
  }
  return cards;
}

/** How many accounts of each type the chart has. */
export function countsByType(
  accounts: readonly ChartAccount[],
): Record<LedgerAccountType, number> {
  const counts = Object.fromEntries(
    LEDGER_ACCOUNT_TYPES.map((type) => [type, 0]),
  ) as Record<LedgerAccountType, number>;
  for (const account of accounts) counts[account.account_type] += 1;
  return counts;
}

// `name` and every account under it.
function withDescendants(
  accounts: readonly ChartAccount[],
  name: string,
): string[] {
  const found = [name];
  for (let i = 0; i < found.length; i++) {
    for (const a of accounts) {
      if (a.parent === found[i] && !found.includes(a.name)) found.push(a.name);
    }
  }
  return found;
}

// `name` and every account above it.
function withAncestors(
  accounts: readonly ChartAccount[],
  name: string,
): string[] {
  const byName = new Map(accounts.map((a) => [a.name, a]));
  const found: string[] = [];
  let current: string | null = name;
  while (current !== null && !found.includes(current)) {
    found.push(current);
    current = byName.get(current)?.parent ?? null;
  }
  return found;
}
