import type {
  OpeningBalanceAccount,
  OpeningBalances,
} from "../../../shared/index";

/*
 * The opening balances screen's rows: one account each, with the date and the
 * debit or credit its opening entry carries, as a journal line reads. An asset
 * opens on the debit side, a loan or a card on the credit side, and the books'
 * signed amount is the debit less the credit.
 *
 * The grid lists them and the form fills one in; this module says what a row
 * holds and what a filled-in form comes to, so both can be read without
 * mounting either.
 */

export interface OpeningRow {
  accountId: number;
  name: string;
  /** Its place in the account tree: `Assets:Bank:Sample Savings`. */
  path: string;
  /** The account's first posted entry or draft; null with neither. */
  firstActivityDate: string | null;
  /** The entry the books already hold; the row is then read-only. */
  recorded: { journalId: number; description: string } | null;
  date: string | null;
  debit: number | null;
  credit: number | null;
  /** The side the first balance check filled in, if it could. */
  suggested: "debit" | "credit" | null;
}

/** Each account as a row, with its default date and suggested amount. */
export function openingRows({ accounts }: OpeningBalances): OpeningRow[] {
  return accounts.map(openingRow);
}

function openingRow(account: OpeningBalanceAccount): OpeningRow {
  const common = {
    accountId: account.account_id,
    name: account.name,
    path: account.path,
    firstActivityDate: account.first_activity_date,
  };
  if (account.opening !== null) {
    return {
      ...common,
      recorded: {
        journalId: account.opening.journal_id,
        description: account.opening.description,
      },
      date: account.opening.date,
      ...sides(account.opening.amount),
      suggested: null,
    };
  }
  return {
    ...common,
    recorded: null,
    date: account.default_date,
    ...sides(account.suggested_amount),
    suggested:
      account.suggested_amount === null
        ? null
        : account.suggested_amount < 0
          ? "credit"
          : "debit",
  };
}

/** A signed amount on the side it belongs to; money owed is a credit. */
function sides(amount: number | null): {
  debit: number | null;
  credit: number | null;
} {
  if (amount === null) return { debit: null, credit: null };
  return amount < 0
    ? { debit: null, credit: -amount }
    : { debit: amount, credit: null };
}

/** What the form holds for one account, as its fields carry it. */
export interface RowDraft {
  date: unknown;
  debit: unknown;
  credit: unknown;
}

export type RowReading =
  { ok: true; date: string; amount: number } | { ok: false; problem: string };

/**
 * What the row would post, or why it can't yet. The server refuses a date on
 * or after the account's first transaction too, and a second opening entry,
 * and says so in its own words.
 */
export function readRow(draft: RowDraft, row: OpeningRow): RowReading {
  if (row.recorded !== null) {
    return { ok: false, problem: "This account already has an opening entry." };
  }
  const date = typeof draft.date === "string" ? draft.date : "";
  if (date === "") return { ok: false, problem: "Pick a date." };
  if (row.firstActivityDate !== null && date >= row.firstActivityDate) {
    return {
      ok: false,
      problem: "The date must be before the account's first transaction.",
    };
  }

  const debit = amountOf(draft.debit);
  const credit = amountOf(draft.credit);
  if (debit === "invalid" || credit === "invalid") {
    return { ok: false, problem: "Enter the amount as a number." };
  }
  if ((debit !== null && debit < 0) || (credit !== null && credit < 0)) {
    return {
      ok: false,
      problem: "Amounts are positive: money owed goes in credit.",
    };
  }
  if (debit === null && credit === null) {
    return { ok: false, problem: "Enter a debit or a credit." };
  }
  if (debit !== null && credit !== null) {
    return {
      ok: false,
      problem: "Enter either a debit or a credit, not both.",
    };
  }
  return { ok: true, date, amount: debit ?? -(credit ?? 0) };
}

/**
 * A money cell as a number: null when it is empty, and "invalid" for text the
 * editor kept because it isn't a number.
 */
export function amountOf(cell: unknown): number | null | "invalid" {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : "invalid";
  if (typeof cell !== "string") return "invalid";
  const cleaned = cell.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return "invalid";
  return Number(cleaned);
}
