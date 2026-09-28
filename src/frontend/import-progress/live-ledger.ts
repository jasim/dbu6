import type { ImportProgressRow, ChartAccount } from "../../shared/index";
import { ownHue, type AccountHueKey } from "../components/account-hue";

/*
 * The importing screen's live ledger: the rows as they are read, each
 * account shown as it is answered. The rules' answers show at once; the
 * coding agent's arrive a call at a time, many together, so the card lets
 * them out one description at a time (`nextReveal`), at a pace that spreads
 * a call's answers over the wait for the next (`revealPace`). The tally bar
 * counts only what has been shown, so it moves with the rows.
 */

/** Rows by their index in the import's progress. */
export type Revealed = ReadonlySet<number>;

/** An account's hue, by its name, through the chart's parents. */
export function huesByName(
  accounts: readonly ChartAccount[],
): (name: string) => AccountHueKey {
  const parentOf = new Map<string, string | null>();
  for (const account of accounts) {
    if (!parentOf.has(account.name)) {
      parentOf.set(account.name, account.parent);
    }
  }
  const hues = new Map<string, AccountHueKey>();
  const hueOf = (name: string, seen: Set<string>): AccountHueKey => {
    const known = hues.get(name);
    if (known !== undefined) return known;
    const parent = parentOf.get(name) ?? null;
    // A loop in the chart gives up on the parents: grey.
    const parentHue =
      parent === null || seen.has(parent)
        ? "other"
        : hueOf(parent, seen.add(name));
    const hue = ownHue(name) ?? parentHue;
    hues.set(name, hue);
    return hue;
  };
  return (name) => hueOf(name, new Set());
}

/** The rows the rules answered: shown as soon as the rows are. */
export function ruleRows(rows: readonly ImportProgressRow[]): number[] {
  return rows.flatMap((row, index) => (row.by === "rule" ? [index] : []));
}

/** Answered rows not yet shown. */
export function unrevealed(
  rows: readonly ImportProgressRow[],
  revealed: Revealed,
): number[] {
  return rows.flatMap((row, index) =>
    row.account !== null && !revealed.has(index) ? [index] : [],
  );
}

/**
 * The rows to show next: the first answered row not yet shown, with every
 * other such row of its narration, so one answer lights them together.
 * Empty when nothing waits.
 */
export function nextReveal(
  rows: readonly ImportProgressRow[],
  revealed: Revealed,
): number[] {
  const waiting = unrevealed(rows, revealed);
  if (waiting.length === 0) return [];
  const narration = rows[waiting[0]].narration;
  return waiting.filter((index) => rows[index].narration === narration);
}

/**
 * Milliseconds between reveals, given how many groups wait: a call's
 * answers spread over about six seconds, or a little over one once the add
 * has answered and the card is only catching up.
 */
export function revealPace(waiting: number, finishing: boolean): number {
  const span = finishing ? 1200 : 6000;
  const [least, most] = finishing ? [16, 120] : [80, 600];
  return Math.min(most, Math.max(least, span / Math.max(1, waiting)));
}

/** How many groups `nextReveal` would take to show every waiting row. */
export function waitingGroups(
  rows: readonly ImportProgressRow[],
  revealed: Revealed,
): number {
  return new Set(unrevealed(rows, revealed).map((i) => rows[i].narration)).size;
}

export interface TallySegment {
  account: string;
  hue: AccountHueKey;
  count: number;
}

export interface Tally {
  /**
   * The shown accounts, a hue's together so the bar reads as its colours:
   * the hue with most rows first, and within a hue the account with most.
   */
  segments: TallySegment[];
  /** Rows with no account shown yet. */
  waiting: number;
  total: number;
}

/** The shown rows by account, for the bar over the ledger. */
export function tally(
  rows: readonly ImportProgressRow[],
  revealed: Revealed,
  hueOf: (name: string) => AccountHueKey,
): Tally {
  const counts = new Map<string, number>();
  for (const index of revealed) {
    const account = rows[index]?.account;
    if (account == null) continue;
    counts.set(account, (counts.get(account) ?? 0) + 1);
  }
  const accounts = [...counts].map(([account, count]) => ({
    account,
    hue: hueOf(account),
    count,
  }));
  const byHue = new Map<AccountHueKey, number>();
  for (const { hue, count } of accounts) {
    byHue.set(hue, (byHue.get(hue) ?? 0) + count);
  }
  const segments = accounts.sort(
    (a, b) =>
      byHue.get(b.hue)! - byHue.get(a.hue)! ||
      a.hue.localeCompare(b.hue) ||
      b.count - a.count ||
      a.account.localeCompare(b.account),
  );
  const shown = segments.reduce((sum, one) => sum + one.count, 0);
  return { segments, waiting: rows.length - shown, total: rows.length };
}
