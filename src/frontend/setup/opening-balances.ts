import { ApiError } from "@sapporta/shared/client";
import {
  openingBalanceRefusalSchema,
  type OpeningBalanceAccount,
  type OpeningBalances,
  type OpeningLock,
  type OpeningSection,
} from "../../shared/index";
import { formatBalance, formatDate, formatMoney } from "../format";
import { ACCOUNT_TYPE_TERMS } from "./account-type-terms";

/*
 * Opening balances as words: which table each account is in, its balance as
 * the user reads it, why a locked one can't change, and what a balance's
 * form opens with and comes to. Settings' Opening balances page, its dialog
 * and C1 (/add/other) render these and decide nothing themselves.
 *
 * The user types what an account held, or what they owed on it, both
 * positive; the ledger keeps what is owed below zero. `ledgerAmount` and
 * `typedAmount` are that one rule, which /add's typed opening follows too.
 */

/** The side of the books an opening balance is on. */
export type BalanceType = OpeningBalanceAccount["account_type"];

/**
 * A typed amount as the ledger takes it: what is owed on a liability is
 * negative. Commas, ₹ and spaces are ignored; null for anything that isn't
 * a number.
 */
export function ledgerAmount(type: BalanceType, typed: string): number | null {
  const text = typed.replace(/[₹,\s]/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const amount = Math.round(Number(text) * 100) / 100;
  const signed = type === "Liability" ? -amount : amount;
  // Nothing owed is 0, not -0.
  return signed === 0 ? 0 : signed;
}

/** A ledger amount as the user types it: what is owed, positive. */
export function typedAmount(type: BalanceType, ledger: number): string {
  const typed = type === "Liability" ? -ledger : ledger;
  return (typed === 0 ? 0 : typed).toFixed(2);
}

/** One of the Opening balances page's tables. */
export interface BalanceSection {
  section: OpeningSection;
  /** "Assets · what you own", split so the caption can go in lower case. */
  term: string;
  caption: string;
  /** The amount column's heading. */
  amountHeading: string;
  accounts: OpeningBalanceAccount[];
}

const SECTION_ORDER: readonly OpeningSection[] = ["own", "owe", "statement"];

const SECTION_WORDS: Record<
  OpeningSection,
  Pick<BalanceSection, "term" | "caption" | "amountHeading">
> = {
  own: { ...ACCOUNT_TYPE_TERMS.Asset, amountHeading: "Balance" },
  owe: { ...ACCOUNT_TYPE_TERMS.Liability, amountHeading: "Owed" },
  statement: {
    term: "Banks & cards",
    caption: "set by each first statement",
    amountHeading: "Balance",
  },
};

/** Whether `?account=` names the account, by its name or its path. */
export function focuses(
  account: Pick<OpeningBalanceAccount, "name" | "path">,
  param: string | null,
): boolean {
  return param !== null && (account.name === param || account.path === param);
}

/**
 * The section an account is listed in: the server's, or, for a group
 * account the page leaves out, its type's when a link names it.
 */
export function sectionOf(
  account: OpeningBalanceAccount,
  focus: string | null,
): OpeningSection | null {
  if (account.section !== null) return account.section;
  if (!focuses(account, focus)) return null;
  return account.account_type === "Asset" ? "own" : "owe";
}

/** The tables in order, each in tree order; an empty one is left out. */
export function balanceSections(
  { accounts }: OpeningBalances,
  focus: string | null,
): BalanceSection[] {
  const byPath = [...accounts].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return SECTION_ORDER.map((section) => ({
    section,
    ...SECTION_WORDS[section],
    accounts: byPath.filter((account) => sectionOf(account, focus) === section),
  })).filter((one) => one.accounts.length > 0);
}

/**
 * The Opening balances page's tables: the balances recorded, and the
 * account a link names when it has none, so the link's "Record the opening
 * balance" can be done there. Recording any other is C1's.
 */
export function recordedSections(
  data: OpeningBalances,
  focus: string | null,
): BalanceSection[] {
  return balanceSections(data, focus)
    .map((one) => ({
      ...one,
      accounts: one.accounts.filter(
        (account) => account.opening !== null || focuses(account, focus),
      ),
    }))
    .filter((one) => one.accounts.length > 0);
}

/**
 * Where the account sits, under its name: its parents below the type's top
 * account, "Investments > Mutual Funds". Null directly under the top.
 */
export function parentLine(
  account: Pick<OpeningBalanceAccount, "name" | "path">,
): string | null {
  const { name, path } = account;
  const parents = path.endsWith(`:${name}`)
    ? path.slice(0, -name.length - 1)
    : path.slice(0, Math.max(0, path.lastIndexOf(":")));
  const below = parents.split(":").slice(1);
  return below.length === 0 ? null : below.join(" > ");
}

/** The recorded balance as its table reads it; null with none. */
export function openingFigure(
  section: OpeningSection,
  account: OpeningBalanceAccount,
): string | null {
  if (account.opening === null) return null;
  const amount = account.opening.amount;
  switch (section) {
    case "own":
      return amount < 0
        ? `${formatMoney(-amount)} overdrawn`
        : formatMoney(amount);
    case "owe":
      return amount > 0
        ? `${formatMoney(amount)} in credit`
        : formatMoney(-amount);
    case "statement":
      return formatBalance(
        amount,
        account.account_type === "Asset" ? "bank" : "card",
      );
  }
}

/** Why a recorded balance can't change here, where its journal entry can. */
export function lockText(lock: OpeningLock): string {
  switch (lock) {
    case "has_entries":
      return "Has other transactions. Change it in its journal entry.";
    case "shared_entry":
      return "Recorded with other accounts in one entry. Change it there.";
  }
}

/** Where an opening entry is changed by hand: its journal, in the tables. */
export function journalHref(journalId: number): string {
  return `/tables/journals?filter[id][eq]=${journalId}`;
}

/**
 * The journal a change or removal was refused for, when the server says the
 * balance is locked (a 409 naming it); null for any other failure.
 */
export function lockedJournal(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const refusal = openingBalanceRefusalSchema.safeParse(error.body);
  return refusal.success ? (refusal.data.journal_id ?? null) : null;
}

/** The dialog's fields, as typed. */
export interface BalanceFields {
  amount: string;
  date: string;
  note: string;
}

const OPENING_DESCRIPTION = "Opening balance";

/**
 * What the dialog opens with: the recorded balance when editing; when
 * adding, the first statement's suggestion and the account's default date,
 * else `today`.
 */
export function fieldsFor(
  account: OpeningBalanceAccount,
  today: string,
): BalanceFields {
  const type = account.account_type;
  if (account.opening !== null) {
    const { amount, date, description } = account.opening;
    return {
      amount: typedAmount(type, amount),
      date,
      note: description === OPENING_DESCRIPTION ? "" : description,
    };
  }
  return {
    amount:
      account.suggested_amount === null
        ? ""
        : typedAmount(type, account.suggested_amount),
    date: account.default_date ?? today,
    note: "",
  };
}

/** What the dialog sends, or the first thing wrong with it. */
export type BalanceReading =
  | { ok: true; date: string; amount: number; description?: string }
  | { ok: false; problem: string };

/**
 * The fields as the books take them. The server refuses a date on or after
 * the first transaction too, and says so in the same words.
 */
export function readBalance(
  account: Pick<OpeningBalanceAccount, "account_type" | "first_activity_date">,
  fields: BalanceFields,
): BalanceReading {
  const type = account.account_type;
  if (fields.amount.trim() === "") {
    return {
      ok: false,
      problem:
        type === "Asset" ? "Enter the balance." : "Enter the amount owed.",
    };
  }
  const amount = ledgerAmount(type, fields.amount);
  if (amount === null) {
    return { ok: false, problem: "Enter the amount as a number." };
  }
  const date = fields.date.trim();
  if (date === "") return { ok: false, problem: "Pick a date." };
  const first = account.first_activity_date;
  if (first !== null && date >= first) {
    return {
      ok: false,
      problem: `Pick a day before ${formatDate(first)}, its first transaction.`,
    };
  }
  const note = fields.note.trim();
  return note === ""
    ? { ok: true, date, amount }
    : { ok: true, date, amount, description: note };
}

/** The amount field's label. */
export function amountLabel(type: BalanceType): string {
  return type === "Asset" ? "Balance" : "Amount owed";
}

/**
 * Under the amount: where a prefilled suggestion came from, else what the
 * figure is. The As of field below it gives the day.
 */
export function amountHint(type: BalanceType, fromSuggestion: boolean): string {
  if (fromSuggestion) return "From its first statement's balances.";
  return type === "Asset" ? "What it held." : "What you owed.";
}

/** What an amount typed below zero means; null otherwise. */
export function signReadback(type: BalanceType, typed: string): string | null {
  // As typed, before the ledger's sign.
  const amount = ledgerAmount("Asset", typed);
  if (amount === null || amount >= 0) return null;
  return type === "Asset" ? "Below zero: overdrawn." : "Below zero: in credit.";
}

/** Under the date: the day it must come before, or where the default is from. */
export function dateHint(
  account: Pick<OpeningBalanceAccount, "first_activity_date" | "default_date">,
  adding: boolean,
): string {
  if (account.first_activity_date !== null) {
    return `Before its first transaction on ${formatDate(account.first_activity_date)}.`;
  }
  if (adding && account.default_date !== null) return "When your books start.";
  return "The day your balance is from.";
}
