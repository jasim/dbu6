import type {
  AccountKind,
  AutoImportResult,
  FirstStatementRefusal,
  FirstStatementRow,
  RecognizedFinding,
  SampleFinding,
  StatementActivity,
} from "../../shared/index";
import {
  agree,
  formatBalance,
  formatDate,
  formatMoney,
  maskIdentifier,
} from "../format";
import type { StatusTone } from "../components/status-chip";
import { describeGroup } from "../views/import-statements/describeGroup";

/*
 * The first statements step's rows as words: what a read statement's
 * number and balance rows say, what holds its import back, the amount the
 * user types as the ledger takes it, and what an imported account holds.
 * The screen renders these and decides nothing itself.
 */

/** The row once an upload or "Check again" has read its statement. */
export function withFinding(
  row: FirstStatementRow,
  finding: SampleFinding,
): FirstStatementRow {
  const base = {
    account_id: row.account_id,
    name: row.name,
    kind: row.kind,
    institution: row.institution,
    account_identifiers: row.account_identifiers,
    activity: row.activity,
  };
  return finding.outcome === "recognized"
    ? { ...base, status: "read", finding }
    : { ...base, status: "unreadable", finding };
}

/** A row's status in its header: a tone and a word or two. */
export interface RowStatus {
  tone: StatusTone;
  label: string;
}

/**
 * The row's status as its header says it: from the books, unless the last
 * import stopped, which only this screen knows.
 */
export function rowStatus(
  row: Pick<FirstStatementRow, "status">,
  importStopped: boolean,
): RowStatus {
  switch (row.status) {
    case "imported":
      return { tone: "ok", label: "Imported" };
    case "read":
      return importStopped
        ? { tone: "problem", label: "Not imported" }
        : { tone: "attention", label: "Ready to import" };
    case "unreadable":
      return { tone: "attention", label: "Can't read yet" };
    case "needs_statement":
      return { tone: "waiting", label: "To do" };
    case "not_in_ledger":
      return { tone: "problem", label: "Deleted from your books" };
  }
}

/*
 * Refusals the same file meets again: its dates, balances, number or rows
 * are what they are. Only another file, or a change elsewhere, gets past.
 */
const SAME_FILE_REFUSED_AGAIN: ReadonlySet<FirstStatementRefusal["code"]> =
  new Set([
    "opening_after_statement_start",
    "opening_disagrees",
    "activity_before_statement",
    "numbers_differ",
    "statement_has_no_transactions",
    "statement_unreadable",
  ]);

/** Whether "Try again" with the same file could get past a refusal. */
export function retryCanHelp(code: FirstStatementRefusal["code"]): boolean {
  return !SAME_FILE_REFUSED_AGAIN.has(code);
}

/** "Account number" or "Card number". */
export function numberLabel(kind: AccountKind): string {
  return kind === "card" ? "Card number" : "Account number";
}

export type NumberFact =
  // New to the account, the one typed, or the statement's once accepted.
  | { state: "saved"; value: string }
  // The statement prints none; the one typed, if any, stays.
  | { state: "not_on_statement"; value: string | null }
  // The statement's differs from the one typed.
  | { state: "differs"; printed: string; own: string };

/**
 * The statement's number beside the account's. `accepted` is the user's
 * "Use the statement's" on a mismatch.
 */
export function numberFact(
  row: Pick<FirstStatementRow, "account_identifiers">,
  finding: RecognizedFinding,
  accepted: boolean,
): NumberFact {
  const printed = finding.printed_identifier;
  const own = row.account_identifiers[0] ?? null;
  if (printed === null) {
    return {
      state: "not_on_statement",
      value: own === null ? null : maskIdentifier(own),
    };
  }
  if (finding.identifier_state === "different" && !accepted) {
    return {
      state: "differs",
      printed: maskIdentifier(printed),
      own: own === null ? "" : maskIdentifier(own),
    };
  }
  return { state: "saved", value: maskIdentifier(printed) };
}

export type BalanceFact =
  // The account has an opening entry; importing records none.
  | { state: "in_books"; label: string; value: string }
  // No rows, so no date to open on.
  | { state: "none" }
  | { state: "from_statement"; label: string; value: string }
  // The statement prints no balance: the user types it.
  | { state: "ask"; label: string; caption: string };

/**
 * The opening balance row: the one in the books when the account has an
 * opening entry, else the statement's. A card's is read as the amount owed,
 * positive, as its statement prints it.
 */
export function balanceFact(
  kind: AccountKind,
  finding: RecognizedFinding,
): BalanceFact {
  const existing = finding.existing_opening;
  if (existing !== null) {
    return { state: "in_books", ...openingFigure(kind, existing) };
  }
  const { opening } = finding;
  if (opening === null) return { state: "none" };
  if (opening.amount === null) {
    const date = formatDate(opening.date);
    return {
      state: "ask",
      label: kind === "card" ? `Amount owed on ${date}` : `Balance on ${date}`,
      caption:
        kind === "card"
          ? `Not on the statement. What you owed on ${date}.`
          : `Not on the statement. What it held on ${date}.`,
    };
  }
  return {
    state: "from_statement",
    ...openingFigure(kind, { date: opening.date, amount: opening.amount }),
  };
}

/*
 * An opening balance as a label and a figure. A card's ledger balance is
 * negative when owed, so it reads as the amount owed ("0.00" when nothing
 * is), and as a balance "in credit" when the card holds money.
 */
function openingFigure(
  kind: AccountKind,
  { date, amount }: { date: string; amount: number },
): { label: string; value: string } {
  const day = formatDate(date);
  if (kind === "card" && amount <= 0) {
    return { label: `Amount owed on ${day}`, value: formatMoney(-amount + 0) };
  }
  return { label: `Balance on ${day}`, value: formatBalance(amount, kind) };
}

/**
 * The typed balance as the ledger takes it: a card's owed amount is
 * negative. Null for anything that isn't a number.
 */
export function openingAmount(kind: AccountKind, typed: string): number | null {
  const text = typed.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const amount = Math.round(Number(text) * 100) / 100;
  // 0 owed is 0, not -0.
  return kind === "card" ? 0 - amount : amount;
}

/**
 * Why "Import" can't run yet, or undefined when it can: nothing in the
 * statement, a number to settle first, or a balance to type.
 */
export function importWaiting(
  kind: AccountKind,
  finding: RecognizedFinding,
  entered: { numberAccepted: boolean; typedBalance: string },
): string | undefined {
  if (finding.transactions === 0) return "The statement has no transactions";
  if (finding.identifier_state === "different" && !entered.numberAccepted) {
    return "The numbers differ";
  }
  const balance = balanceFact(kind, finding);
  if (
    balance.state === "ask" &&
    openingAmount(kind, entered.typedBalance) === null
  ) {
    return "Enter the balance";
  }
  return undefined;
}

/** What an imported account holds: "42 to review · 4 need a category". */
export function importedSummary(activity: StatementActivity): string {
  if (activity.drafts === 0) return `${activity.entries} in your books`;
  const toReview = `${activity.drafts} to review`;
  if (activity.uncategorized === 0) return toReview;
  return `${toReview} · ${activity.uncategorized} ${agree(activity.uncategorized, "needs", "need")} a category`;
}

/**
 * What to say when an import went in but added nothing to review, which
 * leaves the account with no transactions: every row was in the books
 * already. /import's words for it; null when the import added any.
 */
export function nothingNew(result: AutoImportResult): string | null {
  const said = result.groups.map((group) => describeGroup(group));
  if (said.length === 0) return null;
  const texts = said.map((one) =>
    one.kind === "nothing-new" ? one.text : null,
  );
  return texts.every((one) => one !== null) ? texts.join(" ") : null;
}

/**
 * The banks and cards with no transactions yet. One the books deleted can
 * only be removed, so it isn't counted, as the rail doesn't count it.
 */
export function stillToImport(rows: readonly FirstStatementRow[]): number {
  return rows.filter(
    (row) => row.status !== "imported" && row.status !== "not_in_ledger",
  ).length;
}
