import type {
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";
import type { Section } from "./figures";

/*
 * What the page is looking at inside its period: a bar of the chart (a
 * month, or a financial year), and a section, an account, or a parent's own
 * entries. The chart, the accounts and the entries all follow it. Both live
 * in the URL beside the period (`month`, `account`), so a reload or a link
 * keeps them; a new period clears them.
 */

export type Focus =
  | { kind: "section"; section: Section }
  | { kind: "account"; section: Section; accountId: number }
  /** A parent's entries on itself, not on its sub-accounts. */
  | { kind: "own"; section: Section; accountId: number };

export const DEFAULT_FOCUS: Focus = { kind: "section", section: "spending" };

/** The focus a query string asks for, if the report has it. */
export function readFocus(
  search: URLSearchParams,
  report: IncomeExpenses | null,
): Focus {
  const value = search.get("account");
  if (value === "income" || value === "spending") {
    return { kind: "section", section: value };
  }
  const match = value === null ? null : /^(\d+)(\.own)?$/.exec(value);
  if (match === null || report === null) return DEFAULT_FOCUS;
  const accountId = Number(match[1]);
  const section = sectionOf(report, accountId);
  if (section === null) return DEFAULT_FOCUS;
  return match[2]
    ? { kind: "own", section, accountId }
    : { kind: "account", section, accountId };
}

/** The query string with the focus written into it. */
export function withFocus(
  search: URLSearchParams,
  focus: Focus,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (sameFocus(focus, DEFAULT_FOCUS)) next.delete("account");
  else next.set("account", focusParam(focus));
  return next;
}

/** The query string with the chart's selected bar, or none. */
export function withBar(
  search: URLSearchParams,
  key: string | null,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (key === null) next.delete("month");
  else next.set("month", key);
  return next;
}

export function sameFocus(a: Focus, b: Focus): boolean {
  return focusParam(a) === focusParam(b);
}

function focusParam(focus: Focus): string {
  if (focus.kind === "section") return focus.section;
  return focus.kind === "own"
    ? `${focus.accountId}.own`
    : String(focus.accountId);
}

/** Which section holds the account, or null when neither does. */
export function sectionOf(
  report: IncomeExpenses,
  accountId: number,
): Section | null {
  if (findAccount(report.spending.accounts, accountId)) return "spending";
  if (findAccount(report.income.accounts, accountId)) return "income";
  return null;
}

export function findAccount(
  accounts: readonly IncomeExpensesAccount[],
  accountId: number,
): IncomeExpensesAccount | null {
  for (const account of accounts) {
    if (account.account_id === accountId) return account;
    const found = findAccount(account.children, accountId);
    if (found) return found;
  }
  return null;
}

/** The ids of the accounts above this one, top first. */
export function ancestorIds(
  accounts: readonly IncomeExpensesAccount[],
  accountId: number,
): number[] {
  for (const account of accounts) {
    if (account.account_id === accountId) return [];
    const below = ancestorIds(account.children, accountId);
    if (below.length > 0 || findAccount(account.children, accountId)) {
      return [account.account_id, ...below];
    }
  }
  return [];
}

/** The account and every account under it. */
export function subtreeIds(account: IncomeExpensesAccount): Set<number> {
  const ids = new Set<number>();
  const visit = (node: IncomeExpensesAccount) => {
    ids.add(node.account_id);
    node.children.forEach(visit);
  };
  visit(account);
  return ids;
}

/**
 * The rows a section lists first. A single top account with sub-accounts,
 * such as "Expenses", is the section itself, so its children stand in for
 * it; its own entries, if any, follow them as a row of their own.
 */
export function sectionRows(accounts: readonly IncomeExpensesAccount[]): {
  rows: readonly IncomeExpensesAccount[];
  ownOf: IncomeExpensesAccount | null;
} {
  const [only] = accounts;
  if (accounts.length === 1 && only.children.length > 0) {
    return { rows: only.children, ownOf: only.own !== 0 ? only : null };
  }
  return { rows: accounts, ownOf: null };
}

/** A parent's months less its children's: its own entries, month by month. */
export function ownMonths(account: IncomeExpensesAccount): number[] {
  return account.months.map(
    (value, index) =>
      value -
      account.children.reduce((sum, child) => sum + child.months[index], 0),
  );
}
